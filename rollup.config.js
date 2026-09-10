import { readFileSync } from 'fs';
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

// maplibre-gl v6 ships its Web Worker as its own ES module, `dist/maplibre-gl-worker.mjs`,
// which in turn imports `dist/maplibre-gl-shared.mjs` by relative path. A HACS card is a
// single file, so neither of those exists at the card's URL. MapLibre then derives the worker
// URL from `import.meta.url`, the request 404s, and the map fails without saying so: no
// sources, no layers, `isStyleLoaded()` stuck at false, not one tile request, not one error.
// Raster styles still drew, because images are decoded on the main thread — which is what made
// this look like a broken vector style rather than a missing worker.
//
// So the worker entry is bundled here, at build time, together with the shared half it imports,
// into one self-contained ES module, and handed to the card as a string; the card turns it into
// a blob worker at runtime. The shared half cannot be borrowed from the main thread's copy — a
// worker is a separate JavaScript realm — so it really is present twice in the output, and that
// is what the ~500 KB growth of the bundle is.
const MAPLIBRE_WORKER_ENTRY = 'node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs';
const MAPLIBRE_WORKER_SOURCE_ID = 'virtual:maplibre-worker-source';

function maplibreWorkerInlinePlugin() {
  let source = '';
  return {
    name: 'maplibre-worker-source',
    async buildStart() {
      const workerBundle = await rollup({
        input: MAPLIBRE_WORKER_ENTRY,
        // The worker resolves nothing but its sibling shared module, so no plugins are needed.
        onwarn() {},
      });
      try {
        const { output } = await workerBundle.generate({ format: 'es' });
        if (output.length !== 1) {
          this.error(`Expected the MapLibre worker to bundle into one chunk, got ${output.length}.`);
        }
        // A leftover relative import would resolve against a `blob:` URL at runtime, which is
        // not a valid base — the worker would fail to start. Fail the build here instead.
        if (/\bfrom\s*["']\.{1,2}\//.test(output[0].code)) {
          this.error('The bundled MapLibre worker still has a relative import; it would not run from a blob URL.');
        }
        source = output[0].code;
      } finally {
        await workerBundle.close();
      }
      this.addWatchFile(MAPLIBRE_WORKER_ENTRY);
    },
    resolveId(id) {
      return id === MAPLIBRE_WORKER_SOURCE_ID ? `\0${MAPLIBRE_WORKER_SOURCE_ID}` : null;
    },
    load(id) {
      return id === `\0${MAPLIBRE_WORKER_SOURCE_ID}` ? `export default ${JSON.stringify(source)};` : null;
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
      // No `mangle.properties`: MapLibre's main-thread code and its Web Worker talk to each
      // other over postMessage using plain object property names. The worker reaches the
      // output as a string (see `maplibreWorkerInlinePlugin` above), which Terser treats as opaque
      // text and leaves exactly as MapLibre built it, while a property mangler here would
      // rewrite the live main-thread code only. That would desync the two sides and break
      // tile loading silently.
    }),
  ],
};
