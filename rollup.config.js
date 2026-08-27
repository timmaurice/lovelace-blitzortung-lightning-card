import { readFileSync } from 'fs';
import { fileURLToPath, URL } from 'url';
import { rollup } from 'rollup';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import json from '@rollup/plugin-json';
import { compile } from 'sass';
import litCss from 'rollup-plugin-lit-css';
import postcss from 'postcss';
import cssnano from 'cssnano';
import terser from '@rollup/plugin-terser';

function logCardInfo() {
  const part1 = `⚡️ ${pkg.name.toUpperCase().replace(/-/g, ' ')}`;
  const part2 = `v${pkg.version}`;
  const part1Style =
    'color: orange; font-weight: bold; background: black; padding: 2px 4px; border-radius: 2px 0 0 2px;';
  const part2Style =
    'color: white; font-weight: bold; background: dimgray; padding: 2px 4px; border-radius: 0 2px 2px 0;';
  const repo = `Github:  ${pkg.repository.url}`;
  const sponsor = 'Sponsor: https://buymeacoffee.com/timmaurice';

  return `
    console.groupCollapsed(
      '%c${part1}%c${part2}',
      '${part1Style}',
      '${part2Style}'
    );
    console.info("${pkg.description}");
    console.info('${repo}');
    console.info('${sponsor}');
    console.groupEnd();
  `;
}

// MapLibre v6+ ships its Web Worker as a separate file, which doesn't fit this project's
// single-file bundle (HA loads Lovelace cards as one JS resource). Bundle the worker's module
// graph into one self-contained script here; map.ts embeds its source and Blob-loads it at
// runtime. Not an officially supported MapLibre packaging mode — on any maplibre-gl bump,
// rebuild and confirm markers/tiles actually render, not just that the build succeeds.
async function bundleMaplibreWorkerSource() {
  const workerEntry = fileURLToPath(new URL('./node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url));
  const bundle = await rollup({
    input: workerEntry,
    plugins: [resolve({ browser: true })],
    onwarn() {}, // suppress warnings about this internal build artifact
  });
  const { output } = await bundle.generate({ format: 'iife' });
  await bundle.close();
  return output[0].code;
}

function maplibreWorkerInlinePlugin() {
  const virtualId = 'virtual:maplibre-worker-source';
  const resolvedVirtualId = '\0' + virtualId;
  let cachedSourcePromise;

  return {
    name: 'maplibre-worker-inline',
    resolveId(source) {
      if (source === virtualId) {
        return resolvedVirtualId;
      }
      return null;
    },
    async load(id) {
      if (id !== resolvedVirtualId) {
        return null;
      }
      cachedSourcePromise ??= bundleMaplibreWorkerSource();
      const code = await cachedSourcePromise;
      return `export default ${JSON.stringify(code)};`;
    },
  };
}

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));
export default {
  input: 'src/blitzortung-lightning-card.ts',
  output: {
    file: pkg.main,
    format: 'es',
    banner: logCardInfo(),
    inlineDynamicImports: true,
  },
  onwarn(warning, warn) {
    if (warning.code === 'CIRCULAR_DEPENDENCY' && warning.message.includes('d3-')) {
      return;
    }
    warn(warning);
  },
  plugins: [
    maplibreWorkerInlinePlugin(),
    resolve({
      browser: true,
      dedupe: ['lit'],
    }),
    commonjs(),
    litCss({
      include: ['**/*.scss', '**/*.css'],
      async transform(code, { filePath }) {
        // Use SASS for .scss files
        if (filePath.endsWith('.scss')) {
          // The SASS compiler is synchronous
          code = compile(filePath, { style: 'compressed' }).css.toString();
        }
        // Use PostCSS with cssnano for all CSS, including compiled SASS
        const result = await postcss([cssnano({ preset: 'default' })]).process(code, { from: undefined });
        return result.css;
      },
    }),
    json({ compact: true }),
    typescript(),
    terser({
      ecma: 2020,
      format: {
        comments: false,
      },
      // No `mangle.properties`: the main bundle and the worker bundle above are minified in
      // separate Terser invocations, so a shared property name isn't guaranteed to get
      // mangled to the same short name in both — which would silently break MapLibre's
      // main-thread/Worker postMessage protocol.
    }),
  ],
};
