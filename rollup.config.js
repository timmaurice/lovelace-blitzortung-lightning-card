import { readFileSync } from 'fs';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import json from '@rollup/plugin-json';
import replace from '@rollup/plugin-replace';
import { compile } from 'sass'; // Modern API
import litCss from 'rollup-plugin-lit-css';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));
export default {
  input: 'src/blitzortung-lightning-card.ts',
  output: {
    file: 'dist/blitzortung-lightning-card.js',
    format: 'es',
  },
  onwarn(warning, warn) {
    if (warning.code === 'CIRCULAR_DEPENDENCY' && warning.message.includes('d3-')) {
      return;
    }
    warn(warning);
  },
  plugins: [
    replace({
      preventAssignment: true,
      delimiters: ['', ''],
      values: {
        __CARD_VERSION__: pkg.version,
      },
    }),
    resolve({
      browser: true,
      dedupe: ['lit'],
    }),
    commonjs(),
    litCss({
      include: '**/*.scss',
      transform: (_, { filePath }) => {
        const result = compile(filePath, { style: 'compressed' }); // or 'expanded'
        return result.css;
      },
    }),
    json(),
    typescript(),
  ],
};
