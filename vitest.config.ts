import { defineConfig, type Plugin } from 'vitest/config';

// Test-only stand-in for the `maplibre-worker-inline` Rollup plugin (see rollup.config.js) —
// `maplibre-gl` is fully mocked in tests, so the content is never read, it just needs to resolve.
function stubMaplibreWorkerSourcePlugin(): Plugin {
  const virtualId = 'virtual:maplibre-worker-source';
  const resolvedVirtualId = '\0' + virtualId;

  return {
    name: 'stub-maplibre-worker-source',
    resolveId(source) {
      if (source === virtualId) {
        return resolvedVirtualId;
      }
      return undefined;
    },
    load(id) {
      if (id === resolvedVirtualId) {
        return 'export default "";';
      }
      return undefined;
    },
  };
}

export default defineConfig({
  plugins: [stubMaplibreWorkerSourcePlugin()],
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
