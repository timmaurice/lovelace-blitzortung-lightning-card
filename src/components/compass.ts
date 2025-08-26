import { LitElement, html, TemplateResult } from 'lit';
import { property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';
import { BlitzortungCardConfig, HomeAssistant } from '../types';
import { getDirection } from '../utils';
import { localize } from '../localize';

export class BlitzortungCompass extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public config!: BlitzortungCardConfig;
  @property({ type: String }) public azimuth!: string;
  @property({ type: String }) public distance!: string;
  @property({ type: String }) public distanceUnit!: string;
  @property({ type: String }) public count!: string;
  @property({ type: Number }) public displayAngle?: number;

  private _handleEntityClick(e: MouseEvent): void {
    e.stopPropagation();
    const entityId = (e.currentTarget as SVGElement)?.dataset.entityId;
    if (entityId) {
      const event = new CustomEvent('hass-more-info', {
        bubbles: true,
        composed: true,
        detail: { entityId },
      });
      this.dispatchEvent(event);
    }
  }

  protected render(): TemplateResult {
    const angle = Number.parseFloat(this.azimuth);
    if (isNaN(angle)) {
      return html``;
    }

    const rotationAngle = this.displayAngle ?? angle;
    const gridColor = this.config.grid_color ?? 'var(--primary-text-color)';
    const strikeColor = this.config.strike_color ?? 'var(--error-color)';
    const directionText = getDirection(this.hass, angle);

    return html`
      <div class="compass">
        <svg viewBox="0 0 100 100" role="img" aria-labelledby="compass-title">
          <!-- Compass Rose Background -->
          <title id="compass-title">Compass showing lightning direction at ${angle} degrees</title>
          <circle cx="50" cy="50" r="42" stroke=${gridColor} stroke-width="0.5" fill="none" opacity="0.3" />

          <!-- Cardinal Points -->
          <text
            x="50"
            y="5"
            font-size="4.5"
            text-anchor="middle"
            dominant-baseline="middle"
            fill=${this.config.font_color ?? gridColor}
          >
            ${localize(this.hass, 'component.blc.card.directions.N')}
          </text>
          <text
            x="95"
            y="50"
            font-size="4.5"
            text-anchor="middle"
            dominant-baseline="middle"
            fill=${this.config.font_color ?? gridColor}
          >
            ${localize(this.hass, 'component.blc.card.directions.E')}
          </text>
          <text
            x="50"
            y="95"
            font-size="4.5"
            text-anchor="middle"
            dominant-baseline="middle"
            fill=${this.config.font_color ?? gridColor}
          >
            ${localize(this.hass, 'component.blc.card.directions.S')}
          </text>
          <text
            x="5"
            y="50"
            font-size="4.5"
            text-anchor="middle"
            dominant-baseline="middle"
            fill=${this.config.font_color ?? gridColor}
          >
            ${localize(this.hass, 'component.blc.card.directions.W')}
          </text>

          <!-- Pointer Arrow -->
          <g class="compass-pointer" style=${styleMap({ transform: `rotate(${rotationAngle}deg)` })}>
            <path d="M 50 10 L 53 19.6 L 47 19.6 Z" fill=${strikeColor} />
          </g>

          <!-- Center Text -->
          <a class="clickable-entity" data-entity-id="${this.config.counter_entity}" @click=${this._handleEntityClick}>
            <text
              x="50"
              y="35"
              font-size="6"
              text-anchor="middle"
              dominant-baseline="central"
              fill=${this.config.font_color ?? gridColor}
            >
              ${this.count} ⚡
            </text>
          </a>
          <a class="clickable-entity" data-entity-id="${this.config.azimuth_entity}" @click=${this._handleEntityClick}>
            <text
              x="50"
              y="50"
              font-size="9"
              text-anchor="middle"
              dominant-baseline="central"
              fill=${this.config.font_color ?? gridColor}
            >
              ${this.azimuth}° ${directionText}
            </text>
          </a>
          <a class="clickable-entity" data-entity-id="${this.config.distance_entity}" @click=${this._handleEntityClick}>
            <text
              x="50"
              y="65"
              font-size="6"
              text-anchor="middle"
              dominant-baseline="central"
              fill=${this.config.font_color ?? gridColor}
            >
              ${this.distance} ${this.distanceUnit}
            </text>
          </a>
        </svg>
      </div>
    `;
  }

  protected createRenderRoot() {
    return this;
  }
}

customElements.define('blitzortung-compass', BlitzortungCompass);
