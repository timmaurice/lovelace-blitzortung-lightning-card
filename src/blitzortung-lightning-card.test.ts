import { fixture, html, waitUntil } from '@open-wc/testing';
import { it, describe, beforeEach, vi, expect } from 'vitest';
import './blitzortung-lightning-card';
import { BlitzortungCardConfig, HomeAssistant } from './types';
import { BlitzortungLightningCard } from './blitzortung-lightning-card';

// Add a type for the ha-card element to avoid using 'any'
interface HaCard extends HTMLElement {
  header?: string;
}

const now = Date.now();

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
};

/**
 * `mockConfig` provides a basic, valid configuration for the card.
 * Tests can extend this configuration to test specific features
 * like the title, map, or history chart.
 */
const mockConfig: BlitzortungCardConfig = {
  type: 'custom:blitzortung-lightning-card',
  distance: 'sensor.blitzortung_lightning_distance',
  counter: 'sensor.blitzortung_lightning_counter',
  azimuth: 'sensor.blitzortung_lightning_azimuth',
};

/**
 * `noStrikeHass` simulates a scenario where no lightning strikes are present.
 * The geo_location entities are absent, and the counter is at 0.
 */
const noStrikeHass: HomeAssistant = {
  ...mockHass,
  states: {
    'sensor.blitzortung_lightning_distance': {
      ...mockHass.states['sensor.blitzortung_lightning_distance'],
      state: 'N/A',
    },
    'sensor.blitzortung_lightning_counter': {
      ...mockHass.states['sensor.blitzortung_lightning_counter'],
      state: '0',
    },
    'sensor.blitzortung_lightning_azimuth': {
      ...mockHass.states['sensor.blitzortung_lightning_azimuth'],
      state: 'N/A',
    },
  },
  callApi: vi.fn().mockResolvedValue([[]]), // No history for strikes
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
 * Helper function to create a mock HomeAssistant object with a specific
 * return value for the `callApi` function.
 */
const createHassWithApiMock = (apiReturnValue: unknown) => ({
  ...mockHass,
  callApi: vi.fn().mockResolvedValue(apiReturnValue),
});

/**
 * Helper function to create a mock HomeAssistant object with a rejected
 * return value for the `callApi` function.
 */
const createHassWithRejectedApi = (error: Error) => ({
  ...mockHass,
  callApi: vi.fn().mockRejectedValue(error),
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
      expect(radarSvg).to.be.an.instanceof(SVGElement);
      // Check for strike dots
      const strikeDots = radarSvg?.querySelectorAll('.strike-dot');
      expect(strikeDots?.length).to.equal(2); // Default period is 30m
    });

    // Test case for the scenario where there are no recent lightning strikes.
    // It verifies that the "No strikes" message is displayed.
    it('displays "No strikes" message when there are no strikes and not in edit mode', async () => {
      card.hass = noStrikeHass;
      await card.updateComplete;
      await waitUntil(() => card.shadowRoot?.querySelector('.no-strikes-message'), 'No strikes message did not render');
    });
  });

  describe('Compass', () => {
    it('renders with correct data from hass states', async () => {
      await waitUntil(() => card.shadowRoot?.querySelector('.compass svg'), 'Compass SVG did not render');

      const compassSvg = card.shadowRoot?.querySelector('.compass svg');
      expect(compassSvg).to.be.an.instanceof(SVGElement);
      const countText = card.shadowRoot?.querySelector('[data-entity-id="sensor.blitzortung_lightning_counter"] text');
      expect(countText?.textContent).to.include('3 ⚡');

      const azimuthText = card.shadowRoot?.querySelector(
        '[data-entity-id="sensor.blitzortung_lightning_azimuth"] text',
      );
      expect(azimuthText?.textContent).to.include('180° S');

      const distanceText = card.shadowRoot?.querySelector(
        '[data-entity-id="sensor.blitzortung_lightning_distance"] text',
      );
      expect(distanceText?.textContent).to.include('10.0 km');
    });

    it('does not render if azimuth is not a number', async () => {
      card.hass = createHassWithStateOverrides({
        'sensor.blitzortung_lightning_azimuth': {
          ...mockHass.states['sensor.blitzortung_lightning_azimuth'],
          state: 'invalid',
        },
      });
      await card.updateComplete;

      const compass = card.shadowRoot?.querySelector('.compass');
      expect(compass).to.equal(null);
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

      const gridCircle = card.shadowRoot?.querySelector('.compass svg circle');
      expect(gridCircle?.getAttribute('stroke')).to.equal('rgb(0, 0, 255)');

      const pointer = card.shadowRoot?.querySelector('.compass-pointer path');
      expect(pointer?.getAttribute('fill')).to.equal('rgb(255, 255, 0)');

      const textElement = card.shadowRoot?.querySelector('.compass svg a text');
      expect(textElement?.getAttribute('fill')).to.equal('rgb(0, 255, 0)');
    });

    it('rotates the pointer to the correct angle', async () => {
      await waitUntil(() => card.shadowRoot?.querySelector('.compass-pointer'), 'Compass pointer did not render');
      const pointerGroup = card.shadowRoot?.querySelector('.compass-pointer') as HTMLElement;
      expect(pointerGroup.style.transform).to.equal('rotate(180deg)');
    });

    it('rotates the pointer the shortest way (e.g. 359deg to 1deg)', async () => {
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

    it('rotates the pointer the shortest way (e.g. 1deg to 359deg)', async () => {
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
  });

  describe('Data Handling', () => {
    describe('_getRecentStrikes', () => {
      it('should filter strikes based on the default radar_period (30m)', () => {
        card.setConfig(mockConfig);
        const recentStrikes = card['_getRecentStrikes']();
        expect(recentStrikes.length).to.equal(2); // 10m and 20m old
      });

      it('should filter strikes for radar_period: 15m', () => {
        card.setConfig({ ...mockConfig, radar_period: '15m' });
        const recentStrikes = card['_getRecentStrikes']();
        expect(recentStrikes.length).to.equal(1); // 10m old
      });

      it('should filter strikes for radar_period: 30m', () => {
        card.setConfig({ ...mockConfig, radar_period: '30m' });
        const recentStrikes = card['_getRecentStrikes']();
        expect(recentStrikes.length).to.equal(2); // 10m and 20m old
      });

      it('should filter strikes for radar_period: 1h', () => {
        card.setConfig({ ...mockConfig, radar_period: '1h' });
        const recentStrikes = card['_getRecentStrikes']();
        expect(recentStrikes.length).to.equal(3); // 10m, 20m, and 40m old
      });
    });
  });

  describe('Radar Chart', () => {
    it('should auto-scale the max distance when auto_radar_max_distance is true', async () => {
      card.setConfig({ ...mockConfig, auto_radar_max_distance: true, radar_period: '1h' });
      await card.updateComplete;

      // The 40km strike is the furthest. With auto-scaling, maxDistance will be 40.
      // The rScale domain will be [0, 40], and range [0, 90].
      // The 40km strike should be plotted at a radius of 90.
      const strikeDots = card.shadowRoot?.querySelectorAll('.strike-dot');
      const furthestStrikeDot = strikeDots?.[2]; // 40km strike is the 3rd newest
      const cx = parseFloat(furthestStrikeDot?.getAttribute('cx') || '0');
      const cy = parseFloat(furthestStrikeDot?.getAttribute('cy') || '0');
      const r = Math.sqrt(cx * cx + cy * cy);
      expect(r).to.be.closeTo(90, 0.1);
    });

    it('should use radar_max_distance when auto-scaling is false', async () => {
      card.setConfig({ ...mockConfig, radar_max_distance: 150, radar_period: '1h' });
      await card.updateComplete;

      // The 40km strike should be at r = 90 * (40/150) = 24
      const strikeDots = card.shadowRoot?.querySelectorAll('.strike-dot');
      const thirdStrikeDot = strikeDots?.[2]; // 40km strike is the 3rd newest
      const cx = parseFloat(thirdStrikeDot?.getAttribute('cx') || '0');
      const cy = parseFloat(thirdStrikeDot?.getAttribute('cy') || '0');
      const r = Math.sqrt(cx * cx + cy * cy);
      expect(r).to.be.closeTo(90 * (40 / 150), 0.1);
    });
  });

  describe('History Chart', () => {
    it('renders when enabled', async () => {
      card.setConfig({ ...mockConfig, show_history_chart: true });
      await card.updateComplete;

      await waitUntil(() => card.shadowRoot?.querySelector('.history-chart svg'), 'History chart SVG did not render');
      const historySvg = card.shadowRoot?.querySelector('.history-chart svg');
      expect(historySvg).to.be.an.instanceof(SVGElement);
      const bars = historySvg?.querySelectorAll('.bar');
      expect(bars?.length).to.be.greaterThan(0);
    });

    it('does not render when disabled', async () => {
      card.setConfig({ ...mockConfig, show_history_chart: false });
      await card.updateComplete;
      const historyChart = card.shadowRoot?.querySelector('.history-chart');
      expect(historyChart).to.equal(null);
    });
  });

  describe('Map', () => {
    let leafletMock;
    const mapInstanceMock = {
      addControl: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      addLayer: vi.fn(),
      getContainer: () => document.createElement('div'),
      invalidateSize: vi.fn(),
      remove: vi.fn(),
    };

    beforeEach(async () => {
      // Mock leaflet to spy on tileLayer calls
      leafletMock = {
        map: vi.fn().mockReturnValue(mapInstanceMock),
        tileLayer: vi.fn().mockReturnValue({ addTo: vi.fn() }),
        layerGroup: vi.fn().mockReturnValue({ addTo: vi.fn() }),
        divIcon: vi.fn(),
        marker: vi.fn().mockReturnValue({ on: vi.fn(), addTo: vi.fn() }),
        latLngBounds: vi.fn().mockReturnValue({ isValid: () => true, extend: vi.fn() }),
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
            () =>
              function () {
                return { onAdd: () => document.createElement('div'), addTo: vi.fn() };
              },
          ),
        },
      };
      // This is a private method, but we need to mock its dependency for testing
      Object.defineProperty(card, '_getLeaflet', {
        value: vi.fn().mockResolvedValue(leafletMock),
      });
    });

    it('renders when enabled', async () => {
      card.setConfig({ ...mockConfig, show_map: true });
      await card.updateComplete;
      await waitUntil(() => card.shadowRoot?.querySelector('.leaflet-map'), 'Map container did not render');
      const mapContainer = card.shadowRoot?.querySelector('.leaflet-map');
      expect(mapContainer).not.to.equal(null);
    });

    it('does not render when disabled', async () => {
      card.setConfig({ ...mockConfig, show_map: false });
      await card.updateComplete;
      const mapContainer = card.shadowRoot?.querySelector('.leaflet-map');
      expect(mapContainer).to.equal(null);
    });

    it('should use dark theme when map_theme_mode is dark', async () => {
      card.setConfig({ ...mockConfig, show_map: true, map_theme_mode: 'dark' });
      await card.updateComplete;
      await waitUntil(() => leafletMock.tileLayer.mock.calls.length > 0, 'L.tileLayer was not called');
      expect(leafletMock.tileLayer).toHaveBeenCalledWith(expect.stringContaining('dark_all'), expect.any(Object));
    });

    it('should use light theme when map_theme_mode is light', async () => {
      card.setConfig({ ...mockConfig, show_map: true, map_theme_mode: 'light' });
      await card.updateComplete;
      await waitUntil(() => leafletMock.tileLayer.mock.calls.length > 0, 'L.tileLayer was not called');
      expect(leafletMock.tileLayer).toHaveBeenCalledWith(
        expect.stringContaining('openstreetmap.org'),
        expect.any(Object),
      );
    });

    it('should follow HA theme when map_theme_mode is auto (dark)', async () => {
      card.hass = { ...mockHass, themes: { ...mockHass.themes, darkMode: true } };
      card.setConfig({ ...mockConfig, show_map: true, map_theme_mode: 'auto' });
      await card.updateComplete;
      await waitUntil(() => leafletMock.tileLayer.mock.calls.length > 0, 'L.tileLayer was not called');
      expect(leafletMock.tileLayer).toHaveBeenCalledWith(expect.stringContaining('dark_all'), expect.any(Object));
    });

    it('should follow HA theme when map_theme_mode is auto (light)', async () => {
      card.hass = { ...mockHass, themes: { ...mockHass.themes, darkMode: false } };
      card.setConfig({ ...mockConfig, show_map: true, map_theme_mode: 'auto' });
      await card.updateComplete;
      await waitUntil(() => leafletMock.tileLayer.mock.calls.length > 0, 'L.tileLayer was not called');
      expect(leafletMock.tileLayer).toHaveBeenCalledWith(
        expect.stringContaining('openstreetmap.org'),
        expect.any(Object),
      );
    });
  });

  describe('_updateLastStrikeTime', () => {
    it('should set _lastStrikeFromHistory to the timestamp of the last counter increase', async () => {
      const lastStrikeTime = new Date(now - 1000 * 60 * 5);
      const mockHistory = [
        [
          { state: '3', last_changed: new Date(now - 1000 * 60 * 20).toISOString() },
          { state: '2', last_changed: new Date(now - 1000 * 60 * 10).toISOString() }, // A decrease
          { state: '5', last_changed: lastStrikeTime.toISOString() }, // The last increase
        ],
      ];
      card.hass = createHassWithApiMock(mockHistory);

      await card['_updateLastStrikeTime']();

      expect(card['_lastStrikeFromHistory']).to.deep.equal(lastStrikeTime);
    });

    it('should fall back to last_changed when history has no increase', async () => {
      const lastChangedTime = new Date(mockHass.states['sensor.blitzortung_lightning_counter'].last_changed);
      const mockHistory = [
        [
          { state: '5', last_changed: new Date(now - 1000 * 60 * 20).toISOString() },
          { state: '4', last_changed: new Date(now - 1000 * 60 * 10).toISOString() },
          { state: '4', last_changed: new Date(now - 1000 * 60 * 5).toISOString() },
        ],
      ];
      card.hass = createHassWithApiMock(mockHistory);

      await card['_updateLastStrikeTime']();

      expect(card['_lastStrikeFromHistory']).to.deep.equal(lastChangedTime);
    });

    it('should fall back to last_changed when history is empty', async () => {
      const lastChangedTime = new Date(mockHass.states['sensor.blitzortung_lightning_counter'].last_changed);
      card.hass = createHassWithApiMock([[]]);

      await card['_updateLastStrikeTime']();

      expect(card['_lastStrikeFromHistory']).to.deep.equal(lastChangedTime);
    });

    it('should use the timestamp from history if it has only one entry', async () => {
      const historyTime = new Date(now - 1000 * 60 * 5);
      const mockHistory = [[{ state: '5', last_changed: historyTime.toISOString() }]];
      card.hass = createHassWithApiMock(mockHistory);

      await card['_updateLastStrikeTime']();

      expect(card['_lastStrikeFromHistory']).to.deep.equal(historyTime);
    });

    it('should fall back to last_changed on API error', async () => {
      // Spy on console.error to prevent it from polluting the test output.
      // We expect an error to be logged in this case, so this is fine.
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const lastChangedTime = new Date(mockHass.states['sensor.blitzortung_lightning_counter'].last_changed);
      card.hass = createHassWithRejectedApi(new Error('API Error'));

      await card['_updateLastStrikeTime']();

      expect(card['_lastStrikeFromHistory']).to.deep.equal(lastChangedTime);

      consoleErrorSpy.mockRestore();
    });
  });
});
