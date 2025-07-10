import { fixture, html, expect, waitUntil } from '@open-wc/testing';
import { it, describe, beforeEach, vi } from 'vitest';
import './blitzortung-lightning-card';
import { BlitzortungCardConfig, HomeAssistant } from './types';
import { BlitzortungLightningCard } from './blitzortung-lightning-card';

// Add a type for the ha-card element to avoid using 'any'
interface HaCard extends HTMLElement {
  header?: string;
}

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
  callApi: vi.fn().mockResolvedValue([]),
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
});
