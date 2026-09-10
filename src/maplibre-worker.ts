import maplibreWorkerSource from 'virtual:maplibre-worker-source';

/**
 * The one thing this module needs from the `maplibre-gl` module namespace. Narrowing it here
 * keeps the helper independent of the rest of MapLibre's surface, so a test can hand it a stub.
 */
export interface MapLibreWorkerHost {
  setWorkerUrl(url: string): void;
}

// One blob URL per document, created lazily and never revoked. MapLibre reads `WORKER_URL`
// again for every worker pool it starts, and a dashboard normally holds several map cards, so
// a URL revoked when one card is torn down would break the next map to come up. One object URL
// is a bounded, one-off cost for the lifetime of the page.
let workerObjectUrl: string | undefined;

/**
 * Point MapLibre at the worker that is bundled into this file.
 *
 * maplibre-gl v6 loads its Web Worker from a sibling file next to `maplibre-gl.mjs`. A HACS
 * card is a single file, so that request 404s and MapLibre then fails silently: the style ends
 * up with no sources and no layers, no tile request is made, and no error is raised. The worker
 * source is inlined at build time (see `maplibreWorkerInlinePlugin` in rollup.config.js) and served
 * from a blob URL instead.
 *
 * Must run after `import('maplibre-gl')` and before the first `new maplibregl.Map(...)`, and is
 * deliberately global rather than per instance: calling it again is a no-op.
 */
export function installMapLibreWorker(maplibregl: MapLibreWorkerHost): void {
  if (workerObjectUrl !== undefined) {
    return;
  }
  // MapLibre starts this as a module worker — it passes `{ type: 'module' }` unless the URL
  // ends in `.cjs`, and only falls back to a classic worker if that throws. The bundled source
  // is therefore an ES module, and, because it is bundled, it carries no relative imports that
  // a `blob:` URL could not resolve.
  workerObjectUrl = URL.createObjectURL(new Blob([maplibreWorkerSource], { type: 'text/javascript' }));
  maplibregl.setWorkerUrl(workerObjectUrl);
}
