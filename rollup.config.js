import { readFileSync } from 'fs';
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
      // No `mangle.properties`: MapLibre's main-thread code and its self-contained Web
      // Worker (a fixed string blob inside maplibre-gl.js, built and already minified by
      // MapLibre's own toolchain) communicate via postMessage with plain object property
      // names. Our own property mangler only rewrites the live main-thread code — the
      // worker's string payload is opaque text to Terser and stays as MapLibre shipped it —
      // so mangling here could desync the two sides and silently break tile loading.
    }),
  ],
};
