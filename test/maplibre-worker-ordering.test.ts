import { fixture, html, waitUntil } from '@open-wc/testing';
import { it, describe, vi, expect } from 'vitest';
import { BlitzortungCardConfig, HomeAssistant } from '../src/types';
import '../src/components/map';

// Its own file, not part of maplibre-worker.test.ts: the assertion below is about the very first
// worker URL and the very first map ever constructed, so it needs a module registry (and a custom
// element registry) that nothing else has touched.
//
// `maplibre-gl` is mocked at module level for the same reason as in
// blitzortung-lightning-card.test.ts — `connectedCallback` fires a real `import('maplibre-gl')`
// on mount, and the real module wants a WebGL context jsdom has not got.
const { maplibreMock, mapConstructor, setWorkerUrl } = vi.hoisted(() => {
  const mapInstanceMock = {
    addControl: vi.fn((control?: { onAdd?: () => HTMLElement }) => {
      control?.onAdd?.();
    }),
    on: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
    getContainer: vi.fn(() => document.createElement('div')),
    resize: vi.fn(),
    remove: vi.fn(),
    fitBounds: vi.fn(),
    getZoom: vi.fn(() => 10),
    jumpTo: vi.fn(),
  };

  const mapConstructor = vi.fn().mockImplementation(function () {
    return mapInstanceMock;
  });
  const setWorkerUrl = vi.fn();

  return {
    mapConstructor,
    setWorkerUrl,
    maplibreMock: {
      Map: mapConstructor,
      Marker: vi.fn().mockImplementation(function () {
        const element = document.createElement('div');
        const marker = {
          setLngLat: vi.fn(() => marker),
          getLngLat: vi.fn(() => undefined),
          addTo: vi.fn(() => marker),
          remove: vi.fn(() => marker),
          getElement: vi.fn(() => element),
          addClassName: vi.fn(),
          removeClassName: vi.fn(),
        };
        return marker;
      }),
      NavigationControl: vi.fn(),
      AttributionControl: vi.fn(),
      LngLatBounds: class {
        extend() {
          return this;
        }
        isEmpty() {
          return true;
        }
        getNorthEast() {
          return { lng: 0, lat: 0 };
        }
        getSouthWest() {
          return { lng: 0, lat: 0 };
        }
      },
      setWorkerUrl,
    },
  };
});

vi.mock('maplibre-gl', () => maplibreMock);

const mockHass = {
  language: 'en',
  config: { components: [] },
  themes: { darkMode: false },
  states: {},
} as unknown as HomeAssistant;

const mockConfig = { type: 'custom:blitzortung-lightning-card' } as BlitzortungCardConfig;

describe('the MapLibre worker URL in a mounted map', () => {
  // MapLibre reads WORKER_URL when it spins up its worker pool, which happens inside the Map
  // constructor. Setting it afterwards is as good as not setting it: no worker, no vector tile
  // parsing, and a map that stays empty without raising anything.
  it('is set once, before the first map is constructed, for any number of maps', async () => {
    const container = await fixture(html`<div></div>`);

    // Mounted one after the other, not all at once: two `import('maplibre-gl')` calls in flight
    // at the same time race vitest's module mock, and the loser gets the real MapLibre, which
    // then dies on jsdom's missing WebGL2 context.
    for (let i = 1; i <= 3; i++) {
      const map = document.createElement('blitzortung-map') as HTMLElement & {
        hass: HomeAssistant;
        config: BlitzortungCardConfig;
      };
      map.hass = mockHass;
      map.config = mockConfig;
      container.appendChild(map);
      await waitUntil(() => mapConstructor.mock.calls.length >= i, `Map ${i} was never constructed`);
    }

    expect(setWorkerUrl).toHaveBeenCalledTimes(1);
    expect(setWorkerUrl.mock.invocationCallOrder[0]).to.be.lessThan(mapConstructor.mock.invocationCallOrder[0]);
  });
});
