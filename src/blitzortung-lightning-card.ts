import { LitElement, html } from 'lit';
import { property, state } from 'lit/decorators.js';
import { BlitzortungCardConfig, HomeAssistant, LovelaceCardEditor } from './types';
import * as d3 from 'd3';

// Statically import the editor to bundle it into a single file.
import './blitzortung-lightning-card-editor';
import { localize } from './localize';
import cardStyles from './blitzortung-lightning-card.scss';

type Strike = { distance: number; azimuth: number };

console.info(
  `%c BLITZORTUNG-LIGHTNING-CARD %c v.0.0,18 `,
  'color: orange; font-weight: bold; background: black',
  'color: white; font-weight: bold; background: dimgray',
);
class BlitzortungLightningCard extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @state() private _config!: BlitzortungCardConfig;
  @state() private _strikes: Strike[] = [];
  private _lastStrikeCount: string | undefined = undefined;

  public setConfig(config: BlitzortungCardConfig): void {
    if (!config) {
      throw new Error('Invalid configuration');
    }
    if (!config.distance || !config.count || !config.azimuth) {
      throw new Error('Please define distance, count, and azimuth in your card configuration.');
    }
    this._config = config;
  }

  public static getConfigElement() {
    // The editor element itself will handle waiting for any necessary components.
    // We return it immediately to prevent deadlocks.
    return document.createElement('blitzortung-lightning-card-editor');
  }

  private get _storageKey(): string {
    // Create a unique key for localStorage to support multiple card instances
    return `blitzortung-card-strikes-${this._config.count}`;
  }

  connectedCallback(): void {
    super.connectedCallback();
    this._loadStrikesFromStorage();
  }

  private _loadStrikesFromStorage(): void {
    try {
      const storedStrikes = localStorage.getItem(this._storageKey);
      if (storedStrikes) {
        this._strikes = JSON.parse(storedStrikes);
      }
    } catch (e) {
      console.error('Error loading strikes from localStorage', e);
      this._strikes = [];
    }
  }

  private _saveStrikesToStorage(): void {
    try {
      localStorage.setItem(this._storageKey, JSON.stringify(this._strikes));
    } catch (e) {
      console.error('Error saving strikes to localStorage', e);
    }
  }

  // ... (rest of the component)

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
          <text x="50" y="22" font-size="10" text-anchor="middle" fill="var(--primary-text-color)">N</text>
          <text x="82" y="54" font-size="10" text-anchor="middle" fill="var(--primary-text-color)">E</text>
          <text x="50" y="82" font-size="10" text-anchor="middle" fill="var(--primary-text-color)">S</text>
          <text x="18" y="54" font-size="10" text-anchor="middle" fill="var(--primary-text-color)">W</text>

          <!-- Pointer Arrow -->
          <g class="compass-pointer" style="transform: rotate(${angle}deg); transform-origin: 50% 50%;">
            <path d="M 50 10 L 55 25 L 45 25 Z" fill="var(--error-color)" />
          </g>
        </svg>
      </div>
    `;
  }

  private _renderRadarChart() {
    const radarContainer = this.shadowRoot?.querySelector('.radar-chart');
    if (!radarContainer) {
      return;
    }

    const strikes = this._strikes;

    const width = 220;
    const height = 220;
    const margin = 20;
    const chartRadius = Math.min(width, height) / 2 - margin;

    const maxDistance = this._config.radar_max_distance ?? d3.max(strikes, (d) => d.distance) ?? 100;

    const rScale = d3.scaleLinear().domain([0, maxDistance]).range([0, chartRadius]);

    // Add an opacity scale for fading out older strikes
    const opacityScale = d3
      .scaleLinear()
      .domain([0, strikes.length - 1])
      .range([1, 0.15]); // Newest is 100% opaque, oldest is 15%

    // Clear previous chart
    d3.select(radarContainer).select('svg').remove();

    const svg = d3
      .select(radarContainer)
      .append('svg')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .append('g')
      .attr('transform', `translate(${width / 2}, ${height / 2})`);

    // Add background circles (grid)
    const gridCircles = rScale.ticks(4).slice(1);
    svg
      .selectAll('.grid-circle')
      .data(gridCircles)
      .enter()
      .append('circle')
      .attr('class', 'grid-circle')
      .attr('r', (d) => rScale(d))
      .style('fill', 'none')
      .style('stroke', 'var(--primary-text-color)')
      .style('opacity', 0.3);

    // Add grid lines and labels for cardinal directions
    const cardinalPoints = [
      { label: 'N', angle: 0 },
      { label: 'E', angle: 90 },
      { label: 'S', angle: 180 },
      { label: 'W', angle: 270 },
    ];

    svg
      .selectAll('.cardinal-line')
      .data(cardinalPoints)
      .enter()
      .append('line')
      .attr('class', 'cardinal-line')
      .attr('x1', 0)
      .attr('y1', 0)
      .attr('x2', (d) => rScale(maxDistance) * Math.cos((d.angle - 90) * (Math.PI / 180)))
      .attr('y2', (d) => rScale(maxDistance) * Math.sin((d.angle - 90) * (Math.PI / 180)))
      .style('stroke', 'var(--primary-text-color)')
      .style('opacity', 0.3);

    svg
      .selectAll('.cardinal-label')
      .data(cardinalPoints)
      .enter()
      .append('text')
      .attr('class', 'cardinal-label')
      .attr('x', (d) => (rScale(maxDistance) + 10) * Math.cos((d.angle - 90) * (Math.PI / 180)))
      .attr('y', (d) => (rScale(maxDistance) + 10) * Math.sin((d.angle - 90) * (Math.PI / 180)))
      .text((d) => d.label)
      .style('text-anchor', 'middle')
      .style('dominant-baseline', 'middle')
      .style('fill', 'var(--primary-text-color)')
      .style('font-size', '10px');

    // Plot the strikes
    svg
      .selectAll('.strike-dot')
      .data(strikes)
      .enter()
      .append('circle')
      .attr('class', 'strike-dot')
      .attr('cx', (d) => rScale(d.distance) * Math.cos((d.azimuth - 90) * (Math.PI / 180)))
      .attr('cy', (d) => rScale(d.distance) * Math.sin((d.azimuth - 90) * (Math.PI / 180)))
      .attr('r', 3)
      .style('fill', 'var(--error-color)')
      .style('fill-opacity', (d, i) => opacityScale(i));
  }

  private _renderMap() {
    if (!this._config.map) {
      return '';
    }

    const entitiesToShow: (string | { entity_id: string; state: any; attributes: any })[] = [];
    let warning: string | undefined;

    // Add the 'zone.home' entity to the map, if it exists. This is a more
    // robust way to show the home location than creating a fake entity.
    if (this.hass.states['zone.home']) {
      entitiesToShow.push('zone.home');
    }

    const trackerId = this._config.map;
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

    const zoomLevel = this._config.zoom ?? 8;
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

  updated(changedProperties: Map<string | number | symbol, unknown>): void {
    super.updated(changedProperties);

    if (!this.hass || !this._config) {
      return;
    }

    // Client-side history logic
    const countEntity = this.hass.states[this._config.count];
    const currentStrikeCount = countEntity?.state;

    // Initialize last strike count on first run
    if (this._lastStrikeCount === undefined) {
      this._lastStrikeCount = currentStrikeCount;
    }

    // Check if count is valid and has changed
    if (currentStrikeCount && currentStrikeCount !== 'unavailable' && currentStrikeCount !== this._lastStrikeCount) {
      this._lastStrikeCount = currentStrikeCount;

      const distance = parseFloat(this.hass.states[this._config.distance]?.state);
      const azimuth = parseFloat(this.hass.states[this._config.azimuth]?.state);

      if (!isNaN(distance) && !isNaN(azimuth)) {
        const newStrike: Strike = { distance, azimuth };
        const historySize = this._config.radar_history_size ?? 20;

        // Prepend new strike, trim array, and update state
        this._strikes = [newStrike, ...this._strikes].slice(0, historySize);
        this._saveStrikesToStorage();
      }
    }

    // Always re-render the chart if it's supposed to be visible
    if (this.shadowRoot?.querySelector('.radar-chart')) {
      this._renderRadarChart();
    }
  }

  protected render() {
    if (!this.hass || !this._config) {
      return html``;
    }

    const distanceEntity = this.hass.states[this._config.distance];
    const distance = distanceEntity?.state ?? 'N/A';
    const distanceUnit = distanceEntity?.attributes.unit_of_measurement ?? 'km';

    const count = this.hass.states[this._config.count]?.state ?? 'N/A';
    const azimuth = this.hass.states[this._config.azimuth]?.state ?? 'N/A';
    const title = this._config.title ?? localize(this.hass, 'component.blc.card.default_title');
    const visualization = this._config.visualization_type ?? 'radar';

    return html`
      <ha-card .header=${title}>
        <div class="card-content">
          <div class="content-container">
            <div class="info">
              <p><strong>${localize(this.hass, 'component.blc.card.distance')}:</strong> ${distance} ${distanceUnit}</p>
              <p><strong>${localize(this.hass, 'component.blc.card.total_strikes')}:</strong> ${count}</p>
              <p><strong>${localize(this.hass, 'component.blc.card.direction')}:</strong> ${azimuth}&deg;</p>
            </div>
            ${visualization === 'radar' ? html`<div class="radar-chart"></div>` : this._renderCompass(azimuth)}
          </div>
          ${this._renderMap()}
        </div>
      </ha-card>
    `;
  }

  public getCardSize(): number {
    const visualization = this._config?.visualization_type ?? 'radar';
    // Header + Info: 2 units. Map: 3 units.
    // Radar is ~3 units tall, Compass is ~2 units.
    return 2 + (this._config?.map ? 3 : 0) + (visualization === 'radar' ? 3 : 2);
  }

  static styles = cardStyles;

  // Provides a default configuration for the card in the UI editor
  static getStubConfig(): Record<string, unknown> {
    return {
      type: 'custom:blitzortung-lightning-card',
      distance: 'sensor.blitzortung_lightning_distance',
      count: 'sensor.blitzortung_lightning_counter',
      azimuth: 'sensor.blitzortung_lightning_azimuth',
      visualization_type: 'radar',
      radar_max_distance: 100,
      radar_history_size: 20,
      map: 'device_tracker.blitzortung_lightning_map',
      zoom: 8,
    };
  }
}

customElements.define('blitzortung-lightning-card', BlitzortungLightningCard);
