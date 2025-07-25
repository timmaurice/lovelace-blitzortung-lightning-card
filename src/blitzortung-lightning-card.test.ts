import { fixture, html, expect, waitUntil } from '@open-wc/testing';
import { it, describe, beforeEach, vi } from 'vitest';
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
      state: '12.3',
      attributes: { unit_of_measurement: 'km' },
      last_changed: new Date(now - 1000 * 60).toISOString(),
      last_updated: new Date(now - 1000 * 60).toISOString(),
    },
    'sensor.blitzortung_lightning_counter': {
      entity_id: 'sensor.blitzortung_lightning_counter',
      state: '5',
      attributes: {},
      last_changed: new Date(now - 1000 * 60 * 5).toISOString(),
      last_updated: new Date(now - 1000 * 60 * 5).toISOString(),
    },
    'sensor.blitzortung_lightning_azimuth': {
      entity_id: 'sensor.blitzortung_lightning_azimuth',
      state: '180',
      attributes: {},
      last_changed: new Date(now - 1000 * 60).toISOString(),
      last_updated: new Date(now - 1000 * 60).toISOString(),
    },
    // Add geo_location entities for radar and map
    'geo_location.lightning_strike_1': {
      entity_id: 'geo_location.lightning_strike_1',
      state: '12.3',
      attributes: {
        source: 'blitzortung',
        latitude: 52.4,
        longitude: 13.38,
        publication_date: new Date(now - 1000 * 60).toISOString(), // 1 minute ago
      },
    },
    'geo_location.lightning_strike_2': {
      entity_id: 'geo_location.lightning_strike_2',
      state: '25.5',
      attributes: {
        source: 'blitzortung',
        latitude: 52.6,
        longitude: 13.5,
        publication_date: new Date(now - 1000 * 60 * 5).toISOString(), // 5 minutes ago
      },
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
      { state: '3', last_changed: new Date(now - 1000 * 60 * 20).toISOString() },
      { state: '5', last_changed: new Date(now - 1000 * 60 * 5).toISOString() },
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
 * Helper function to create a mock HomeAssistant object with a specific
 * return value for the `callApi` function.
 */
const createHassWithApiMock = (apiReturnValue: unknown) => ({
  ...mockHass,
  callApi: vi.fn().mockResolvedValue(apiReturnValue),
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
      expect(strikeDots?.length).to.be.greaterThan(0);
    });

    // Test case for the scenario where there are no recent lightning strikes.
    // It verifies that the "No strikes" message is displayed.
    it('displays "No strikes" message when there are no strikes and not in edit mode', async () => {
      // This custom `hass` object simulates a "no strike" scenario.
      // The `geo_location` entities are removed to mimic their absence from Home Assistant's state machine.
      // This is crucial for testing the card's behavior when no data is available, ensuring it fails gracefully.
      const noStrikeHass: HomeAssistant = {
        ...mockHass,
        states: {
          'sensor.blitzortung_lightning_distance': {
            ...mockHass.states['sensor.blitzortung_lightning_distance'],
            state: 'N/A', // Or any other value indicating no strike
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
      };
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
      expect(countText?.textContent).to.include('5 ⚡');

      const azimuthText = card.shadowRoot?.querySelector(
        '[data-entity-id="sensor.blitzortung_lightning_azimuth"] text',
      );
      expect(azimuthText?.textContent).to.include('180° S');

      const distanceText = card.shadowRoot?.querySelector(
        '[data-entity-id="sensor.blitzortung_lightning_distance"] text',
      );
      expect(distanceText?.textContent).to.include('12.3 km');
    });

    it('does not render if azimuth is not a number', async () => {
      const invalidHass = {
        ...mockHass,
        states: {
          ...mockHass.states,
          'sensor.blitzortung_lightning_azimuth': {
            ...mockHass.states['sensor.blitzortung_lightning_azimuth'],
            state: 'invalid',
          },
        },
      };
      card.hass = invalidHass;
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
      card.hass = {
        ...mockHass,
        callApi: vi.fn().mockRejectedValue(new Error('API Error')),
      };

      await card['_updateLastStrikeTime']();

      expect(card['_lastStrikeFromHistory']).to.deep.equal(lastChangedTime);

      consoleErrorSpy.mockRestore();
    });
  });
});
