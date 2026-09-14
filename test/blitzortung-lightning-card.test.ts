import { fixture, html, waitUntil } from '@open-wc/testing';
import { it, describe, beforeEach, afterEach, vi, expect } from 'vitest';
import '../src/blitzortung-lightning-card';
import { BlitzortungCardConfig, HomeAssistant, NumberFormat } from '../src/types';
import { BlitzortungHistoryChart } from '../src/components/history-chart';
import { BlitzortungMap } from '../src/components/map';
import { BlitzortungLightningCard } from '../src/blitzortung-lightning-card';
import { formatNumber } from '../src/utils';

// Add a type for the ha-card element to avoid using 'any'
interface HaCard extends HTMLElement {
  header?: string;
}

const now = Date.now();

// `maplibre-gl` is module-mocked (vi.hoisted, since vi.mock's factory is hoisted above these
// imports) rather than per-instance: `connectedCallback` fires a real `import('maplibre-gl')`
// synchronously on mount, which a later per-instance mock can't win the race against — and
// unlike Leaflet, MapLibre needs a real WebGL context, so that reliably crashes in jsdom.
const { maplibreMock, mapInstanceMock, createMarkerInstanceMock, controlElements } = vi.hoisted(() => {
  // Mimics `_autoZoomMap`'s isEmpty/NE/SW checks closely enough for `new maplibregl.LngLatBounds()`.
  class MockLngLatBounds {
    static extendCalls: [number, number][] = [];
    private _extended = false;
    extend(lngLat: [number, number]) {
      this._extended = true;
      MockLngLatBounds.extendCalls.push(lngLat);
      return this;
    }
    isEmpty() {
      return !this._extended;
    }
    getNorthEast() {
      return this._extended ? { lng: 1, lat: 1 } : { lng: 0, lat: 0 };
    }
    getSouthWest() {
      return { lng: 0, lat: 0 };
    }
  }

  // Backed by the real element map.ts builds and passes in, so no need to re-implement classList/style.
  function createMarkerInstanceMock(element: HTMLElement) {
    let lngLat: [number, number] | undefined;
    const marker = {
      setLngLat: vi.fn((ll: [number, number]) => {
        lngLat = ll;
        return marker;
      }),
      getLngLat: vi.fn(() => lngLat),
      addTo: vi.fn(() => marker),
      remove: vi.fn(() => marker),
      getElement: vi.fn(() => element),
      addClassName: vi.fn((name: string) => element.classList.add(name)),
      removeClassName: vi.fn((name: string) => element.classList.remove(name)),
    };
    return marker;
  }

  // map.ts toggles MapLibre's camera handlers to lock/unlock the map.
  const makeHandler = () => ({ enable: vi.fn(), disable: vi.fn() });

  // The elements the controls actually rendered, so a test can click their buttons.
  const controlElements: HTMLElement[] = [];

  const mapInstanceMock = {
    dragPan: makeHandler(),
    scrollZoom: makeHandler(),
    doubleClickZoom: makeHandler(),
    touchZoomRotate: makeHandler(),
    touchPitch: makeHandler(),
    dragRotate: makeHandler(),
    boxZoom: makeHandler(),
    keyboard: makeHandler(),
    // Real MapLibre calls onAdd() on add, which is what builds the recenter button; without
    // it `_recenterButton` stays undefined and every button-state update silently no-ops.
    addControl: vi.fn((control?: { onAdd?: () => HTMLElement }) => {
      const element = control?.onAdd?.();
      if (element) controlElements.push(element);
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

  const maplibreMock = {
    // `function`, not an arrow or mockReturnValue: both are invoked with `new` in map.ts.
    Map: vi.fn().mockImplementation(function () {
      return mapInstanceMock;
    }),
    Marker: vi.fn().mockImplementation(function (options: { element?: HTMLElement }) {
      return createMarkerInstanceMock(options?.element ?? document.createElement('div'));
    }),
    NavigationControl: vi.fn(),
    AttributionControl: vi.fn(),
    LngLatBounds: MockLngLatBounds,
    // map.ts points MapLibre at the bundled worker before constructing a map; without this the
    // call throws and every map init fails, quietly, inside _initMap's catch.
    setWorkerUrl: vi.fn(),
  };

  return { maplibreMock, mapInstanceMock, createMarkerInstanceMock, controlElements };
});

vi.mock('maplibre-gl', () => maplibreMock);

/**
 * `mockHass` is a comprehensive mock of the Home Assistant object.
 * It includes a typical state for all required sensors and `geo_location` entities
 * to simulate a scenario with recent lightning strikes. It also mocks the `callApi`
 * function to return a sample history for the counter entity, which is necessary
 * for testing the history chart.
 */
const mockHass: HomeAssistant = {
  states: {
    'sensor.blitzortung_lightning_distance': {
      entity_id: 'sensor.blitzortung_lightning_distance',
      state: '10.0',
      attributes: { unit_of_measurement: 'km' },
      last_changed: new Date(now - 1000 * 60 * 10).toISOString(),
      last_updated: new Date(now - 1000 * 60 * 10).toISOString(),
    },
    'sensor.blitzortung_lightning_counter': {
      entity_id: 'sensor.blitzortung_lightning_counter',
      state: '3',
      attributes: {},
      last_changed: new Date(now - 1000 * 60 * 10).toISOString(),
      last_updated: new Date(now - 1000 * 60 * 10).toISOString(),
    },
    'sensor.blitzortung_lightning_azimuth': {
      entity_id: 'sensor.blitzortung_lightning_azimuth',
      state: '180',
      attributes: {},
      last_changed: new Date(now - 1000 * 60 * 10).toISOString(),
      last_updated: new Date(now - 1000 * 60 * 10).toISOString(),
    },
    // Add geo_location entities for radar and map
    'geo_location.lightning_strike_1': {
      entity_id: 'geo_location.lightning_strike_1',
      state: '10.0',
      attributes: {
        source: 'blitzortung',
        latitude: 52.4,
        longitude: 13.38,
        publication_date: new Date(now - 1000 * 60 * 10).toISOString(), // 10 minutes ago
      },
    },
    'geo_location.lightning_strike_2': {
      entity_id: 'geo_location.lightning_strike_2',
      state: '20.0',
      attributes: {
        source: 'blitzortung',
        latitude: 52.6,
        longitude: 13.5,
        publication_date: new Date(now - 1000 * 60 * 20).toISOString(), // 20 minutes ago
      },
    },
    'geo_location.lightning_strike_3': {
      entity_id: 'geo_location.lightning_strike_3',
      state: '40.0',
      attributes: {
        source: 'blitzortung',
        latitude: 52.7,
        longitude: 13.6,
        publication_date: new Date(now - 1000 * 60 * 40).toISOString(), // 40 minutes ago
      },
    },
    'zone.home': {
      entity_id: 'zone.home',
      state: 'zoning',
      attributes: { latitude: 52.52, longitude: 13.38, radius: 100, friendly_name: 'Home' },
    },
  },
  language: 'en',
  themes: {
    darkMode: false,
  },
  config: {
    latitude: 52.52,
    longitude: 13.38,
  },
  // Mock callApi to prevent errors when fetching history
  callApi: vi.fn().mockResolvedValue([
    [
      { state: '1', last_changed: new Date(now - 1000 * 60 * 40).toISOString() },
      { state: '2', last_changed: new Date(now - 1000 * 60 * 20).toISOString() },
      { state: '3', last_changed: new Date(now - 1000 * 60 * 10).toISOString() },
    ],
  ]),
  callWS: vi.fn().mockResolvedValue([]),
};

/**
 * `mockConfig` provides a basic, valid configuration for the card.
 * Tests can extend this configuration to test specific features
 * like the title, map, or history chart.
 */
const mockConfig: BlitzortungCardConfig = {
  type: 'custom:blitzortung-lightning-card',
  distance_entity: 'sensor.blitzortung_lightning_distance',
  counter_entity: 'sensor.blitzortung_lightning_counter',
  azimuth_entity: 'sensor.blitzortung_lightning_azimuth',
  lightning_detection_radius: 100,
};

/**
 * `noStrikeHass` simulates a scenario where no lightning strikes are present.
 * The geo_location entities are absent, and the counter is at 0.
 */
const noStrikeHass: HomeAssistant = {
  ...mockHass,
  states: {
    'sensor.blitzortung_lightning_distance': {
      ...mockHass.states['sensor.blitzortung_lightning_distance']!,
      state: 'N/A',
    },
    'sensor.blitzortung_lightning_counter': {
      ...mockHass.states['sensor.blitzortung_lightning_counter']!,
      state: '0',
    },
    'sensor.blitzortung_lightning_azimuth': {
      ...mockHass.states['sensor.blitzortung_lightning_azimuth']!,
      state: 'N/A',
    },
    'zone.home': mockHass.states['zone.home']!,
  },
  callApi: vi.fn().mockResolvedValue([[]]), // No history for strikes
};

const mockHassWithCustomZone: HomeAssistant = {
  ...mockHass,
  states: {
    ...mockHass.states,
    'zone.nyc': {
      entity_id: 'zone.nyc',
      state: 'zoning',
      attributes: {
        latitude: 40.7128,
        longitude: -74.006,
        radius: 292,
        friendly_name: 'NYC',
      },
    },
  },
};

/**
 * Helper function to create a mock HomeAssistant object with specific state overrides.
 */
const createHassWithStateOverrides = (overrides: Partial<HomeAssistant['states']>): HomeAssistant => ({
  ...mockHass,
  states: {
    ...mockHass.states,
    ...overrides,
  } as HomeAssistant['states'],
});

/**
 * Test suite for the BlitzortungLightningCard.
 * It covers rendering of different components based on configuration,
 * data handling, and edge cases like having no strike data.
 */
describe('blitzortung-lightning-card', () => {
  let card: BlitzortungLightningCard;

  // The `beforeEach` block sets up a new card instance before each test.
  // This ensures that tests are isolated and don't interfere with each other.
  // It uses the standard `mockHass` and `mockConfig` for a consistent baseline.
  beforeEach(async () => {
    card = await fixture(html`<blitzortung-lightning-card .hass=${mockHass}></blitzortung-lightning-card>`);
    vi.clearAllMocks();
    card.setConfig(mockConfig);
    await card.updateComplete;
  });

  describe('General Rendering and State', () => {
    // Test case to verify that the card's title can be set via configuration.
    it('renders the card with a title', async () => {
      card.setConfig({
        ...mockConfig,
        title: 'My Lightning Card',
      });
      // Wait for the component to update and for the `ha-card` to reflect the new header.
      await waitUntil(
        () => (card.shadowRoot?.querySelector('ha-card') as HaCard)?.header === 'My Lightning Card',
        'Card title was not rendered correctly.',
      );
    });

    // Test case to check if the radar chart SVG is rendered and contains strike dots.
    it('renders the radar chart', async () => {
      await waitUntil(() => card.shadowRoot?.querySelector('.radar-chart svg'), 'Radar chart SVG did not render');
      const radarSvg = card.shadowRoot?.querySelector('.radar-chart svg');
      expect(radarSvg).to.be.an.instanceof(Element);
      // Check for strike dots
      const radarComponent = card.shadowRoot?.querySelector('blitzortung-radar-chart');
      const strikeDots = radarComponent?.querySelectorAll('.strike-dot');
      expect(strikeDots?.length).to.equal(3); // Default period is 1h
    });

    // Test case for the scenario where there are no recent lightning strikes.
    // It verifies that the "No strikes" message is displayed.
    it('displays "No strikes" message when there are no strikes and not in edit mode', async () => {
      card.hass = noStrikeHass;
      await card.updateComplete;
      await waitUntil(() => card.shadowRoot?.querySelector('.no-strikes-message'), 'No strikes message did not render');
    });

    it('renders the full card even without strikes when always_show_full_card is true', async () => {
      card.hass = noStrikeHass;
      card.setConfig({
        ...mockConfig,
        always_show_full_card: true,
      });
      await card.updateComplete;

      // Should show the card sections instead of the message
      expect(card.shadowRoot?.querySelector('.no-strikes-message')).toBeNull();

      // Check if sections are rendered
      const compass = card.shadowRoot?.querySelector('blitzortung-compass');
      expect(compass).not.toBeNull();

      const radar = card.shadowRoot?.querySelector('blitzortung-radar-chart');
      expect(radar).not.toBeNull();

      const history = card.shadowRoot?.querySelector('blitzortung-history-chart');
      expect(history).not.toBeNull();

      // Pointer should be hidden because azimuth is N/A in noStrikeHass
      const pointer = compass?.querySelector('.compass-pointer');
      expect(pointer).toBeNull();
    });
  });

  describe('Location Zone Entity', () => {
    it('uses coordinates from the specified zone entity', async () => {
      card.hass = mockHassWithCustomZone;
      card.setConfig({
        ...mockConfig,
        location_zone_entity: 'zone.nyc',
      });
      await card.updateComplete;

      const homeCoords = card['_getHomeCoordinates']();
      expect(homeCoords).to.deep.equal({ lat: 40.7128, lon: -74.006 });
    });

    it('falls back to zone.home if location_zone_entity is not set', async () => {
      card.hass = mockHassWithCustomZone; // has both zone.home and zone.nyc
      card.setConfig(mockConfig); // no location_zone_entity
      await card.updateComplete;

      const homeCoords = card['_getHomeCoordinates']();
      expect(homeCoords).to.deep.equal({ lat: 52.52, lon: 13.38 });
    });

    it('appends the zone friendly_name to the title if no custom title is set', async () => {
      card.hass = mockHassWithCustomZone;
      card.setConfig({ ...mockConfig, location_zone_entity: 'zone.nyc' });
      await card.updateComplete;
      const haCard = card.shadowRoot?.querySelector('ha-card') as HaCard;
      expect(haCard.header).to.equal('⚡ Lightning localization (NYC)');
    });

    it('does not append zone name if a custom title is set', async () => {
      card.hass = mockHassWithCustomZone;
      card.setConfig({ ...mockConfig, location_zone_entity: 'zone.nyc', title: 'My Custom Title' });
      await card.updateComplete;
      const haCard = card.shadowRoot?.querySelector('ha-card') as HaCard;
      expect(haCard.header).to.equal('My Custom Title');
    });
  });

  describe('Feature Visibility', () => {
    it('does not render radar when show_radar is false', async () => {
      card.setConfig({
        ...mockConfig,
        show_radar: false,
      });
      await card.updateComplete;
      const radarChart = card.shadowRoot?.querySelector('blitzortung-radar-chart');
      const compass = card.shadowRoot?.querySelector('blitzortung-compass');
      expect(radarChart).toBeNull();
      expect(compass).not.toBeNull(); // Compass should still be visible
    });

    it('does not render compass when show_compass is false', async () => {
      card.setConfig({
        ...mockConfig,
        show_compass: false,
      });
      await card.updateComplete;
      const radarChart = card.shadowRoot?.querySelector('blitzortung-radar-chart');
      const compass = card.shadowRoot?.querySelector('blitzortung-compass');
      expect(compass).toBeNull();
      expect(radarChart).not.toBeNull(); // Radar should still be visible
    });

    it('does not render compass and radar when both are false', async () => {
      card.setConfig({
        ...mockConfig,
        show_compass: false,
        show_radar: false,
      });
      await card.updateComplete;
      const radarChart = card.shadowRoot?.querySelector('blitzortung-radar-chart');
      const compass = card.shadowRoot?.querySelector('blitzortung-compass');
      expect(compass).toBeNull();
      expect(radarChart).toBeNull();
    });

    it('drops the compass/radar container entirely when both are false', async () => {
      card.setConfig({
        ...mockConfig,
        show_compass: false,
        show_radar: false,
      });
      await card.updateComplete;
      // An empty .content-container would still be a flex child of .card-content and so
      // contribute its gap as dead space above whatever section follows it.
      expect(card.shadowRoot?.querySelector('.content-container')).toBeNull();
    });

    it('renders radar and compass by default', async () => {
      card.setConfig({
        ...mockConfig,
      });
      await card.updateComplete;
      await waitUntil(
        () => card.shadowRoot?.querySelector('blitzortung-compass')?.querySelector('svg'),
        'Compass SVG did not render',
      );
      await waitUntil(
        () => card.shadowRoot?.querySelector('blitzortung-radar-chart')?.querySelector('svg'),
        'Radar chart SVG did not render',
      );
    });
  });

  describe('Compass', () => {
    it('renders with correct data from hass states', async () => {
      await waitUntil(() => card.shadowRoot?.querySelector('.compass svg'), 'Compass SVG did not render');

      const compassComponent = card.shadowRoot?.querySelector('blitzortung-compass');
      expect(compassComponent?.querySelector('svg')).to.be.an.instanceof(Element);
      const countText = compassComponent?.querySelector('[data-entity-id="sensor.blitzortung_lightning_counter"] text');
      expect(countText?.textContent).to.include('3 ⚡');

      const azimuthText = compassComponent?.querySelector(
        '[data-entity-id="sensor.blitzortung_lightning_azimuth"] text',
      );
      expect(azimuthText?.textContent).to.include('180° S');

      const distanceText = compassComponent?.querySelector(
        '[data-entity-id="sensor.blitzortung_lightning_distance"] text',
      );
      expect(distanceText?.textContent).to.include('10.0 km');
    });

    it('renders compass rose but no pointer if azimuth is not a number', async () => {
      card.hass = createHassWithStateOverrides({
        'sensor.blitzortung_lightning_azimuth': {
          ...mockHass.states['sensor.blitzortung_lightning_azimuth']!,
          state: 'invalid',
        },
      });
      await card.updateComplete;

      const compass = card.shadowRoot?.querySelector('blitzortung-compass');
      expect(compass?.querySelector('svg')).to.be.an.instanceof(Element);
      expect(compass?.querySelector('.compass-pointer')).toBeNull();
    });

    it('applies custom colors from config', async () => {
      card.setConfig({
        ...mockConfig,
        grid_color: 'rgb(0, 0, 255)', // blue
        strike_color: 'rgb(255, 255, 0)', // yellow
        font_color: 'rgb(0, 255, 0)', // green
      });
      await card.updateComplete;

      await waitUntil(() => card.shadowRoot?.querySelector('.compass svg'), 'Compass SVG did not render');
      const compassComponent = card.shadowRoot?.querySelector('blitzortung-compass');

      const gridCircle = compassComponent?.querySelector('svg circle');
      expect(gridCircle?.getAttribute('stroke')).to.equal('rgb(0, 0, 255)');

      const pointer = compassComponent?.querySelector('.compass-pointer path') as HTMLElement;
      expect(pointer?.style.fill).to.equal('rgb(255, 255, 0)');

      const textElement = compassComponent?.querySelector('svg a text');
      expect(textElement?.getAttribute('fill')).to.equal('rgb(0, 255, 0)');
    });

    it('rotates the pointer to the correct angle', async () => {
      await waitUntil(() => card.shadowRoot?.querySelector('.compass-pointer'), 'Compass pointer did not render'); // This selector is inside the component
      const pointerGroup = card.shadowRoot?.querySelector('.compass-pointer') as HTMLElement;
      expect(pointerGroup.style.transform).to.equal('rotate(180deg)');
    });

    describe('Shortest-Path Rotation', () => {
      it('should initialize the angle correctly from the first hass object', async () => {
        // The beforeEach block sets hass with azimuth 180.
        // The initial _compassAngle should be 180.
        expect(card['_compassAngle']).to.equal(180);
      });

      it('should handle a simple forward rotation', async () => {
        // Initial state: 10deg (from 180 in beforeEach)
        card.hass = createHassWithStateOverrides({
          'sensor.blitzortung_lightning_azimuth': {
            ...mockHass.states['sensor.blitzortung_lightning_azimuth'],
            state: '10',
          },
        });
        await card.updateComplete;
        expect(card['_compassAngle']).to.equal(10);

        // New state: 20deg
        card.hass = createHassWithStateOverrides({
          'sensor.blitzortung_lightning_azimuth': {
            ...mockHass.states['sensor.blitzortung_lightning_azimuth'],
            state: '20',
          },
        });
        await card.updateComplete;

        // The angle should just be 20.
        expect(card['_compassAngle']).to.equal(20);
        const pointerGroup = card.shadowRoot?.querySelector('.compass-pointer') as HTMLElement;
        expect(pointerGroup.style.transform).to.equal('rotate(20deg)');
      });

      it('should rotate forward over the 0/360 boundary (e.g., 359deg to 1deg)', async () => {
        // Initial state: 359deg
        card.hass = createHassWithStateOverrides({
          'sensor.blitzortung_lightning_azimuth': {
            ...mockHass.states['sensor.blitzortung_lightning_azimuth'],
            state: '359',
          },
        });
        await card.updateComplete;
        expect(card['_compassAngle']).to.equal(359);

        // New state: 1deg
        card.hass = createHassWithStateOverrides({
          'sensor.blitzortung_lightning_azimuth': {
            ...mockHass.states['sensor.blitzortung_lightning_azimuth'],
            state: '1',
          },
        });
        await card.updateComplete;

        // The angle should be 361 (359 + 2), not 1.
        expect(card['_compassAngle']).to.equal(361);
        const pointerGroup = card.shadowRoot?.querySelector('.compass-pointer') as HTMLElement;
        expect(pointerGroup.style.transform).to.equal('rotate(361deg)');
      });

      it('should rotate backward over the 0/360 boundary (e.g., 1deg to 359deg)', async () => {
        // Initial state: 1deg
        card.hass = createHassWithStateOverrides({
          'sensor.blitzortung_lightning_azimuth': {
            ...mockHass.states['sensor.blitzortung_lightning_azimuth'],
            state: '1',
          },
        });
        await card.updateComplete;
        expect(card['_compassAngle']).to.equal(1);

        // New state: 359deg
        card.hass = createHassWithStateOverrides({
          'sensor.blitzortung_lightning_azimuth': {
            ...mockHass.states['sensor.blitzortung_lightning_azimuth'],
            state: '359',
          },
        });
        await card.updateComplete;

        // The angle should be -1 (1 - 2), not 359.
        expect(card['_compassAngle']).to.equal(-1);
        const pointerGroup = card.shadowRoot?.querySelector('.compass-pointer') as HTMLElement;
        expect(pointerGroup.style.transform).to.equal('rotate(-1deg)');
      });

      it('should rotate backward when it is the shorter path (e.g., 10deg to 200deg)', async () => {
        // Initial state: 10deg
        card.hass = createHassWithStateOverrides({
          'sensor.blitzortung_lightning_azimuth': {
            ...mockHass.states['sensor.blitzortung_lightning_azimuth'],
            state: '10',
          },
        });
        await card.updateComplete;
        expect(card['_compassAngle']).to.equal(10);

        // New state: 200deg
        card.hass = createHassWithStateOverrides({
          'sensor.blitzortung_lightning_azimuth': {
            ...mockHass.states['sensor.blitzortung_lightning_azimuth'],
            state: '200',
          },
        });
        await card.updateComplete;

        // The angle should be -160 (10 - 170), not 200.
        expect(card['_compassAngle']).to.equal(-160);
        const pointerGroup = card.shadowRoot?.querySelector('.compass-pointer') as HTMLElement;
        expect(pointerGroup.style.transform).to.equal('rotate(-160deg)');
      });

      it('should handle rotation from a large cumulative angle', async () => {
        // Set a large initial angle
        card['_compassAngle'] = 370; // Visually 10deg
        await card.updateComplete;

        // New state: 20deg
        card.hass = createHassWithStateOverrides({
          'sensor.blitzortung_lightning_azimuth': {
            ...mockHass.states['sensor.blitzortung_lightning_azimuth'],
            state: '20',
          },
        });
        await card.updateComplete;

        // The angle should be 380 (370 + 10).
        expect(card['_compassAngle']).to.equal(380);
        const pointerGroup = card.shadowRoot?.querySelector('.compass-pointer') as HTMLElement;
        expect(pointerGroup.style.transform).to.equal('rotate(380deg)');
      });
    });
  });

  describe('Data Handling', () => {
    describe('_getRecentStrikes', () => {
      it('should filter strikes based on the default period (1h)', async () => {
        card.setConfig(mockConfig);
        await card['_updateStrikes']();
        expect(card['_strikes'].length).to.equal(3); // 10m, 20m and 40m old
      });

      it('should filter strikes for period: 15m', async () => {
        card.setConfig({ ...mockConfig, period: '15m' });
        await card['_updateStrikes']();
        expect(card['_strikes'].length).to.equal(1); // 10m old
      });

      it('should filter strikes for period: 30m', async () => {
        card.setConfig({ ...mockConfig, period: '30m' });
        await card['_updateStrikes']();
        expect(card['_strikes'].length).to.equal(2); // 10m and 20m old
      });

      it('should filter strikes for period: 1h', async () => {
        card.setConfig({ ...mockConfig, period: '1h' });
        await card['_updateStrikes']();
        expect(card['_strikes'].length).to.equal(3); // 10m, 20m, and 40m old
      });

      it('should include a lightning strike within the configured radius and period for NYC', async () => {
        const nycLat = 40.7128;
        const nycLon = -74.006;
        const strikeLat = 40.869; // ~25km NE of NYC
        const strikeLon = -73.7805;
        const strikePublicationDate = new Date(now - 1000 * 60 * 10).toISOString(); // 10 minutes ago, within 15m period

        const mockHassNYC = createHassWithStateOverrides({
          'zone.nyc': {
            entity_id: 'zone.nyc',
            state: 'zoning',
            attributes: { latitude: nycLat, longitude: nycLon, radius: 292, friendly_name: 'NYC' },
          },
          'geo_location.lightning_strike_test_nyc': {
            entity_id: 'geo_location.lightning_strike_test_nyc',
            state: '25.0', // This state value is not used for filtering, but for display in compass
            attributes: {
              source: 'blitzortung',
              latitude: strikeLat,
              longitude: strikeLon,
              publication_date: strikePublicationDate,
            },
          },
          'sensor.nyc_lightning_distance': {
            entity_id: 'sensor.nyc_lightning_distance',
            state: '25.0', // Mocking the distance sensor to reflect the actual distance
            attributes: { unit_of_measurement: 'km' },
            last_changed: strikePublicationDate,
            last_updated: strikePublicationDate,
          },
          'sensor.nyc_lightning_counter': {
            entity_id: 'sensor.nyc_lightning_counter',
            state: '1',
            attributes: {},
            last_changed: strikePublicationDate,
            last_updated: strikePublicationDate,
          },
          'sensor.nyc_lightning_azimuth': {
            entity_id: 'sensor.nyc_lightning_azimuth',
            state: '45', // Example azimuth for NE
            attributes: {},
            last_changed: strikePublicationDate,
            last_updated: strikePublicationDate,
          },
        });

        const nycConfig: BlitzortungCardConfig = {
          type: 'custom:blitzortung-lightning-card',
          distance_entity: 'sensor.nyc_lightning_distance',
          counter_entity: 'sensor.nyc_lightning_counter',
          azimuth_entity: 'sensor.nyc_lightning_azimuth',
          lightning_detection_radius: 50,
          period: '15m',
          location_zone_entity: 'zone.nyc',
        };

        card.hass = mockHassNYC;
        card.setConfig(nycConfig);
        await card.updateComplete;
        await card['_updateStrikes'](); // Manually trigger strike update

        expect(card['_strikes'].length).to.equal(1);
        expect(card['_strikes'][0].latitude).to.be.closeTo(strikeLat, 0.0001);
        expect(card['_strikes'][0].longitude).to.be.closeTo(strikeLon, 0.0001);
        // The distance calculated by the card should be close to 25km
        expect(card['_strikes'][0].distance).to.be.closeTo(25.73, 0.01);
      });
    });
  });

  describe('Radar Chart', () => {
    it('should use lightning_detection_radius to set the scale', async () => {
      card.setConfig({ ...mockConfig, lightning_detection_radius: 150, period: '1h' });
      await card.updateComplete;

      const radarComponent = card.shadowRoot?.querySelector('blitzortung-radar-chart');
      // The 40km strike should be at r = 90 * (40/150) = 24
      const strikeDots = radarComponent?.querySelectorAll('.strike-dot');
      const thirdStrikeDot = strikeDots?.[2]; // 40km strike is the 3rd newest
      const cx = parseFloat(thirdStrikeDot?.getAttribute('cx') || '0');
      const cy = parseFloat(thirdStrikeDot?.getAttribute('cy') || '0');
      const r = Math.sqrt(cx * cx + cy * cy);
      expect(r).to.be.closeTo(90 * (24.93 / 150), 0.1);
    });

    // `aria-labelledby` names both ids, so both elements have to exist and be localized.
    it('gives the chart a localized accessible name and description', async () => {
      card.setConfig({ ...mockConfig });
      await card.updateComplete;

      const svg = card.shadowRoot?.querySelector('blitzortung-radar-chart')?.querySelector('svg');
      expect(svg?.getAttribute('aria-labelledby')).to.equal('radar-title radar-desc');
      expect(svg?.querySelector('title#radar-title')?.textContent).to.equal('Lightning strike radar');
      expect(svg?.querySelector('desc#radar-desc')?.textContent).to.contain('Showing the 3 most recent strikes');
    });
  });

  // Strike distances are always computed in km internally, but everything the user sees or
  // configures is in whatever unit the distance entity reports - so an HA instance set to
  // Imperial displays miles and takes `lightning_detection_radius` in miles too.
  describe('Imperial units (miles)', () => {
    // Distances of the mocked strikes from zone.home, in km: 13.343, 12.039, 24.925.
    const milesHass = () =>
      createHassWithStateOverrides({
        'sensor.blitzortung_lightning_distance': {
          ...mockHass.states['sensor.blitzortung_lightning_distance']!,
          state: '6.2',
          attributes: { unit_of_measurement: 'mi' },
        },
      });

    it('interprets lightning_detection_radius in the entity unit when that unit is miles', async () => {
      // 20 mi ≈ 32.19 km, so all three strikes (max 24.925 km) fall inside the radius.
      card.hass = milesHass();
      card.setConfig({ ...mockConfig, lightning_detection_radius: 20 });
      await card.updateComplete;
      await card['_updateStrikes']();
      expect(card['_strikes'].length).to.equal(3);

      // The same numeric radius read as km excludes the 24.925 km strike - proving the unit,
      // not just the number, is what changed the outcome.
      card.hass = mockHass;
      card.setConfig({ ...mockConfig, lightning_detection_radius: 20 });
      await card.updateComplete;
      await card['_updateStrikes']();
      expect(card['_strikes'].length).to.equal(2);
    });

    it('labels radar grid circles with round numbers in miles', async () => {
      card.hass = milesHass();
      card.setConfig({ ...mockConfig, lightning_detection_radius: 50, show_grid_labels: true });
      await card.updateComplete;

      const radar = card.shadowRoot?.querySelector('blitzortung-radar-chart');
      await waitUntil(() => radar?.querySelectorAll('.grid-label').length, 'Radar grid labels did not render');

      const labels = [...(radar?.querySelectorAll('.grid-label') ?? [])].map((el) => el.textContent?.trim());
      // Ticks are chosen in the display unit, so they stay round (not 16.1/32.2/... from
      // converting round km ticks), and only the outermost one carries the unit.
      expect(labels).to.deep.equal(['10', '20', '30', '40', '50 mi']);
    });

    it('scales the radar domain by the km equivalent of a miles radius', async () => {
      card.hass = milesHass();
      card.setConfig({ ...mockConfig, lightning_detection_radius: 50 });
      await card.updateComplete;

      const radar = card.shadowRoot?.querySelector('blitzortung-radar-chart');
      const dot = radar?.querySelectorAll('.strike-dot')[2]; // the 24.925 km strike
      const cx = parseFloat(dot?.getAttribute('cx') || '0');
      const cy = parseFloat(dot?.getAttribute('cy') || '0');

      // 50 mi ≈ 80.467 km, so the strike sits at 90 * (24.925 / 80.467) ≈ 27.9 - not the
      // 90 * (24.925 / 50) ≈ 44.9 it would land at if the radius were treated as km.
      expect(Math.sqrt(cx * cx + cy * cy)).to.be.closeTo(90 * (24.925 / 80.467), 0.2);
    });

    it('converts the km strike distance to miles in the strike tooltip', async () => {
      card.hass = milesHass();
      card.setConfig({ ...mockConfig });
      await card.updateComplete;

      // 24.925 km ≈ 15.5 mi - the raw km value would render as "24.9".
      card['_handleShowTooltip'](
        new CustomEvent('show-tooltip', {
          detail: {
            event: new MouseEvent('mouseover'),
            strike: { distance: 24.925, azimuth: 45, timestamp: now, latitude: 52.7, longitude: 13.6 },
          },
        }),
      );
      await card.updateComplete;

      const tooltip = card.shadowRoot?.querySelector('.custom-tooltip');
      expect(tooltip?.textContent).to.include('15.5 mi');
      expect(tooltip?.textContent).to.not.include('24.9');
    });
  });

  describe('History Chart', () => {
    it('renders when enabled', async () => {
      card.setConfig({ ...mockConfig, show_history_chart: true });
      await card.updateComplete;

      await waitUntil(
        () => card.shadowRoot?.querySelector('blitzortung-history-chart')?.querySelector('svg'),
        'History chart SVG did not render',
      );
      const historySvg = card.shadowRoot?.querySelector('blitzortung-history-chart')?.querySelector('svg');
      expect(historySvg).to.be.an.instanceof(Element);
      const bars = historySvg?.querySelectorAll('.bar');
      expect(bars?.length).to.be.greaterThan(0);
    });

    it('renders by default when not configured', async () => {
      card.setConfig({ ...mockConfig }); // show_history_chart is undefined
      await waitUntil(
        () => card.shadowRoot?.querySelector('blitzortung-history-chart')?.querySelector('svg'),
        'History chart SVG did not render',
      );
    });

    it('does not render when disabled', async () => {
      card.setConfig({ ...mockConfig, show_history_chart: false });
      await card.updateComplete;
      const historyChart = card.shadowRoot?.querySelector('blitzortung-history-chart');
      expect(historyChart).to.equal(null);
    });

    it('inverts the history chart timeline when invert_history_direction is true', async () => {
      card.setConfig({ ...mockConfig, show_history_chart: true, invert_history_direction: true });
      card['_historyData'] = [];
      card.editMode = true; // Use edit mode to get predictable sample data
      await card.updateComplete;

      const historyChart = card.shadowRoot?.querySelector('blitzortung-history-chart') as BlitzortungHistoryChart;
      expect(historyChart).not.toBeNull();
      await historyChart.updateComplete;

      // 1. Verify x-axis labels are reversed: ['-60', '-50', '-40', '-30', '-20', '-10']
      const labels = Array.from(historyChart?.querySelectorAll('text.x-label') || []).map((el) => el.textContent);
      expect(labels).to.deep.equal(['-60', '-50', '-40', '-30', '-20', '-10']);

      // 2. Verify buckets/bar-labels are reversed: [1, 2, 4, 1, 2, 1] -> [1, 2, 1, 4, 2, 1]
      const barLabels = Array.from(historyChart?.querySelectorAll('.bar-label') || []).map((el) => el.textContent);
      expect(barLabels).to.deep.equal(['1', '2', '1', '4', '2', '1']);

      // 3. Verify default colors are reversed: ['#CCCCCC', '#FFD700', '#FF7F00', '#D22B2B', '#B22222', '#8B0000']
      const bars = historyChart?.querySelectorAll('.bar');
      const fills = Array.from(bars || []).map((bar) => bar.getAttribute('fill'));
      expect(fills).to.deep.equal(['#CCCCCC', '#FFD700', '#FF7F00', '#D22B2B', '#B22222', '#8B0000']);
    });

    it('applies inverted opacity scale when invert_history_direction is true and bar color is set', async () => {
      card.setConfig({
        ...mockConfig,
        show_history_chart: true,
        invert_history_direction: true,
        history_chart_bar_color: '#ff0000',
      });
      card['_historyData'] = [];
      card.editMode = true;
      await card.updateComplete;

      const historyChart = card.shadowRoot?.querySelector('blitzortung-history-chart') as BlitzortungHistoryChart;
      expect(historyChart).not.toBeNull();
      await historyChart.updateComplete;

      const bars = historyChart?.querySelectorAll('.bar');
      const opacities = Array.from(bars || []).map((bar) => parseFloat(bar.getAttribute('fill-opacity') || '0'));

      // Expected opacities: start at 0.2 (oldest, index 0, left) and end at 1.0 (newest, index 5, right)
      expect(opacities[0]).to.be.closeTo(0.2, 0.01);
      expect(opacities[5]).to.be.closeTo(1.0, 0.01);
    });
  });

  describe('History Chart Data Fetching', () => {
    it('fetches history on initial load', async () => {
      const cardWithoutConfig = await fixture<BlitzortungLightningCard>(
        html`<blitzortung-lightning-card .hass=${mockHass}></blitzortung-lightning-card>`,
      );

      const fetchSpy = vi.spyOn(cardWithoutConfig, '_fetchCountHistory' as any);

      // At this point, the card is created but has no config.
      // The fetch should not have been called, as the `updated` lifecycle hook
      // will return early without a config.
      expect(fetchSpy).not.toHaveBeenCalled();

      // Now we set the config, which triggers the update cycle.
      cardWithoutConfig.setConfig(mockConfig);
      await cardWithoutConfig.updateComplete;

      // The fetch should have been called exactly once after the config was provided.
      expect(fetchSpy).toHaveBeenCalledOnce();
    });

    it('does not fetch history on visual-only config change, but re-renders', async () => {
      // The initial fetch has already happened in beforeEach.

      const fetchSpy = vi.spyOn(card, '_fetchCountHistory' as any);

      // Visual change
      card.setConfig({ ...mockConfig, history_chart_bar_color: '#ff0000' });
      await card.updateComplete;

      expect(fetchSpy).not.toHaveBeenCalled();
      const historyChart = card.shadowRoot?.querySelector('blitzortung-history-chart') as BlitzortungHistoryChart;
      expect(historyChart).not.toBeNull();
      expect(historyChart.config.history_chart_bar_color).to.equal('#ff0000');
    });

    it('fetches history when period changes', async () => {
      // The initial fetch has already happened in beforeEach.

      const fetchSpy = vi.spyOn(card as any, '_fetchCountHistory');

      // Data-related change
      card.setConfig({ ...mockConfig, period: '15m' });
      await card.updateComplete;

      expect(fetchSpy).toHaveBeenCalledOnce();
    });
  });

  describe('Map', () => {
    const setupMapComponent = async (config: BlitzortungCardConfig): Promise<BlitzortungMap> => {
      card.setConfig(config);
      await card.updateComplete;

      await waitUntil(() => card.shadowRoot?.querySelector('blitzortung-map'), 'Map component did not render');
      const mapComponent = card.shadowRoot?.querySelector('blitzortung-map') as BlitzortungMap;
      await mapComponent.updateComplete;
      // The map is initialized asynchronously (dynamic `import('maplibre-gl')`, mocked at
      // module level below); wait for it to settle before the test inspects mock calls.
      await waitUntil(() => maplibreMock.Map.mock.calls.length > 0, 'maplibregl.Map was not called');
      await mapComponent.updateComplete;

      return mapComponent;
    };

    const cameraHandlers = {
      dragPan: mapInstanceMock.dragPan,
      scrollZoom: mapInstanceMock.scrollZoom,
      doubleClickZoom: mapInstanceMock.doubleClickZoom,
      touchZoomRotate: mapInstanceMock.touchZoomRotate,
      touchPitch: mapInstanceMock.touchPitch,
      dragRotate: mapInstanceMock.dragRotate,
      boxZoom: mapInstanceMock.boxZoom,
      keyboard: mapInstanceMock.keyboard,
    };

    beforeEach(() => {
      // The mocked module (vi.mock below) is only evaluated once for the whole file, so reset
      // call history/implementations between tests instead of recreating the mocks.
      mapInstanceMock.addControl.mockClear();
      mapInstanceMock.on.mockClear();
      mapInstanceMock.once.mockClear();
      mapInstanceMock.off.mockClear();
      controlElements.length = 0;
      // One stable container per test: the real map has a single one, and `_applyLockedState`
      // toggles `map-locked` on it.
      const mapContainer = document.createElement('div');
      mapInstanceMock.getContainer.mockClear().mockImplementation(() => mapContainer);
      Object.values(cameraHandlers).forEach((handler) => {
        handler.enable.mockClear();
        handler.disable.mockClear();
      });
      mapInstanceMock.resize.mockClear();
      mapInstanceMock.remove.mockClear();
      mapInstanceMock.fitBounds.mockClear();
      mapInstanceMock.getZoom.mockClear().mockReturnValue(10);
      mapInstanceMock.jumpTo.mockClear();

      maplibreMock.Map.mockClear().mockImplementation(function () {
        return mapInstanceMock;
      });
      maplibreMock.Marker.mockClear().mockImplementation(function (options: { element?: HTMLElement }) {
        return createMarkerInstanceMock(options?.element ?? document.createElement('div'));
      });
      maplibreMock.NavigationControl.mockClear();
      maplibreMock.AttributionControl.mockClear();
      maplibreMock.LngLatBounds.extendCalls = [];
    });

    // Ported from earthquakelist#19: a swipe or wheel over the map should be able to scroll the
    // dashboard rather than pan or zoom the map.
    describe('Interaction lock', () => {
      const lockButton = (): HTMLAnchorElement => {
        const button = controlElements
          .map((el) => el.querySelector<HTMLAnchorElement>('a.lock-button'))
          .find((el): el is HTMLAnchorElement => !!el);
        expect(button, 'lock button was not rendered').not.toBeUndefined();
        return button!;
      };

      it('leaves the camera handlers enabled by default', async () => {
        await setupMapComponent({ ...mockConfig, show_map: true });

        expect(mapInstanceMock.dragPan.enable).toHaveBeenCalled();
        expect(mapInstanceMock.scrollZoom.disable).not.toHaveBeenCalled();
        expect(lockButton().classList.contains('active')).toBe(false);
      });

      it('starts locked when map_lock is true', async () => {
        await setupMapComponent({ ...mockConfig, show_map: true, map_lock: true });

        Object.values(cameraHandlers).forEach((handler) => expect(handler.disable).toHaveBeenCalled());
        expect(mapInstanceMock.getContainer().classList.contains('map-locked')).toBe(true);
        expect(lockButton().classList.contains('active')).toBe(true);
      });

      it('toggles the lock when the button is clicked', async () => {
        const mapComponent = await setupMapComponent({ ...mockConfig, show_map: true });

        lockButton().click();
        await mapComponent.updateComplete;
        expect(mapInstanceMock.dragPan.disable).toHaveBeenCalled();
        expect(mapInstanceMock.getContainer().classList.contains('map-locked')).toBe(true);

        mapInstanceMock.dragPan.enable.mockClear();
        lockButton().click();
        await mapComponent.updateComplete;
        expect(mapInstanceMock.dragPan.enable).toHaveBeenCalled();
        expect(mapInstanceMock.getContainer().classList.contains('map-locked')).toBe(false);
      });

      // The label names the action the click performs, not the state the map is in.
      it('labels the button with the action it performs', async () => {
        const mapComponent = await setupMapComponent({ ...mockConfig, show_map: true });

        expect(lockButton().title).to.equal('Disable map interaction');

        lockButton().click();
        await mapComponent.updateComplete;
        expect(lockButton().title).to.equal('Enable map interaction');
        expect(lockButton().getAttribute('aria-pressed')).to.equal('true');
      });

      // Editing the card must win, or the map would contradict the setting just saved. Two
      // clicks, so the toggle lands on a state the incoming config disagrees with - one click
      // plus one config flip always agree, and would pass with no override at all.
      it('follows a config change over the per-view toggle', async () => {
        const mapComponent = await setupMapComponent({ ...mockConfig, show_map: true, map_lock: false });

        lockButton().click();
        lockButton().click();
        await mapComponent.updateComplete;
        expect(mapInstanceMock.getContainer().classList.contains('map-locked')).toBe(false);

        card.setConfig({ ...mockConfig, show_map: true, map_lock: true });
        await card.updateComplete;
        await mapComponent.updateComplete;
        expect(mapInstanceMock.getContainer().classList.contains('map-locked')).toBe(true);
      });
    });

    it('renders when enabled', async () => {
      const mapComponent = await setupMapComponent({ ...mockConfig, show_map: true });
      const mapContainer = mapComponent.shadowRoot?.querySelector('#map-container');
      expect(mapContainer).not.to.equal(null);
    });

    // Issue #101: people spend most of their time inside the detection radius but away from
    // home, so the map can draw where they are relative to the strikes.
    describe('People on the map', () => {
      const GPS_PERSON = 'person.alice';
      const NON_GPS_PERSON = 'person.bob';

      const hassWithPeople = (overrides: Record<string, unknown> = {}): HomeAssistant => ({
        ...mockHass,
        states: {
          ...mockHass.states,
          [GPS_PERSON]: {
            entity_id: GPS_PERSON,
            state: 'not_home',
            attributes: {
              friendly_name: 'Alice',
              latitude: 52.1,
              longitude: 13.1,
              ...overrides,
            },
          },
          // A router-based tracker: knows a zone name, carries no coordinates.
          [NON_GPS_PERSON]: {
            entity_id: NON_GPS_PERSON,
            state: 'home',
            attributes: { friendly_name: 'Bob' },
          },
        },
      });

      const personMarkers = (): HTMLElement[] =>
        maplibreMock.Marker.mock.calls
          .map((call) => (call[0] as { element?: HTMLElement } | undefined)?.element)
          .filter((el): el is HTMLElement => !!el?.classList.contains('person-marker-wrapper'));

      it('places a person that reports coordinates', async () => {
        card.hass = hassWithPeople();
        const mapComponent = await setupMapComponent({
          ...mockConfig,
          show_map: true,
          map_person_entities: [GPS_PERSON],
        });
        await mapComponent.updateComplete;

        const markers = personMarkers();
        expect(markers).toHaveLength(1);
        expect(markers[0].title).to.equal('Alice');
      });

      it('skips a tracker that reports no coordinates', async () => {
        card.hass = hassWithPeople();
        const mapComponent = await setupMapComponent({
          ...mockConfig,
          show_map: true,
          map_person_entities: [GPS_PERSON, NON_GPS_PERSON],
        });
        await mapComponent.updateComplete;

        const markers = personMarkers();
        expect(markers).toHaveLength(1);
        expect(markers[0].title).to.equal('Alice');
      });

      it('renders the avatar when the person has an entity_picture', async () => {
        card.hass = hassWithPeople({ entity_picture: '/api/image/serve/abc/512x512' });
        const mapComponent = await setupMapComponent({
          ...mockConfig,
          show_map: true,
          map_person_entities: [GPS_PERSON],
        });
        await mapComponent.updateComplete;

        const img = personMarkers()[0]?.querySelector('img');
        expect(img).not.toBeNull();
        expect(img?.getAttribute('src')).to.equal('/api/image/serve/abc/512x512');
      });

      // The name comes from an entity attribute, so it must never be parsed as markup.
      it('does not treat a person name as HTML', async () => {
        card.hass = hassWithPeople({ friendly_name: '<img src=x onerror=alert(1)>' });
        const mapComponent = await setupMapComponent({
          ...mockConfig,
          show_map: true,
          map_person_entities: [GPS_PERSON],
        });
        await mapComponent.updateComplete;

        const marker = personMarkers()[0];
        expect(marker.querySelector('img')).toBeNull();
        expect(marker.title).to.equal('<img src=x onerror=alert(1)>');
      });

      // Styling MapLibre's own marker root beats its `position: absolute` and drops every
      // marker into document flow, stacked in a column.
      it('hands MapLibre an unstyled wrapper, not the styled circle itself', async () => {
        card.hass = hassWithPeople();
        const mapComponent = await setupMapComponent({
          ...mockConfig,
          show_map: true,
          map_person_entities: [GPS_PERSON],
        });
        await mapComponent.updateComplete;

        const root = personMarkers()[0];
        expect(root.classList.contains('person-marker')).toBe(false);
        expect(root.querySelector('.person-marker')).not.toBeNull();
      });

      // The map draws home and strikes when it finishes initialising; people must be drawn
      // there too. `updated()` returns early while there is no map yet, so leaving it to a
      // later update cycle means they appear only if one happens to arrive - the marker is
      // there or not depending on timing.
      it('draws people when the map initialises, without a further update', async () => {
        card.hass = hassWithPeople();
        const mapComponent = await setupMapComponent({
          ...mockConfig,
          show_map: true,
          map_person_entities: [GPS_PERSON],
        });
        await mapComponent.updateComplete;

        const component = mapComponent as unknown as {
          _destroyMap: () => void;
          _initMap: () => Promise<void>;
        };
        component._destroyMap();
        maplibreMock.Marker.mockClear();

        // Rebuild the map and nothing else: no property changes, so no `updated()` cycle.
        await component._initMap();

        expect(personMarkers()).toHaveLength(1);
      });

      it('renders no person markers when the option is unset', async () => {
        card.hass = hassWithPeople();
        const mapComponent = await setupMapComponent({ ...mockConfig, show_map: true });
        await mapComponent.updateComplete;

        expect(personMarkers()).toHaveLength(0);
      });

      // People are deliberately outside the auto-zoom bounds: someone far from home would
      // otherwise zoom the strikes out of view.
      it('does not extend the auto-zoom bounds', async () => {
        card.hass = hassWithPeople();
        const mapComponent = await setupMapComponent({
          ...mockConfig,
          show_map: true,
          map_person_entities: [GPS_PERSON],
        });
        await mapComponent.updateComplete;

        // The person is on the map...
        expect(personMarkers()).toHaveLength(1);
        // ...but their coordinates never took part in a bounds fit.
        expect(maplibreMock.LngLatBounds.extendCalls).not.toContainEqual([13.1, 52.1]);
        // Guard against the assertion passing because nothing was fitted at all.
        expect(maplibreMock.LngLatBounds.extendCalls.length).toBeGreaterThan(0);
      });
    });

    it('renders by default when not configured', async () => {
      const mapComponent = await setupMapComponent({ ...mockConfig }); // show_map is undefined
      expect(mapComponent).not.toBeNull();
    });

    it('does not render when disabled', async () => {
      card.setConfig({ ...mockConfig, show_map: false });
      await card.updateComplete;
      const mapContainer = card.shadowRoot?.querySelector('blitzortung-map');
      expect(mapContainer).to.equal(null);
    });

    it('should use dark theme when map_theme_mode is dark', async () => {
      await setupMapComponent({ ...mockConfig, show_map: true, map_theme_mode: 'dark' });
      await waitUntil(() => maplibreMock.Map.mock.calls.length > 0, 'maplibregl.Map was not called');
      expect(maplibreMock.Map).toHaveBeenCalledWith(
        expect.objectContaining({ style: expect.stringContaining('/dark') }),
      );
    });

    it('should use light theme when map_theme_mode is light', async () => {
      await setupMapComponent({ ...mockConfig, show_map: true, map_theme_mode: 'light' });
      await waitUntil(() => maplibreMock.Map.mock.calls.length > 0, 'maplibregl.Map was not called');
      expect(maplibreMock.Map).toHaveBeenCalledWith(
        expect.objectContaining({ style: expect.stringContaining('/positron') }),
      );
    });

    it('should follow HA theme when map_theme_mode is auto (dark)', async () => {
      card.hass = { ...mockHass, themes: { ...mockHass.themes, darkMode: true } };
      await setupMapComponent({ ...mockConfig, show_map: true, map_theme_mode: 'auto' });
      await waitUntil(() => maplibreMock.Map.mock.calls.length > 0, 'maplibregl.Map was not called');
      expect(maplibreMock.Map).toHaveBeenCalledWith(
        expect.objectContaining({ style: expect.stringContaining('/dark') }),
      );
    });

    it('should follow HA theme when map_theme_mode is auto (light)', async () => {
      card.hass = { ...mockHass, themes: { ...mockHass.themes, darkMode: false } };
      await setupMapComponent({ ...mockConfig, show_map: true, map_theme_mode: 'auto' });
      await waitUntil(() => maplibreMock.Map.mock.calls.length > 0, 'maplibregl.Map was not called');
      expect(maplibreMock.Map).toHaveBeenCalledWith(
        expect.objectContaining({ style: expect.stringContaining('/positron') }),
      );
    });

    // Issue #98: every dashboard render used to send a bounding box around the user's home
    // straight to OpenFreeMap. HA 2026.9's `map_tiles` integration proxies OSM tiles through
    // the user's own instance instead — but the card still supports HA 2026.6, so the
    // OpenFreeMap path is a regular fallback, not a dead branch.
    describe('Base map tiles', () => {
      const OPENFREEMAP = 'https://tiles.openfreemap.org/styles/';
      const CORE_LIGHT_STYLE = '/static/map/light.json';
      const CORE_DARK_STYLE = '/static/map/dark.json';
      let mounted: BlitzortungMap[] = [];

      const coreTilesHass = (overrides: Partial<HomeAssistant> = {}): HomeAssistant =>
        ({
          ...mockHass,
          config: { ...mockHass.config, components: ['sun', 'map_tiles'] },
          callWS: vi.fn().mockResolvedValue({ token: 'a'.repeat(64) }),
          ...overrides,
        }) as HomeAssistant;

      const plainHass = (): HomeAssistant =>
        ({ ...mockHass, config: { ...mockHass.config, components: ['sun'] } }) as HomeAssistant;

      // Home Assistant's own style, shaped as HA 2026.9.1 serves it: every URL in it is an
      // instance-relative path, which is exactly what MapLibre refuses to load. `name` carries
      // the requested style URL so the theme tests can tell the two styles apart.
      const haStyle = (styleUrl: string) => ({
        version: 8,
        name: styleUrl,
        glyphs: '/api/map_tiles/fonts/{fontstack}/{range}.pbf',
        sprite: [{ id: 'basics', url: '/api/map_tiles/sprites/basics/sprites' }],
        sources: {
          'versatiles-shortbread': { type: 'vector', url: '/api/map_tiles/tilejson.json' },
          'listed-tiles': { type: 'raster', tiles: ['/api/map_tiles/vector/{z}/{x}/{y}.mvt'] },
          'third-party': { type: 'raster', tiles: ['https://example.invalid/{z}/{x}/{y}.png'] },
          inline: { type: 'geojson', data: 'data:application/json,{}' },
        },
        layers: [],
      });

      let fetchMock: ReturnType<typeof vi.fn>;
      const stubStyleFetch = (impl: (url: string) => Promise<unknown>) => {
        fetchMock = vi.fn((url: unknown) => impl(String(url)));
        vi.stubGlobal('fetch', fetchMock);
      };

      // Mounts the map component on its own rather than through the card: the shared `card`
      // owns the one mapInstanceMock, and its own map would land in the same call history.
      const mountMap = async (hass: HomeAssistant, config: BlitzortungCardConfig): Promise<BlitzortungMap> => {
        const el = new BlitzortungMap();
        el.hass = hass;
        el.config = config;
        el.strikes = [];
        document.body.appendChild(el);
        mounted.push(el);
        await waitUntil(() => maplibreMock.Map.mock.calls.length > 0, 'maplibregl.Map was not called');
        await el.updateComplete;
        return el;
      };

      type ResolvedStyle = {
        name: string;
        glyphs: string;
        sprite: string | { id: string; url: string }[];
        sources: Record<string, { url?: string; tiles?: string[]; data?: string }>;
      };

      const lastMapOptions = () =>
        maplibreMock.Map.mock.calls.at(-1)![0] as {
          style: string | ResolvedStyle;
          transformRequest?: (url: string) => { url: string };
        };

      // The proxy path now hands MapLibre a style object, the OpenFreeMap fallback a URL.
      const lastCoreStyle = () => lastMapOptions().style as ResolvedStyle;

      beforeEach(() => {
        // The outer card is already running a map of its own; detaching it keeps its
        // in-flight _initMap out of the constructor call history these tests read.
        card.remove();
        maplibreMock.Map.mockClear();
        mounted = [];
        stubStyleFetch((url) => Promise.resolve({ ok: true, status: 200, json: async () => haStyle(url) }));
      });

      afterEach(() => {
        mounted.forEach((el) => el.remove());
        mounted = [];
        vi.unstubAllGlobals();
      });

      it('serves tiles through the Home Assistant proxy when map_tiles is loaded', async () => {
        const hass = coreTilesHass();
        await mountMap(hass, { ...mockConfig, show_map: true });

        expect(hass.callWS).toHaveBeenCalledWith({ type: 'map_tiles/access_token' });
        // Home Assistant's own style, not one built here: source, glyphs, sprites,
        // attribution and zoom range all come from it.
        expect(fetchMock).toHaveBeenCalledWith(CORE_LIGHT_STYLE);
        expect(lastCoreStyle().name).toBe(CORE_LIGHT_STYLE);
      });

      it('picks the proxy style that matches the theme', async () => {
        await mountMap(coreTilesHass(), { ...mockConfig, show_map: true, map_theme_mode: 'dark' });
        expect(lastCoreStyle().name).toBe(CORE_DARK_STYLE);

        maplibreMock.Map.mockClear();
        await mountMap(coreTilesHass(), { ...mockConfig, show_map: true, map_theme_mode: 'light' });
        expect(lastCoreStyle().name).toBe(CORE_LIGHT_STYLE);
      });

      // `auto` reads the theme off `hass`, which changes without any config change at all.
      it('rebuilds against the other style when Home Assistant switches theme', async () => {
        const el = await mountMap(coreTilesHass(), { ...mockConfig, show_map: true, map_theme_mode: 'auto' });
        expect(lastCoreStyle().name).toBe(CORE_LIGHT_STYLE);

        maplibreMock.Map.mockClear();
        el.hass = coreTilesHass({ themes: { darkMode: true } } as Partial<HomeAssistant>);
        await waitUntil(() => maplibreMock.Map.mock.calls.length > 0, 'map was not rebuilt for the new theme');
        expect(lastCoreStyle().name).toBe(CORE_DARK_STYLE);
      });

      // MapLibre refuses a style that carries relative URLs outright — `Invalid sprite URL
      // "/api/map_tiles/sprites/basics/sprites"` — and then makes no tile, glyph or sprite
      // request at all, which is an empty map. Home Assistant's style is relative throughout,
      // so it is fetched and resolved before MapLibre ever sees it.
      it('hands MapLibre a style whose relative URLs have been resolved against the instance', async () => {
        await mountMap(coreTilesHass(), { ...mockConfig, show_map: true });
        const style = lastCoreStyle();
        const origin = window.location.origin;

        expect(style.glyphs).toBe(`${origin}/api/map_tiles/fonts/{fontstack}/{range}.pbf`);
        expect(style.sprite).toEqual([{ id: 'basics', url: `${origin}/api/map_tiles/sprites/basics/sprites` }]);
        expect(style.sources['versatiles-shortbread'].url).toBe(`${origin}/api/map_tiles/tilejson.json`);
        expect(style.sources['listed-tiles'].tiles).toEqual([`${origin}/api/map_tiles/vector/{z}/{x}/{y}.mvt`]);
      });

      // The trap: `new URL(path, origin)` percent-encodes the placeholders MapLibre fills in
      // later, so `{fontstack}` becomes `%7Bfontstack%7D` and no glyph or tile ever loads.
      it('leaves the style placeholders untouched while resolving', async () => {
        await mountMap(coreTilesHass(), { ...mockConfig, show_map: true });
        const style = lastCoreStyle();

        for (const url of [style.glyphs, ...style.sources['listed-tiles'].tiles!]) {
          expect(url).not.toContain('%7B');
          expect(url).not.toContain('%7D');
        }
        expect(style.glyphs).toContain('{fontstack}');
        expect(style.glyphs).toContain('{range}');
        expect(style.sources['listed-tiles'].tiles![0]).toContain('{z}/{x}/{y}');
      });

      // Only paths are rewritten: anything already resolvable is left exactly as it is.
      it('leaves absolute URLs and data URIs untouched', async () => {
        await mountMap(coreTilesHass(), { ...mockConfig, show_map: true });
        const style = lastCoreStyle();

        expect(style.sources['third-party'].tiles).toEqual(['https://example.invalid/{z}/{x}/{y}.png']);
        expect(style.sources['inline'].data).toBe('data:application/json,{}');
      });

      // The spec allows `sprite` to be a plain string as well as the array HA sends.
      it('resolves a sprite given as a single string', async () => {
        stubStyleFetch((url) =>
          Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ ...haStyle(url), sprite: '/api/map_tiles/sprites/basics/sprites' }),
          }),
        );
        await mountMap(coreTilesHass(), { ...mockConfig, show_map: true });

        expect(lastCoreStyle().sprite).toBe(`${window.location.origin}/api/map_tiles/sprites/basics/sprites`);
      });

      it('falls back to OpenFreeMap when the style cannot be fetched, and warns only once', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
          stubStyleFetch(() => Promise.reject(new Error('network down')));
          const el = await mountMap(coreTilesHass(), { ...mockConfig, show_map: true });
          expect(lastMapOptions().style).toContain(OPENFREEMAP);
          expect(warn).toHaveBeenCalledTimes(1);

          maplibreMock.Map.mockClear();
          el.remove();
          document.body.appendChild(el);
          await waitUntil(() => maplibreMock.Map.mock.calls.length > 0, 'map was not re-initialized');
          expect(lastMapOptions().style).toContain(OPENFREEMAP);
          expect(warn).toHaveBeenCalledTimes(1);
        } finally {
          warn.mockRestore();
        }
      });

      it('falls back to OpenFreeMap when the style request is refused', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
          stubStyleFetch(() => Promise.resolve({ ok: false, status: 404, json: async () => ({}) }));
          await mountMap(coreTilesHass(), { ...mockConfig, show_map: true });
          expect(lastMapOptions().style).toContain(OPENFREEMAP);
        } finally {
          warn.mockRestore();
        }
      });

      it('falls back to OpenFreeMap when map_tiles is not loaded', async () => {
        await mountMap(plainHass(), { ...mockConfig, show_map: true });
        expect(lastMapOptions().style).toContain(OPENFREEMAP);
      });

      it('falls back to OpenFreeMap when the token request fails, and warns only once', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
          const hass = coreTilesHass({ callWS: vi.fn().mockRejectedValue(new Error('unknown command')) });
          const el = await mountMap(hass, { ...mockConfig, show_map: true });
          expect(lastMapOptions().style).toContain(OPENFREEMAP);
          expect(warn).toHaveBeenCalledTimes(1);

          // A remount re-runs the whole init; the warning must not repeat per render.
          maplibreMock.Map.mockClear();
          el.remove();
          document.body.appendChild(el);
          await waitUntil(() => maplibreMock.Map.mock.calls.length > 0, 'map was not re-initialized');
          expect(lastMapOptions().style).toContain(OPENFREEMAP);
          expect(warn).toHaveBeenCalledTimes(1);
        } finally {
          warn.mockRestore();
        }
      });

      // The style pulls its TileJSON, vector tiles, glyphs and sprites from the same proxy,
      // and every one of them is refused with 401 unless the request carries the token.
      it('authenticates every proxy request by query parameter, the only method it accepts', async () => {
        await mountMap(coreTilesHass(), { ...mockConfig, show_map: true });
        const transformRequest = lastMapOptions().transformRequest!;
        const token = 'a'.repeat(64);

        for (const path of [
          '/api/map_tiles/tilejson.json',
          '/api/map_tiles/vector/5/16/10.mvt',
          '/api/map_tiles/fonts/noto_sans_regular/0-255.pbf',
          '/api/map_tiles/sprites/basics/sprites.json',
          '/api/map_tiles/sprites/basics/sprites.png',
        ]) {
          expect(transformRequest(`http://ha.local${path}`).url).toBe(`http://ha.local${path}?token=${token}`);
        }

        // The style's URLs are now absolute, so the token check has to keep matching them by
        // path rather than by a leading slash.
        expect(transformRequest(`${window.location.origin}/api/map_tiles/tilejson.json`).url).toBe(
          `${window.location.origin}/api/map_tiles/tilejson.json?token=${token}`,
        );

        // An existing query is extended, not overwritten with a second `?`.
        expect(transformRequest('http://ha.local/api/map_tiles/tilejson.json?foo=1').url).toBe(
          `http://ha.local/api/map_tiles/tilejson.json?foo=1&token=${token}`,
        );

        // The style itself is static and unauthenticated, and anything off-instance is
        // handed back untouched.
        expect(transformRequest('http://ha.local/static/map/light.json')).toEqual({
          url: 'http://ha.local/static/map/light.json',
        });
        expect(transformRequest('https://tiles.openfreemap.org/styles/positron')).toEqual({
          url: 'https://tiles.openfreemap.org/styles/positron',
        });

        // It is the path that has to match. A third-party URL that merely mentions the proxy
        // somewhere in its query would otherwise be handed the instance's token.
        expect(transformRequest('https://tiles.openfreemap.org/x?next=/api/map_tiles/')).toEqual({
          url: 'https://tiles.openfreemap.org/x?next=/api/map_tiles/',
        });
      });

      // Regression: measured in a real HA instance, every vector tile came back `errored`
      // and the map stayed blank while the style, glyphs and sprites all loaded fine. The
      // proxy's TileJSON hands MapLibre root-relative tile templates, MapLibre passes them
      // straight to the Web Worker, and this card builds that worker from a Blob URL — which
      // is a cannot-be-a-base URL, so the worker cannot resolve them and throws. Absolutising
      // has to happen here, on the main thread, because that is the last point before the URL
      // crosses into the worker.
      it('absolutises a root-relative URL, which a Blob-URL worker cannot resolve', async () => {
        await mountMap(coreTilesHass(), { ...mockConfig, show_map: true });
        const transformRequest = lastMapOptions().transformRequest!;
        const token = 'a'.repeat(64);
        const origin = window.location.origin;

        expect(transformRequest('/api/map_tiles/vector/5/16/10.mvt').url).toBe(
          `${origin}/api/map_tiles/vector/5/16/10.mvt?token=${token}`,
        );

        // The same applies to a relative URL that is not the card's own proxy: it still has
        // to leave here absolute, just without a token attached.
        expect(transformRequest('/local/whatever.png')).toEqual({ url: `${origin}/local/whatever.png` });

        // Protocol-relative and absolute URLs are already resolvable and stay untouched.
        expect(transformRequest('https://tiles.openfreemap.org/x.pbf')).toEqual({
          url: 'https://tiles.openfreemap.org/x.pbf',
        });
      });

      it('renews the token well inside its 30-minute rotation and clears the timer on disconnect', async () => {
        const setInterval = vi.spyOn(window, 'setInterval');
        const clearInterval = vi.spyOn(window, 'clearInterval');
        try {
          const hass = coreTilesHass();
          const el = await mountMap(hass, { ...mockConfig, show_map: true });

          const [renew, delay] = setInterval.mock.calls.at(-1)! as unknown as [() => void, number];
          expect(delay).toBeGreaterThan(0);
          expect(delay).toBeLessThan(30 * 60 * 1000);

          renew();
          await new Promise((resolve) => setTimeout(resolve, 0));
          expect(hass.callWS).toHaveBeenCalledTimes(2);

          const timerId = (el as unknown as { _coreTilesTokenTimer?: number })._coreTilesTokenTimer;
          expect(timerId).not.toBeUndefined();

          el.remove();
          expect(clearInterval).toHaveBeenCalledWith(timerId);
          expect((el as unknown as { _coreTilesTokenTimer?: number })._coreTilesTokenTimer).toBeUndefined();
        } finally {
          setInterval.mockRestore();
          clearInterval.mockRestore();
        }
      });

      // A renewed token has to reach the next request without the style being rebuilt.
      it('signs requests with the current token, not the one the map was built with', async () => {
        const hass = coreTilesHass();
        const el = await mountMap(hass, { ...mockConfig, show_map: true });
        const transformRequest = lastMapOptions().transformRequest!;
        expect(transformRequest('http://ha.local/api/map_tiles/tilejson.json').url).toContain('a'.repeat(64));

        (hass.callWS as ReturnType<typeof vi.fn>).mockResolvedValue({ token: 'c'.repeat(64) });
        await (el as unknown as { _fetchCoreTilesToken(): Promise<string | null> })._fetchCoreTilesToken();
        expect(transformRequest('http://ha.local/api/map_tiles/tilejson.json').url).toContain('c'.repeat(64));
      });

      it('forces OpenFreeMap when map_tile_source is openfreemap, proxy or not', async () => {
        const hass = coreTilesHass();
        await mountMap(hass, { ...mockConfig, show_map: true, map_tile_source: 'openfreemap' });
        expect(lastMapOptions().style).toContain(OPENFREEMAP);
        expect(hass.callWS).not.toHaveBeenCalled();
      });

      it('forces the proxy when map_tile_source is core, even if map_tiles is not listed', async () => {
        const hass = { ...plainHass(), callWS: vi.fn().mockResolvedValue({ token: 'b'.repeat(64) }) } as HomeAssistant;
        await mountMap(hass, { ...mockConfig, show_map: true, map_tile_source: 'core' });
        expect(lastCoreStyle().name).toBe(CORE_LIGHT_STYLE);
      });
    });

    it('uses crosshair markers when map_marker_style is crosshair', async () => {
      const mapComponent = await setupMapComponent({
        ...mockConfig,
        show_map: true,
        map_marker_style: 'crosshair',
      });
      await mapComponent.updateComplete;

      expect(maplibreMock.Marker).toHaveBeenCalled();
      const calls = maplibreMock.Marker.mock.calls;
      const strikeCall = calls.find((call) => call[0].element?.innerHTML.includes('strike-marker'));
      expect(strikeCall).not.toBeUndefined();
      expect(strikeCall![0].element.innerHTML).to.contain('mdi:crosshairs');
      expect(strikeCall![0].element.innerHTML).to.contain('crosshair');
    });

    it('uses dot markers when map_marker_style is dot', async () => {
      const mapComponent = await setupMapComponent({
        ...mockConfig,
        show_map: true,
        map_marker_style: 'dot',
      });
      await mapComponent.updateComplete;

      expect(maplibreMock.Marker).toHaveBeenCalled();
      const calls = maplibreMock.Marker.mock.calls;
      const strikeCall = calls.find((call) => call[0].element?.innerHTML.includes('strike-marker'));
      expect(strikeCall).not.toBeUndefined();
      expect(strikeCall![0].element.innerHTML).to.contain('class="strike-marker dot"');
      expect(strikeCall![0].element.innerHTML).not.to.contain('ha-icon');
    });

    it('uses plus markers when map_marker_style is plus', async () => {
      const mapComponent = await setupMapComponent({
        ...mockConfig,
        show_map: true,
        map_marker_style: 'plus',
      });
      await mapComponent.updateComplete;

      expect(maplibreMock.Marker).toHaveBeenCalled();
      const calls = maplibreMock.Marker.mock.calls;
      const strikeCall = calls.find((call) => call[0].element?.innerHTML.includes('strike-marker'));
      expect(strikeCall).not.toBeUndefined();
      expect(strikeCall![0].element.innerHTML).to.contain('mdi:plus');
      expect(strikeCall![0].element.innerHTML).to.contain('plus');
    });

    it('passes custom strike color to map container', async () => {
      const mapComponent = await setupMapComponent({
        ...mockConfig,
        show_map: true,
        strike_color: '#00ff00',
      });
      const mapContainer = mapComponent.shadowRoot?.querySelector('#map-container') as HTMLElement;
      expect(mapContainer.style.getPropertyValue('--map-strike-color')).to.equal('#00ff00');
    });

    // zone.home in mockHass, i.e. the centre the map resets to.
    const HOME: [number, number] = [13.38, 52.52];

    describe('Zoom configuration', () => {
      // The Map constructor runs once per map, and the shared `card` already used it with
      // mockConfig. Mount a card whose *first* config is the one under test.
      const setupFreshMapComponent = async (config: BlitzortungCardConfig): Promise<BlitzortungMap> => {
        // One shared mapInstanceMock serves every map, so the outer card must not own one too.
        // Detaching makes its in-flight _initMap bail at its post-await isConnected check.
        card.remove();
        await new Promise((resolve) => setTimeout(resolve, 0));

        maplibreMock.Map.mockClear();
        mapInstanceMock.addControl.mockClear();
        mapInstanceMock.fitBounds.mockClear();
        mapInstanceMock.jumpTo.mockClear();

        const freshCard = await fixture<BlitzortungLightningCard>(
          html`<blitzortung-lightning-card .hass=${mockHass}></blitzortung-lightning-card>`,
        );
        freshCard.setConfig(config);
        await freshCard.updateComplete;

        await waitUntil(() => freshCard.shadowRoot?.querySelector('blitzortung-map'), 'Map component did not render');
        const mapComponent = freshCard.shadowRoot?.querySelector('blitzortung-map') as BlitzortungMap;
        await mapComponent.updateComplete;
        await waitUntil(() => maplibreMock.Map.mock.calls.length > 0, 'maplibregl.Map was not called');
        return mapComponent;
      };

      // Reach the button the way map.ts does, via the control handed to addControl.
      const recenterButton = (): HTMLAnchorElement => {
        const control = mapInstanceMock.addControl.mock.calls
          .map(
            (call) => call[0] as { onAdd?: () => HTMLElement; getRecenterLink?: () => HTMLAnchorElement | undefined },
          )
          .find(
            (candidate) => typeof candidate?.onAdd === 'function' && typeof candidate?.getRecenterLink === 'function',
          );
        expect(control, 'map tools control was not added to the map').not.toBeUndefined();
        const link = control!.getRecenterLink!();
        expect(link, 'map tools control did not expose its recenter button').not.toBeUndefined();
        return link!;
      };

      const clickRecenter = (): void => recenterButton().click();

      it('fits the view to the strikes by default', async () => {
        await setupFreshMapComponent({ ...mockConfig, show_map: true });

        await waitUntil(() => mapInstanceMock.fitBounds.mock.calls.length > 0, 'Map never fit to the strikes');
        expect(maplibreMock.Map.mock.calls[0][0].zoom).to.equal(8);
      });

      // `map_zoom` is not exclusive to auto-zoom off: it seeds the opening camera either way,
      // and the map keeps it whenever the strike bounds are degenerate (the usual no-strike day).
      it('opens at map_zoom with auto-zoom on as well', async () => {
        await setupFreshMapComponent({ ...mockConfig, show_map: true, map_zoom: 9 });

        expect(maplibreMock.Map.mock.calls[0][0].zoom).to.equal(9);
      });

      it('opens at map_zoom and never fits to strikes when map_auto_zoom is false', async () => {
        await setupFreshMapComponent({ ...mockConfig, show_map: true, map_auto_zoom: false, map_zoom: 8 });

        expect(maplibreMock.Map.mock.calls[0][0].zoom).to.equal(8);
        // Home is still settled on once, since homeCoords can resolve after the map was built.
        await waitUntil(() => mapInstanceMock.jumpTo.mock.calls.length > 0, 'Map never centred on home');
        expect(mapInstanceMock.jumpTo).toHaveBeenCalledWith({ center: HOME, zoom: 8 });
        expect(mapInstanceMock.fitBounds).not.toHaveBeenCalled();
      });

      // MapLibre's camera cap is 22, so clamping any higher would silently render as 22.
      it('clamps map_zoom to the range MapLibre accepts and caps the camera there', async () => {
        await setupFreshMapComponent({ ...mockConfig, show_map: true, map_auto_zoom: false, map_zoom: 99 });

        expect(maplibreMock.Map.mock.calls[0][0].zoom).to.equal(22);
        expect(maplibreMock.Map.mock.calls[0][0].maxZoom).to.equal(22);
      });

      it('restores home and the configured zoom when recenter is pressed with auto-zoom off', async () => {
        await setupFreshMapComponent({ ...mockConfig, show_map: true, map_auto_zoom: false, map_zoom: 7 });
        await waitUntil(() => mapInstanceMock.jumpTo.mock.calls.length > 0, 'Map never centred on home');
        mapInstanceMock.jumpTo.mockClear();

        clickRecenter();

        await waitUntil(() => mapInstanceMock.jumpTo.mock.calls.length > 0, 'Recenter did not reset the view');
        expect(mapInstanceMock.jumpTo).toHaveBeenCalledWith({ center: HOME, zoom: 7 });
        expect(mapInstanceMock.fitBounds).not.toHaveBeenCalled();
      });

      it('refits the strikes rather than resetting zoom when recenter is pressed with auto-zoom on', async () => {
        await setupFreshMapComponent({ ...mockConfig, show_map: true });
        await waitUntil(() => mapInstanceMock.fitBounds.mock.calls.length > 0, 'Map never fit to the strikes');
        mapInstanceMock.fitBounds.mockClear();

        clickRecenter();

        await waitUntil(() => mapInstanceMock.fitBounds.mock.calls.length > 0, 'Recenter did not refit the strikes');
        expect(mapInstanceMock.jumpTo).not.toHaveBeenCalled();
      });

      // Active means "showing the view the card placed", which is true on load in both modes.
      it('marks the recenter button active on load whether or not auto-zoom is on', async () => {
        await setupFreshMapComponent({ ...mockConfig, show_map: true, map_auto_zoom: false, map_zoom: 8 });
        expect(recenterButton().classList.contains('active')).toBe(true);
        expect(recenterButton().title).to.equal('Map is at the configured view');

        await setupFreshMapComponent({ ...mockConfig, show_map: true });
        expect(recenterButton().classList.contains('active')).toBe(true);
        expect(recenterButton().title).to.equal('Auto-zoom enabled');
      });

      it('deactivates the recenter button once the user moves the map, with auto-zoom off', async () => {
        const mapComponent = await setupFreshMapComponent({
          ...mockConfig,
          show_map: true,
          map_auto_zoom: false,
          map_zoom: 8,
        });

        // Same signal map.ts sets from MapLibre's originalEvent-bearing camera events.
        (mapComponent as unknown as { _userInteractedWithMap: boolean })._userInteractedWithMap = true;
        await mapComponent.updateComplete;

        expect(recenterButton().classList.contains('active')).toBe(false);
        expect(recenterButton().title).to.equal('Recenter map and reset zoom');
      });
    });
  });
  // Every user-visible string has to come from the translation files, and every number has to
  // use the decimal separator of the locale HA is running in.
  describe('Localization', () => {
    const germanHass = (): HomeAssistant => ({ ...mockHass, language: 'de' });

    // Regression test for the error list building `..._entity_entity`, a key that never existed,
    // and falling back to a hard-coded English "Not configured".
    it('names the missing entity with a translated label and a translated placeholder', async () => {
      card.hass = germanHass();
      card.setConfig({ ...mockConfig, distance_entity: 'sensor.nope' });
      await card.updateComplete;

      const text = card.shadowRoot?.querySelector('.error-message')?.textContent ?? '';
      expect(text).to.not.contain('component.blc');
      expect(text).to.contain('Entfernungs-Entität');
      expect(text).to.contain('sensor.nope');
    });

    it('translates the placeholder when the entity is not configured at all', async () => {
      card.hass = germanHass();
      // setConfig rejects a missing required key, so blank it out after the fact.
      card.setConfig({ ...mockConfig });
      (card as unknown as { _config: BlitzortungCardConfig })._config = {
        ...mockConfig,
        distance_entity: '',
      };
      card.requestUpdate();
      await card.updateComplete;

      const text = card.shadowRoot?.querySelector('.error-message')?.textContent ?? '';
      expect(text).to.not.contain('Not configured');
      expect(text).to.contain('Nicht konfiguriert');
    });

    it('localizes the compass accessible name', async () => {
      card.hass = germanHass();
      card.setConfig({ ...mockConfig });
      await card.updateComplete;
      await waitUntil(() => card.shadowRoot?.querySelector('.compass svg'), 'Compass SVG did not render');

      const title = card.shadowRoot?.querySelector('blitzortung-compass title#compass-title');
      expect(title?.textContent?.trim()).to.equal('Kompass zeigt die Blitzrichtung bei 180 Grad (S)');
    });

    it('renders the compass distance with the locale decimal separator', async () => {
      card.hass = germanHass();
      card.setConfig({ ...mockConfig });
      await card.updateComplete;
      await waitUntil(() => card.shadowRoot?.querySelector('.compass svg'), 'Compass SVG did not render');

      const distanceText = card.shadowRoot?.querySelector(
        'blitzortung-compass [data-entity-id="sensor.blitzortung_lightning_distance"] text',
      );
      expect(distanceText?.textContent).to.include('10,0 km');
    });

    it('renders radar grid labels with the locale decimal separator and the unit only once', async () => {
      card.hass = germanHass();
      card.setConfig({ ...mockConfig, lightning_detection_radius: 2, show_grid_labels: true });
      await card.updateComplete;

      const labels = Array.from(
        card.shadowRoot?.querySelector('blitzortung-radar-chart')?.querySelectorAll('.grid-label') ?? [],
      ).map((el) => el.textContent);
      expect(labels).to.deep.equal(['0,5', '1', '1,5', '2 km']);
    });

    // HA has a separate "Number format" profile setting precisely so numbers can be formatted
    // independently of the UI language, so `locale.number_format` has to win over the language.
    describe('Number format setting', () => {
      const hassWith = (language: string, number_format?: NumberFormat): HomeAssistant => ({
        ...mockHass,
        language,
        locale: { language, number_format },
      });

      it('follows the language when number_format is language or unset', () => {
        expect(formatNumber(hassWith('de'), 1234.5, 1, 1)).to.equal('1.234,5');
        expect(formatNumber(hassWith('de', 'language'), 1234.5, 1, 1)).to.equal('1.234,5');
      });

      it('honours comma_decimal on a German UI', () => {
        expect(formatNumber(hassWith('de', 'comma_decimal'), 1234.5, 1, 1)).to.equal('1,234.5');
      });

      it('honours decimal_comma on an English UI', () => {
        expect(formatNumber(hassWith('en', 'decimal_comma'), 1234.5, 1, 1)).to.equal('1.234,5');
      });

      it('honours space_comma', () => {
        const formatted = formatNumber(hassWith('en', 'space_comma'), 1234.5, 1, 1);
        expect(formatted).to.match(/^1\s234,5$/u);
      });

      it('drops localized formatting entirely for none', () => {
        expect(formatNumber(hassWith('de', 'none'), 1234.5, 1, 1)).to.equal('1234.5');
      });

      // Deliberate: HA renders sensor values with grouping separators, and the card follows it.
      it('keeps grouping separators for localized formats', () => {
        expect(formatNumber(hassWith('de'), 1500, 1, 1)).to.equal('1.500,0');
        expect(formatNumber(hassWith('en'), 1500, 1, 1)).to.equal('1,500.0');
      });

      // `hass.language` and `hass.locale.language` can disagree; one convention has to win, or
      // the card renders German labels with English numbers.
      it('resolves labels and numbers through the same language', async () => {
        card.hass = { ...mockHass, language: 'en', locale: { language: 'de' } } as HomeAssistant;
        card.setConfig({ ...mockConfig });
        await card.updateComplete;
        await waitUntil(() => card.shadowRoot?.querySelector('.compass svg'), 'Compass SVG did not render');

        const title = card.shadowRoot?.querySelector('blitzortung-compass title#compass-title');
        expect(title?.textContent?.trim()).to.contain('Kompass');
        const distanceText = card.shadowRoot?.querySelector(
          'blitzortung-compass [data-entity-id="sensor.blitzortung_lightning_distance"] text',
        );
        expect(distanceText?.textContent).to.include('10,0 km');
      });
    });

    it('localizes the strike tooltip numbers', async () => {
      card.hass = germanHass();
      card.setConfig({ ...mockConfig });
      await card.updateComplete;
      await card['_updateStrikes']();

      const strike = card['_strikes'][0]!;
      const content = card['_getStrikeTooltipContent'](strike, 'km');
      const host = await fixture(html`<div>${content}</div>`);
      const text = host.textContent ?? '';
      expect(text).to.match(/\d+,\d/);
      expect(text).to.not.match(/\d+\.\d/);
    });
  });
  // The editor reads this config back out, so a default injected here ended up written into
  // the user's saved YAML.
  describe('Config handling', () => {
    it('does not inject a default card_section_order into the config', () => {
      const config = { ...mockConfig };
      card.setConfig(config);

      expect(card['_config'].card_section_order).toBeUndefined();
      expect(config).to.not.have.property('card_section_order');
    });

    it('still renders every section in the default order without the key', async () => {
      card.setConfig({ ...mockConfig });
      await card.updateComplete;
      await waitUntil(() => card.shadowRoot?.querySelector('blitzortung-map'), 'Map did not render');

      const rendered = Array.from(card.shadowRoot?.querySelectorAll('*') ?? [])
        .map((el) => el.tagName.toLowerCase())
        .filter((tag) => ['blitzortung-compass', 'blitzortung-history-chart', 'blitzortung-map'].includes(tag));
      expect(rendered).to.deep.equal(['blitzortung-compass', 'blitzortung-history-chart', 'blitzortung-map']);
    });

    it('honours an explicit card_section_order', async () => {
      card.setConfig({ ...mockConfig, card_section_order: ['map', 'history_chart', 'compass_radar'] });
      await card.updateComplete;
      await waitUntil(() => card.shadowRoot?.querySelector('blitzortung-map'), 'Map did not render');

      const rendered = Array.from(card.shadowRoot?.querySelectorAll('*') ?? [])
        .map((el) => el.tagName.toLowerCase())
        .filter((tag) => ['blitzortung-compass', 'blitzortung-history-chart', 'blitzortung-map'].includes(tag));
      expect(rendered).to.deep.equal(['blitzortung-map', 'blitzortung-history-chart', 'blitzortung-compass']);
    });
  });

  // A Sections dashboard asks the card how much of the grid it needs; without this it gets a
  // generic default and can be squeezed below the width the map and compass need.
  describe('Sections grid layout', () => {
    // HA lays sections cards out on 56px rows with an 8px gap, so `n` rows are this tall.
    const advertisedHeightPx = (rows: number): number => rows * 56 + (rows - 1) * 8;

    it('advertises grid options derived from the card size', () => {
      card.setConfig({ ...mockConfig });
      const options = card.getGridOptions();

      expect(options.columns).to.equal(12);
      expect(options.min_columns).to.equal(6);
      expect(options.min_rows).to.equal(3);
      // Header + compass/radar + history chart + map = 13 size units = 650px of content, which
      // needs 11 rows (696px). The old halving formula advertised 8 rows (512px) and clipped it.
      expect(card.getCardSize()).to.equal(13);
      expect(options.rows).to.equal(11);
    });

    // The point of the conversion: never advertise less height than the card renders.
    it('advertises at least as many rows as the card size needs in pixels', () => {
      for (const config of [
        { ...mockConfig },
        { ...mockConfig, show_map: false },
        { ...mockConfig, show_history_chart: false },
        { ...mockConfig, show_compass: false },
        { ...mockConfig, show_map: false, show_history_chart: false },
      ]) {
        card.setConfig(config);
        expect(advertisedHeightPx(card.getGridOptions().rows)).to.be.at.least(card.getCardSize() * 50);
      }
    });

    it('shrinks the advertised rows when sections are hidden', () => {
      card.setConfig({ ...mockConfig, show_map: false, show_history_chart: false });

      // Header + compass/radar = 5 size units = 250px, which fits in 5 rows (272px).
      expect(card.getCardSize()).to.equal(5);
      expect(card.getGridOptions().rows).to.equal(5);
    });
  });
  // At the fixed 220x220 viewBox the ring labels used to sit on the north axis, where the
  // outermost one touched the "N" cardinal label and the inner ones stacked on the axis line.
  describe('Radar grid label placement', () => {
    const gridLabels = (c: BlitzortungLightningCard): SVGTextElement[] =>
      Array.from(c.shadowRoot?.querySelector('blitzortung-radar-chart')?.querySelectorAll('.grid-label') ?? []);

    it('offsets the ring labels off the north axis and gives them a halo', async () => {
      card.setConfig({ ...mockConfig, lightning_detection_radius: 100, show_grid_labels: true });
      await card.updateComplete;

      const labels = gridLabels(card);
      expect(labels.length).to.be.greaterThan(0);

      for (const label of labels) {
        const x = parseFloat(label.getAttribute('x') ?? '0');
        const y = parseFloat(label.getAttribute('y') ?? '0');
        // The bearing clockwise from the north axis the label sits on. The bug placed every
        // label straight on that axis (0 degrees); the design bearing is 30, plus a 2px nudge
        // that tilts the innermost rings a little further out. `x > radius * 0.3` passed for
        // any bearing above ~17 degrees and so could not fail.
        const bearingDeg = (Math.atan2(x, -y) * 180) / Math.PI;
        expect(bearingDeg).to.be.within(30, 40);
        expect(label.style.paintOrder).to.equal('stroke');
        expect(label.style.strokeWidth).to.equal('2px');
      }
    });

    it('keeps the outermost ring label clear of the N cardinal label', async () => {
      card.setConfig({ ...mockConfig, lightning_detection_radius: 100, show_grid_labels: true });
      await card.updateComplete;

      const labels = gridLabels(card);
      const outer = labels[labels.length - 1]!;
      const cardinalN = Array.from(
        card.shadowRoot?.querySelector('blitzortung-radar-chart')?.querySelectorAll('.cardinal-label') ?? [],
      ).find((el) => el.textContent === 'N');
      expect(cardinalN, 'no N cardinal label rendered').not.toBeUndefined();

      const dx = parseFloat(outer.getAttribute('x') ?? '0') - parseFloat(cardinalN!.getAttribute('x') ?? '0');
      const dy = parseFloat(outer.getAttribute('y') ?? '0') - parseFloat(cardinalN!.getAttribute('y') ?? '0');
      expect(Math.sqrt(dx * dx + dy * dy)).to.be.greaterThan(20);
    });

    it('removes the labels when show_grid_labels is off', async () => {
      card.setConfig({ ...mockConfig, show_grid_labels: false });
      await card.updateComplete;
      expect(gridLabels(card).length).to.equal(0);
    });
  });
});

// The visual editor had no test coverage at all: the `map_zoom` field, the default-on switch
// logic and the shape of the emitted config were all unverified.
describe('blitzortung-lightning-card-editor', () => {
  interface EditorElement extends HTMLElement {
    hass: HomeAssistant;
    setConfig(config: BlitzortungCardConfig): void;
    updateComplete: Promise<boolean>;
  }

  type WindowWithHelpers = Window & { loadCardHelpers?: () => Promise<unknown> };

  // The real `window.loadCardHelpers`, which `firstUpdated` uses to pre-load HA's own editor
  // elements. Without this the preload throws a synchronous TypeError and only the error path
  // of `firstUpdated` is ever exercised.
  const stubCardHelpers = (loadCardHelpers: () => Promise<unknown>): void => {
    (window as WindowWithHelpers).loadCardHelpers = loadCardHelpers;
  };

  const configElement = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    configElement.mockClear();
    stubCardHelpers(async () => ({
      createCardElement: async () => {
        const element = document.createElement('div');
        (element.constructor as unknown as { getConfigElement?: () => Promise<void> }).getConfigElement = configElement;
        return element;
      },
    }));
  });

  afterEach(() => {
    delete (window as WindowWithHelpers).loadCardHelpers;
  });

  type FieldElement = HTMLElement & { configValue?: string; checked?: boolean; value?: string; type?: string };

  const setupEditor = async (config: BlitzortungCardConfig = mockConfig): Promise<EditorElement> => {
    const editor = (await fixture(
      html`<blitzortung-lightning-card-editor .hass=${mockHass}></blitzortung-lightning-card-editor>`,
    )) as EditorElement;
    editor.setConfig(config);
    await editor.updateComplete;
    return editor;
  };

  const field = (editor: EditorElement, configValue: string): FieldElement | undefined =>
    Array.from(editor.shadowRoot?.querySelectorAll('*') ?? []).find(
      (el) => (el as FieldElement).configValue === configValue,
    ) as FieldElement | undefined;

  const nextConfig = async (editor: EditorElement, act: () => void): Promise<BlitzortungCardConfig> => {
    const emitted = new Promise<BlitzortungCardConfig>((resolve) => {
      editor.addEventListener('config-changed', (e) => resolve((e as CustomEvent).detail.config), { once: true });
    });
    act();
    const config = await emitted;
    await editor.updateComplete;
    return config;
  };

  const toggle = (el: FieldElement, checked: boolean): void => {
    el.checked = checked;
    el.dispatchEvent(new Event('change'));
  };

  // `ha-entities-picker` ships in the `ha-selector-entity` chunk, which only loads when an
  // entity selector renders; a hidden `ha-selector` triggers that import.
  describe('map_person_entities field', () => {
    it('renders the hidden selector, and no hint, while the picker is undefined', async () => {
      expect(customElements.get('ha-entities-picker'), 'test assumes the picker starts undefined').toBeUndefined();
      if (!customElements.get('ha-selector')) customElements.define('ha-selector', class extends HTMLElement {});

      const editor = await setupEditor({ ...mockConfig, show_map: true });
      await waitUntil(() => editor.shadowRoot?.querySelector('ha-selector'), 'loader never rendered');

      expect(editor.shadowRoot?.querySelector('ha-entities-picker')).to.equal(null);
      expect(editor.shadowRoot?.querySelector('ha-selector')?.hasAttribute('hidden')).toBe(true);
      expect(editor.shadowRoot?.textContent).to.not.contain('comes from GPS');
    });

    it('swaps in the picker as soon as it is defined', async () => {
      const editor = await setupEditor({ ...mockConfig, show_map: true });
      expect(editor.shadowRoot?.querySelector('ha-entities-picker')).to.equal(null);

      customElements.define('ha-entities-picker', class extends HTMLElement {});
      await waitUntil(() => editor.shadowRoot?.querySelector('ha-entities-picker'), 'picker never appeared');

      expect(editor.shadowRoot?.querySelector('ha-selector')).to.equal(null);
      expect(editor.shadowRoot?.textContent).to.contain('comes from GPS');
    });
  });

  it('pre-loads HA s editor elements via the card helpers', async () => {
    const editor = await setupEditor();
    await waitUntil(() => configElement.mock.calls.length > 0, 'card helpers were never used');
    expect(editor.shadowRoot?.querySelector('.card-config')).to.not.equal(null);
  });

  // The body must never be gated on the helper preload: both awaits in `firstUpdated` can hang
  // forever (a stalled dynamic import, a third-party card whose `getConfigElement()` never
  // resolves), which would leave a permanently blank config panel with nothing in the console.
  it('renders its body on the first render cycle, without waiting for the card helpers', async () => {
    stubCardHelpers(() => new Promise(() => {}));

    const editor = await setupEditor();

    expect(editor.shadowRoot?.querySelector('.card-config')).to.not.equal(null);
  });

  it('still renders its body when the card helpers are unavailable', async () => {
    delete (window as WindowWithHelpers).loadCardHelpers;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const editor = await setupEditor();

    expect(editor.shadowRoot?.querySelector('.card-config')).to.not.equal(null);
    consoleError.mockRestore();
  });

  it('does not inject the default section order into the config it holds', async () => {
    const editor = await setupEditor();
    const held = (editor as unknown as { _config: BlitzortungCardConfig })._config;
    expect(held.card_section_order).toBeUndefined();
  });

  it('deletes a switch key instead of writing the default back out', async () => {
    const editor = await setupEditor({ ...mockConfig, map_auto_zoom: false, map_zoom: 8 });

    const emitted = await nextConfig(editor, () => toggle(field(editor, 'map_auto_zoom')!, true));

    expect(emitted).to.not.have.property('map_auto_zoom');
    expect(emitted).to.not.have.property('card_section_order');
  });

  // Turning auto-zoom on used to delete `map_zoom`. It still applies with auto-zoom on - it is
  // the zoom the map opens at, and the one it keeps whenever there are no strike bounds to fit -
  // so dropping it silently moved the user's map to the default zoom with no way back.
  it('keeps the configured zoom when auto-zoom is turned back on', async () => {
    const editor = await setupEditor({ ...mockConfig, map_auto_zoom: false, map_zoom: 8 });

    const emitted = await nextConfig(editor, () => toggle(field(editor, 'map_auto_zoom')!, true));

    expect(emitted.map_zoom).to.equal(8);
  });

  it('writes a switch key when it differs from the default', async () => {
    const editor = await setupEditor();

    const emitted = await nextConfig(editor, () => toggle(field(editor, 'map_auto_zoom')!, false));
    expect(emitted.map_auto_zoom).to.equal(false);
    expect(emitted).to.not.have.property('card_section_order');
  });

  it('offers the zoom field with auto-zoom either way, bounded to MapLibre s range', async () => {
    const editor = await setupEditor();

    const zoomField = (): (FieldElement & { min?: number; max?: number }) | undefined =>
      field(editor, 'map_zoom') as (FieldElement & { min?: number; max?: number }) | undefined;

    // Hiding it while auto-zoom is on would make a stored zoom - which still sets the opening
    // view - invisible and uneditable.
    expect(zoomField(), 'zoom field missing while auto-zoom is on').not.toBeUndefined();

    await nextConfig(editor, () => toggle(field(editor, 'map_auto_zoom')!, false));

    expect(zoomField(), 'zoom field missing with auto-zoom off').not.toBeUndefined();
    expect(zoomField()!.type).to.equal('number');
    expect(zoomField()!.min).to.equal(0);
    expect(zoomField()!.max).to.equal(22);
  });

  it('emits the zoom level as a number', async () => {
    const editor = await setupEditor({ ...mockConfig, map_auto_zoom: false });

    const zoomField = field(editor, 'map_zoom')!;
    const emitted = await nextConfig(editor, () => {
      zoomField.value = '8';
      zoomField.dispatchEvent(new Event('input'));
    });

    expect(emitted.map_zoom).to.equal(8);
  });

  // 'auto' is the card's own fallback and is already treated as an empty value, so it must not
  // be written into the YAML - the reason it needs no entry in the editor's defaults table.
  it('drops the map theme mode when it is set back to auto', async () => {
    const editor = await setupEditor({ ...mockConfig, map_theme_mode: 'dark' });

    const themeField = field(editor, 'map_theme_mode')!;
    const emitted = await nextConfig(editor, () => {
      themeField.value = 'auto';
      themeField.dispatchEvent(new Event('selected'));
    });

    expect(emitted).to.not.have.property('map_theme_mode');
  });

  it('removes a default-off switch key when it is turned back off', async () => {
    const editor = await setupEditor({ ...mockConfig, invert_history_direction: true });

    const emitted = await nextConfig(editor, () => toggle(field(editor, 'invert_history_direction')!, false));
    expect(emitted).to.not.have.property('invert_history_direction');
  });
});
