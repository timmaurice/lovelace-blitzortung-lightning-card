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
    card.setConfig(mockConfig);
    await card.updateComplete;
  });

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

  // Test case to ensure the compass component renders with the correct data from `mockHass`.
  it('renders compass with correct data', async () => {
    await waitUntil(() => card.shadowRoot?.querySelector('.compass svg'), 'Compass SVG did not render');

    const compassSvg = card.shadowRoot?.querySelector('.compass svg');
    expect(compassSvg).to.be.an.instanceof(SVGElement);
    const countText = card.shadowRoot?.querySelector('[data-entity-id="sensor.blitzortung_lightning_counter"] text');
    expect(countText?.textContent).to.include('5 ⚡');

    const azimuthText = card.shadowRoot?.querySelector('[data-entity-id="sensor.blitzortung_lightning_azimuth"] text');
    expect(azimuthText?.textContent).to.include('180° S');

    const distanceText = card.shadowRoot?.querySelector(
      '[data-entity-id="sensor.blitzortung_lightning_distance"] text',
    );
    expect(distanceText?.textContent).to.include('12.3 km');
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

  // Test case to verify that the history chart is rendered when `show_history_chart` is true.
  it('renders the history chart when enabled', async () => {
    card.setConfig({
      ...mockConfig,
      show_history_chart: true,
    });
    await card.updateComplete;

    await waitUntil(() => card.shadowRoot?.querySelector('.history-chart svg'), 'History chart SVG did not render');
    const historySvg = card.shadowRoot?.querySelector('.history-chart svg');
    expect(historySvg).to.be.an.instanceof(SVGElement);
    // Check for bars
    const bars = historySvg?.querySelectorAll('.bar');
    expect(bars?.length).to.be.greaterThan(0);
  });

  // Test case to ensure the history chart is not rendered when `show_history_chart` is false.
  it('does not render the history chart when disabled', async () => {
    card.setConfig({
      ...mockConfig,
      show_history_chart: false,
    });
    await card.updateComplete;
    const historyChart = card.shadowRoot?.querySelector('.history-chart');
    expect(historyChart).to.equal(null);
  });

  // Test case to check if the map container is rendered when `show_map` is true.
  it('renders the map when enabled', async () => {
    card.setConfig({
      ...mockConfig,
      show_map: true,
    });
    await card.updateComplete;
    // The map initializes asynchronously, so we wait for it
    await waitUntil(() => card.shadowRoot?.querySelector('.leaflet-map'), 'Map container did not render');
    const mapContainer = card.shadowRoot?.querySelector('.leaflet-map');
    expect(mapContainer).not.to.equal(null);
  });

  // Test case to ensure the map is not rendered when `show_map` is false.
  it('does not render the map when disabled', async () => {
    card.setConfig({
      ...mockConfig,
      show_map: false,
    });
    await card.updateComplete;
    const mapContainer = card.shadowRoot?.querySelector('.leaflet-map');
    expect(mapContainer).to.equal(null);
  });

  // Test case for the scenario where there are no recent lightning strikes.
  // It verifies that the "No strikes" message is displayed.
  it('displays "No strikes" message when there are no strikes and not in edit mode', async () => {
    // This custom `hass` object simulates a "no strike" scenario.
    // The main sensor states are set to 'N/A' or '0', and the `geo_location`
    // entities are set to `undefined` to mimic their absence from Home Assistant's state machine.
    // This is crucial for testing the card's behavior when no data is available, ensuring it fails gracefully.
    const noStrikeHass: HomeAssistant = {
      ...mockHass,
      states: {
        ...mockHass.states,
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
        // The `geo_location` entities are explicitly set to undefined to simulate their absence.
        'geo_location.lightning_strike_1': undefined,
        'geo_location.lightning_strike_2': undefined,
      },
    };
    const noStrikeCard = await fixture<BlitzortungLightningCard>(
      html`<blitzortung-lightning-card .hass=${noStrikeHass}></blitzortung-lightning-card>`,
    );
    noStrikeCard.setConfig(mockConfig);
    await waitUntil(
      () => noStrikeCard.shadowRoot?.querySelector('.no-strikes-message'),
      'No strikes message did not render',
    );
  });
});
