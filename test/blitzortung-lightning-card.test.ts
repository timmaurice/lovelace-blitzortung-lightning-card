import { fixture, html, waitUntil } from '@open-wc/testing';
import { it, describe, beforeEach, vi, expect } from 'vitest';
import '../src/blitzortung-lightning-card';
import { BlitzortungCardConfig, HomeAssistant } from '../src/types';
import { BlitzortungHistoryChart } from '../src/components/history-chart';
import { BlitzortungMap } from '../src/components/map';
import { BlitzortungLightningCard } from '../src/blitzortung-lightning-card';

// Add a type for the ha-card element to avoid using 'any'
interface HaCard extends HTMLElement {
  header?: string;
}

const now = Date.now();

// `maplibre-gl` is module-mocked (vi.hoisted, since vi.mock's factory is hoisted above these
// imports) rather than per-instance: `connectedCallback` fires a real `import('maplibre-gl')`
// synchronously on mount, which a later per-instance mock can't win the race against — and
// unlike Leaflet, MapLibre needs a real WebGL context, so that reliably crashes in jsdom.
const { maplibreMock, mapInstanceMock, createMarkerInstanceMock } = vi.hoisted(() => {
  // Mimics `_autoZoomMap`'s isEmpty/NE/SW checks closely enough for `new maplibregl.LngLatBounds()`.
  class MockLngLatBounds {
    private _extended = false;
    extend() {
      this._extended = true;
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

  const mapInstanceMock = {
    // Real MapLibre calls onAdd() on add, which is what builds the recenter button; without
    // it `_recenterButton` stays undefined and every button-state update silently no-ops.
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
  };

  return { maplibreMock, mapInstanceMock, createMarkerInstanceMock };
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

    beforeEach(() => {
      // The mocked module (vi.mock below) is only evaluated once for the whole file, so reset
      // call history/implementations between tests instead of recreating the mocks.
      mapInstanceMock.addControl.mockClear();
      mapInstanceMock.on.mockClear();
      mapInstanceMock.once.mockClear();
      mapInstanceMock.off.mockClear();
      mapInstanceMock.getContainer.mockClear().mockImplementation(() => document.createElement('div'));
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
    });

    it('renders when enabled', async () => {
      const mapComponent = await setupMapComponent({ ...mockConfig, show_map: true });
      const mapContainer = mapComponent.shadowRoot?.querySelector('#map-container');
      expect(mapContainer).not.to.equal(null);
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
          .map((call) => call[0] as { onAdd?: () => HTMLElement; getLink?: () => HTMLAnchorElement | undefined })
          .find((candidate) => typeof candidate?.onAdd === 'function' && typeof candidate?.getLink === 'function');
        expect(control, 'recenter control was not added to the map').not.toBeUndefined();
        const link = control!.getLink!();
        expect(link, 'recenter control did not expose its button').not.toBeUndefined();
        return link!;
      };

      const clickRecenter = (): void => recenterButton().click();

      it('fits the view to the strikes by default', async () => {
        await setupFreshMapComponent({ ...mockConfig, show_map: true });

        await waitUntil(() => mapInstanceMock.fitBounds.mock.calls.length > 0, 'Map never fit to the strikes');
        expect(maplibreMock.Map.mock.calls[0][0].zoom).to.equal(13);
      });

      it('opens at map_zoom and never fits to strikes when map_auto_zoom is false', async () => {
        await setupFreshMapComponent({ ...mockConfig, show_map: true, map_auto_zoom: false, map_zoom: 8 });

        expect(maplibreMock.Map.mock.calls[0][0].zoom).to.equal(8);
        // Home is still settled on once, since homeCoords can resolve after the map was built.
        await waitUntil(() => mapInstanceMock.jumpTo.mock.calls.length > 0, 'Map never centred on home');
        expect(mapInstanceMock.jumpTo).toHaveBeenCalledWith({ center: HOME, zoom: 8 });
        expect(mapInstanceMock.fitBounds).not.toHaveBeenCalled();
      });

      it('clamps map_zoom to the range MapLibre accepts', async () => {
        await setupFreshMapComponent({ ...mockConfig, show_map: true, map_auto_zoom: false, map_zoom: 99 });

        expect(maplibreMock.Map.mock.calls[0][0].zoom).to.equal(24);
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
});
