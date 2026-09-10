import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      // rollup injects the real, pre-bundled MapLibre worker source here (see
      // `maplibreWorkerInlinePlugin` in rollup.config.js); the tests only need a string.
      'virtual:maplibre-worker-source': fileURLToPath(
        new URL('./test/stubs/maplibre-worker-source.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
