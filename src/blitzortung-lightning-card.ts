import { LitElement, html } from 'lit';
import { property, state } from 'lit/decorators.js';
import { BlitzortungCardConfig, HomeAssistant, LovelaceCardEditor } from './types';

// Statically import the editor to bundle it into a single file.
import './blitzortung-lightning-card-editor';
import { localize } from './localize';
import cardStyles from './blitzortung-lightning-card.scss';

console.info(
  `%c BLITZORTUNG-LIGHTNING-CARD %c v.0.0,18 `,
  'color: orange; font-weight: bold; background: black',
  'color: white; font-weight: bold; background: dimgray',
);
class BlitzortungLightningCard extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @state() private config!: BlitzortungCardConfig;

  public setConfig(config: BlitzortungCardConfig): void {
    if (!config) {
      throw new Error('Invalid configuration');
    }
    if (!config.distance || !config.count || !config.azimuth) {
      throw new Error('Please define distance, count, and azimuth in your card configuration.');
    }
    this.config = config;
  }

  public static getConfigElement() {
    // The editor element itself will handle waiting for any necessary components.
    // We return it immediately to prevent deadlocks.
    return document.createElement('blitzortung-lightning-card-editor');
  }

  private _renderCompass(azimuth: string) {
    const angle = Number.parseFloat(azimuth);
    if (isNaN(angle)) {
      return '';
    }

    return html`
      <div class="compass">
        <svg viewBox="0 0 100 100">
          <!-- Compass Rose Background -->
          <circle
            cx="50"
            cy="50"
            r="48"
            stroke="var(--primary-text-color)"
            stroke-width="1"
            fill="none"
            opacity="0.3"
          />
          <!-- Cardinal Points -->
          <line x1="50" y1="2" x2="50" y2="12" stroke="var(--primary-text-color)" stroke-width="1" />
          <text x="50" y="22" font-size="10" text-anchor="middle" fill="var(--primary-text-color)">N</text>
          <line x1="88" y1="50" x2="98" y2="50" stroke="var(--primary-text-color)" stroke-width="1" />
          <text x="82" y="54" font-size="10" text-anchor="middle" fill="var(--primary-text-color)">E</text>
          <line x1="50" y1="88" x2="50" y2="98" stroke="var(--primary-text-color)" stroke-width="1" />
          <text x="50" y="82" font-size="10" text-anchor="middle" fill="var(--primary-text-color)">S</text>
          <line x1="2" y1="50" x2="12" y2="50" stroke="var(--primary-text-color)" stroke-width="1" />
          <text x="18" y="54" font-size="10" text-anchor="middle" fill="var(--primary-text-color)">W</text>

          <!-- Pointer Arrow -->
          <g class="compass-pointer" style="transform: rotate(${angle}deg); transform-origin: 50% 50%;">
            <path d="M 50 10 L 55 25 L 45 25 Z" fill="var(--error-color)" />
          </g>
        </svg>
      </div>
    `;
  }

  private _renderMap() {
    if (!this.config.map) {
      return '';
    }

    const entitiesToShow: (string | { entity_id: string; state: any; attributes: any })[] = [];
    let warning: string | undefined;

    // Add the 'zone.home' entity to the map, if it exists. This is a more
    // robust way to show the home location than creating a fake entity.
    if (this.hass.states['zone.home']) {
      entitiesToShow.push('zone.home');
    }

    const trackerId = this.config.map;
    const tracker = this.hass.states[trackerId];

    if (trackerId) {
      if (!tracker) {
        warning = localize(this.hass, 'component.blc.warnings.map_entity_not_found', {
          entity: trackerId,
        });
      } else if (!tracker.attributes.latitude || !tracker.attributes.longitude) {
        warning = localize(this.hass, 'component.blc.warnings.map_entity_no_location', {
          entity: trackerId,
        });
      } else {
        // To ensure our custom icon and name are used, we create a new entity
        // object with only the necessary properties. This avoids conflicts with
        // other attributes the original entity might have.
        entitiesToShow.push({
          entity_id: tracker.entity_id,
          state: tracker.state,
          attributes: {
            latitude: tracker.attributes.latitude,
            longitude: tracker.attributes.longitude,
            icon: 'mdi:flash',
            friendly_name: '⚡️',
          },
        });
      }
    }

    const zoomLevel = this.config.zoom ?? 8;
    return html`
      ${warning ? html`<p class="warning">${warning}</p>` : ''}
      ${entitiesToShow.length > 0
        ? html`<ha-map
            .hass=${this.hass}
            .entities=${entitiesToShow}
            .zoom=${zoomLevel}
            .darkMode=${this.hass?.themes?.darkMode ?? false}
          ></ha-map>`
        : ''}
    `;
  }

  protected render() {
    if (!this.hass || !this.config) {
      return html``;
    }

    const distanceEntity = this.hass.states[this.config.distance];
    const distance = distanceEntity?.state ?? 'N/A';
    const distanceUnit = distanceEntity?.attributes.unit_of_measurement ?? 'km';

    const count = this.hass.states[this.config.count]?.state ?? 'N/A';
    const azimuth = this.hass.states[this.config.azimuth]?.state ?? 'N/A';
    const title = this.config.title ?? localize(this.hass, 'component.blc.card.default_title');

    return html`
      <ha-card .header=${title}>
        <div class="card-content">
          <div class="content-container">
            <div class="info">
              <p><strong>${localize(this.hass, 'component.blc.card.distance')}:</strong> ${distance} ${distanceUnit}</p>
              <p><strong>${localize(this.hass, 'component.blc.card.total_strikes')}:</strong> ${count}</p>
              <p><strong>${localize(this.hass, 'component.blc.card.direction')}:</strong> ${azimuth}&deg;</p>
            </div>
            ${this._renderCompass(azimuth)}
          </div>
          ${this._renderMap()}
        </div>
      </ha-card>
    `;
  }

  public getCardSize(): number {
    // 1 for header, 1 for info section, 3 for map if present.
    return 2 + (this.config?.map ? 3 : 0);
  }

  static styles = cardStyles;

  // Provides a default configuration for the card in the UI editor
  static getStubConfig(): Record<string, unknown> {
    return {
      type: 'custom:blitzortung-lightning-card',
      distance: 'sensor.blitzortung_lightning_distance',
      count: 'sensor.blitzortung_lightning_counter',
      azimuth: 'sensor.blitzortung_lightning_azimuth',
      map: 'device_tracker.blitzortung_lightning_map',
      zoom: 8,
    };
  }
}

customElements.define('blitzortung-lightning-card', BlitzortungLightningCard);
