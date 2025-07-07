import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import json from '@rollup/plugin-json';
import { compile } from 'sass'; // Modern API
import litCss from 'rollup-plugin-lit-css';

export default {
  input: 'src/blitzortung-lightning-card.ts',
  output: {
    file: 'dist/blitzortung-lightning-card.js',
    format: 'es',
  },
  plugins: [
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
