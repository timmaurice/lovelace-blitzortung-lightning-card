import { fixture, html, waitUntil } from '@open-wc/testing';
import { it, describe, beforeEach, vi, expect, Mock, MockedObject } from 'vitest';
import type { Map as LeafletMap } from 'leaflet';
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

// Define a more specific type for the Leaflet mock to avoid 'any'
type LeafletMock = MockedObject<{
  map: Mock;
  tileLayer: Mock;
  layerGroup: Mock;
  divIcon: Mock;
  marker: Mock;
  LatLngBounds: unknown;
  latLngBounds: Mock;
  DomUtil: {
    create: () => HTMLDivElement;
    addClass: Mock;
    removeClass: Mock;
  };
  DomEvent: { on: Mock; stop: Mock };
  Control: { extend: Mock };
}>;

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
  },
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

      const pointer = compassComponent?.querySelector('.compass-pointer path');
      expect(pointer?.getAttribute('fill')).to.equal('rgb(255, 255, 0)');

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
    let leafletMock: LeafletMock;
    let mapInstanceMock: Partial<LeafletMap> & { [key: string]: Mock };

    // A mock class for LatLngBounds to allow `instanceof` checks to pass.
    class MockLatLngBounds {
      _extended = false;
      extend() {
        this._extended = true;
      }
      isValid() {
        return this._extended;
      }
      getNorthEast() {
        return { equals: () => false };
      }
      getSouthWest() {
        return { equals: () => false };
      }
    }

    const setupMapComponent = async (config: BlitzortungCardConfig): Promise<BlitzortungMap> => {
      card.setConfig(config);
      await card.updateComplete;

      await waitUntil(() => card.shadowRoot?.querySelector('blitzortung-map'), 'Map component did not render');
      const mapComponent = card.shadowRoot?.querySelector('blitzortung-map') as BlitzortungMap;

      // Mock leaflet for this specific instance
      Object.defineProperty(mapComponent, '_getLeaflet', {
        // The mock needs to both return the mock object AND set it on the component instance
        // to replicate the behavior of the original method.
        value: vi.fn().mockImplementation(function (this: BlitzortungMap) {
          (this as any)._leaflet = leafletMock;
          return Promise.resolve(leafletMock);
        }),
        configurable: true, // Allow re-definition in subsequent tests
      });

      // Re-initialize the map within the component to use the mock
      (mapComponent as unknown as { _destroyMap: () => void })._destroyMap();
      await (mapComponent as unknown as { _initMap: () => Promise<void> })._initMap();
      await mapComponent.updateComplete;

      return mapComponent;
    };

    beforeEach(async () => {
      // Create a fresh, robust mock for each test to ensure isolation
      mapInstanceMock = {
        addControl: vi.fn(),
        on: vi.fn().mockReturnThis(),
        once: vi.fn().mockReturnThis(),
        addLayer: vi.fn(),
        getContainer: vi.fn(() => document.createElement('div')),
        invalidateSize: vi.fn().mockReturnThis(),
        remove: vi.fn().mockReturnThis(),
        fitBounds: vi.fn().mockReturnThis(),
        getZoom: vi.fn(() => 10),
        setView: vi.fn(),
      };

      // Mock leaflet to spy on tileLayer calls and other Leaflet functions
      const markerInstanceMock = {
        on: vi.fn(),
        addTo: vi.fn(),
        getLatLng: vi.fn(() => [52.52, 13.38]),
        setLatLng: vi.fn(),
        setZIndexOffset: vi.fn(),
        setOpacity: vi.fn(),
        getElement: () => ({
          classList: {
            add: vi.fn(),
            remove: vi.fn(),
          },
        }),
      };
      markerInstanceMock.addTo.mockReturnValue(markerInstanceMock);

      leafletMock = {
        map: vi.fn().mockReturnValue(mapInstanceMock),
        tileLayer: vi.fn().mockReturnValue({ addTo: vi.fn().mockReturnThis() }),
        layerGroup: vi.fn().mockReturnValue({ addTo: vi.fn().mockReturnThis(), removeLayer: vi.fn() }),
        divIcon: vi.fn(),
        marker: vi.fn().mockReturnValue(markerInstanceMock),
        LatLngBounds: MockLatLngBounds,
        latLngBounds: vi.fn().mockImplementation(() => new MockLatLngBounds()),
        DomUtil: {
          create: () => document.createElement('div'),
          addClass: vi.fn(),
          removeClass: vi.fn(),
        },
        DomEvent: {
          on: vi.fn(),
          stop: vi.fn(),
        },
        Control: {
          extend: vi.fn().mockImplementation(
            (options) =>
              function (this: unknown) {
                (this as any).options = options.options;

                (this as any).onAdd = options.onAdd;

                (this as any).addTo = vi.fn();
              },
          ),
        },
      };
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
      await waitUntil(() => leafletMock.tileLayer.mock.calls.length > 0, 'L.tileLayer was not called');
      expect(leafletMock.tileLayer).toHaveBeenCalledWith(expect.stringContaining('dark_all'), expect.any(Object));
    });

    it('should use light theme when map_theme_mode is light', async () => {
      await setupMapComponent({ ...mockConfig, show_map: true, map_theme_mode: 'light' });
      await waitUntil(() => leafletMock.tileLayer.mock.calls.length > 0, 'L.tileLayer was not called');
      expect(leafletMock.tileLayer).toHaveBeenCalledWith(
        expect.stringContaining('openstreetmap.org'),
        expect.any(Object),
      );
    });

    it('should follow HA theme when map_theme_mode is auto (dark)', async () => {
      card.hass = { ...mockHass, themes: { ...mockHass.themes, darkMode: true } };
      await setupMapComponent({ ...mockConfig, show_map: true, map_theme_mode: 'auto' });
      await waitUntil(() => leafletMock.tileLayer.mock.calls.length > 0, 'L.tileLayer was not called');
      expect(leafletMock.tileLayer).toHaveBeenCalledWith(expect.stringContaining('dark_all'), expect.any(Object));
    });

    it('should follow HA theme when map_theme_mode is auto (light)', async () => {
      card.hass = { ...mockHass, themes: { ...mockHass.themes, darkMode: false } };
      await setupMapComponent({ ...mockConfig, show_map: true, map_theme_mode: 'auto' });
      await waitUntil(() => leafletMock.tileLayer.mock.calls.length > 0, 'L.tileLayer was not called');
      expect(leafletMock.tileLayer).toHaveBeenCalledWith(
        expect.stringContaining('openstreetmap.org'),
        expect.any(Object),
      );
    });
  });
});
