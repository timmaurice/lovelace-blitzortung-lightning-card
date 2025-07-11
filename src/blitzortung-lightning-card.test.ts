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

const mockHass: HomeAssistant = {
  states: {
    'sensor.blitzortung_lightning_distance': {
      entity_id: 'sensor.blitzortung_lightning_distance',
      state: '12.3',
      attributes: { unit_of_measurement: 'km' },
    },
    'sensor.blitzortung_lightning_counter': {
      entity_id: 'sensor.blitzortung_lightning_counter',
      state: '5',
      attributes: {},
    },
    'sensor.blitzortung_lightning_azimuth': {
      entity_id: 'sensor.blitzortung_lightning_azimuth',
      state: '180',
      attributes: {},
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

const mockConfig: BlitzortungCardConfig = {
  type: 'custom:blitzortung-lightning-card',
  distance: 'sensor.blitzortung_lightning_distance',
  count: 'sensor.blitzortung_lightning_counter',
  azimuth: 'sensor.blitzortung_lightning_azimuth',
};

describe('blitzortung-lightning-card', () => {
  let card: BlitzortungLightningCard;

  beforeEach(async () => {
    card = await fixture(html`<blitzortung-lightning-card .hass=${mockHass}></blitzortung-lightning-card>`);
    card.setConfig(mockConfig);
    await card.updateComplete;
  });

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

  it('renders the radar chart', async () => {
    await waitUntil(() => card.shadowRoot?.querySelector('.radar-chart svg'), 'Radar chart SVG did not render');
    const radarSvg = card.shadowRoot?.querySelector('.radar-chart svg');
    expect(radarSvg).to.be.an.instanceof(SVGElement);
    // Check for strike dots
    const strikeDots = radarSvg?.querySelectorAll('.strike-dot');
    expect(strikeDots?.length).to.be.greaterThan(0);
  });

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

  it('does not render the history chart when disabled', async () => {
    card.setConfig({
      ...mockConfig,
      show_history_chart: false,
    });
    await card.updateComplete;
    const historyChart = card.shadowRoot?.querySelector('.history-chart');
    expect(historyChart).to.equal(null);
  });

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

  it('does not render the map when disabled', async () => {
    card.setConfig({
      ...mockConfig,
      show_map: false,
    });
    await card.updateComplete;
    const mapContainer = card.shadowRoot?.querySelector('.leaflet-map');
    expect(mapContainer).to.equal(null);
  });
});
