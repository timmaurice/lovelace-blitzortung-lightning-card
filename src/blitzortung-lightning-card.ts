import { LitElement, html } from 'lit';
import { property, state } from 'lit/decorators.js';
import { BlitzortungCardConfig, HomeAssistant } from './types';
import { max } from 'd3-array';
import { scaleLinear } from 'd3-scale';
import { select } from 'd3-selection';

// Statically import the editor to bundle it into a single file.
import './blitzortung-lightning-card-editor';
import { localize } from './localize';
import cardStyles from './blitzortung-lightning-card.scss';

type Strike = { distance: number; azimuth: number; timestamp: number };

console.info(
  `%c BLITZORTUNG-LIGHTNING-CARD %c v__CARD_VERSION__ `,
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
      const now = Date.now();
      const oneHourAgo = now - 3600 * 1000;
      if (storedStrikes) {
        const allStrikes: Strike[] = JSON.parse(storedStrikes);
        // Filter out strikes older than 1 hour and ensure they have a timestamp for migration.
        this._strikes = allStrikes.filter((s) => s.timestamp && s.timestamp > oneHourAgo);
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

  private getDirection(angle: number): string {
    const directionKeys = [
      'N',
      'NNE',
      'NE',
      'ENE',
      'E',
      'ESE',
      'SE',
      'SSE',
      'S',
      'SSW',
      'SW',
      'WSW',
      'W',
      'WNW',
      'NW',
      'NNW',
    ];
    if (angle < 0) {
      angle = 360 + angle;
    }
    const index = Math.round((angle %= 360) / 22.5) % 16;
    const key = directionKeys[index];
    // The key will be something like 'N', 'NNE', etc.
    // The localization key will be `component.blc.card.directions.${key}`
    return localize(this.hass, `component.blc.card.directions.${key}`);
  }

  private _renderCompass(azimuth: string, distance: string, distanceUnit: string, count: string) {
    const angle = Number.parseFloat(azimuth);
    if (isNaN(angle)) {
      return '';
    }

    const gridColor = this._config.grid_color ?? 'var(--primary-text-color)';
    const strikeColor = this._config.strike_color ?? 'var(--error-color)';
    const directionText = this.getDirection(angle);

    return html`
      <div class="compass">
        <svg viewBox="0 0 100 100" role="img" aria-labelledby="compass-title">
          <!-- Compass Rose Background -->
          <title id="compass-title">Compass showing lightning direction at ${angle} degrees</title>
          <circle cx="50" cy="50" r="42" stroke=${gridColor} stroke-width="0.5" fill="none" opacity="0.3" />

          <!-- Cardinal Points -->
          <text x="50" y="5" font-size="4.5" text-anchor="middle" dominant-baseline="middle" fill=${gridColor}>
            ${localize(this.hass, 'component.blc.card.directions.N')}
          </text>
          <text x="95" y="50" font-size="4.5" text-anchor="middle" dominant-baseline="middle" fill=${gridColor}>
            ${localize(this.hass, 'component.blc.card.directions.E')}
          </text>
          <text x="50" y="95" font-size="4.5" text-anchor="middle" dominant-baseline="middle" fill=${gridColor}>
            ${localize(this.hass, 'component.blc.card.directions.S')}
          </text>
          <text x="5" y="50" font-size="4.5" text-anchor="middle" dominant-baseline="middle" fill=${gridColor}>
            ${localize(this.hass, 'component.blc.card.directions.W')}
          </text>

          <!-- Pointer Arrow -->
          <g class="compass-pointer" style="transform: rotate(${angle}deg); transform-origin: 50% 50%;">
            <path d="M 50 10 L 53 19.6 L 47 19.6 Z" fill=${strikeColor} />
          </g>

          <!-- Center Text -->
          <text x="50" y="40" font-size="6" text-anchor="middle" dominant-baseline="central" fill=${gridColor}>
            ${distance} ${distanceUnit}
          </text>
          <text x="50" y="53" font-size="6" text-anchor="middle" dominant-baseline="central" fill=${gridColor}>
            ${azimuth}° ${directionText}
          </text>
          <text x="50" y="66" font-size="6" text-anchor="middle" dominant-baseline="central" fill=${gridColor}>
            ${count} ⚡
          </text>
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

    const radarStrikes = this._strikes.slice(0, this._config.radar_history_size ?? 20);
    const maxDistance = this._config.radar_max_distance ?? max(radarStrikes, (d) => d.distance) ?? 100;

    const rScale = scaleLinear().domain([0, maxDistance]).range([0, chartRadius]);

    // Add an opacity scale for fading out older strikes
    const opacityScale = scaleLinear()
      .domain([0, strikes.length - 1])
      .range([1, 0.15]); // Newest is 100% opaque, oldest is 15%

    // Clear previous chart
    select(radarContainer).select('svg').remove();

    const svgRoot = select(radarContainer)
      .append('svg')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('role', 'img')
      .attr('aria-labelledby', 'radar-title radar-desc');

    svgRoot.append('title').attr('id', 'radar-title').text('Radar chart of recent lightning strikes.');

    svgRoot
      .append('desc')
      .attr('id', 'radar-desc')
      .text(
        `Showing the ${radarStrikes.length} most recent strikes. The center is your location. Strikes are plotted by distance and direction.`,
      );

    const svg = svgRoot.append('g').attr('transform', `translate(${width / 2}, ${height / 2})`);

    // Add background circles (grid)
    const gridCircles = rScale.ticks(4).slice(1);
    svg
      .selectAll('.grid-circle')
      .data(gridCircles)
      .enter()
      .append('circle')
      .attr('class', 'grid-circle')
      .attr('r', (d) => rScale(d))
      .style('fill', 'none') // The grid circles should not be filled.
      .style('stroke', this._config.grid_color ?? 'var(--primary-text-color)')
      .style('opacity', 0.3);

    // Add grid lines and labels for cardinal directions
    const cardinalPoints = [
      { label: localize(this.hass, 'component.blc.card.directions.N'), angle: 0 },
      { label: localize(this.hass, 'component.blc.card.directions.E'), angle: 90 },
      { label: localize(this.hass, 'component.blc.card.directions.S'), angle: 180 },
      { label: localize(this.hass, 'component.blc.card.directions.W'), angle: 270 },
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
      .style('stroke', this._config.grid_color ?? 'var(--primary-text-color)')
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
      .style('dominant-baseline', 'middle') // Vertically center the text.
      .style('fill', this._config.grid_color ?? 'var(--primary-text-color)')
      .style('font-size', '10px');

    // Plot the strikes
    svg
      .selectAll('.strike-dot')
      .data(radarStrikes)
      .enter()
      .append('circle')
      .attr('class', 'strike-dot')
      .attr('cx', (d) => rScale(d.distance) * Math.cos((d.azimuth - 90) * (Math.PI / 180)))
      .attr('cy', (d) => rScale(d.distance) * Math.sin((d.azimuth - 90) * (Math.PI / 180)))
      .attr('r', 3)
      .style('fill', this._config.strike_color ?? 'var(--error-color)')
      .style('fill-opacity', (d, i) => opacityScale(i));
  }

  private _renderHistoryChart() {
    const container = this.shadowRoot?.querySelector('.history-chart');
    if (!container) {
      return;
    }

    const now = Date.now();
    const buckets = Array(6).fill(0); // 6 buckets for 10 mins each

    for (const strike of this._strikes) {
      const ageMinutes = (now - strike.timestamp) / (1000 * 60);
      if (ageMinutes < 60) {
        const bucketIndex = Math.floor(ageMinutes / 10);
        buckets[bucketIndex]++;
      }
    }

    const colors = [
      '#FFFFFF', // 0-10 min (white)
      '#FFFF00', // 10-20 min (yellow)
      '#FFA500', // 20-30 min (orange)
      '#FF4500', // 30-40 min (orangered)
      '#FF0000', // 40-50 min (red)
      '#8B0000', // 50-60 min (darkred)
    ];

    const width = 280;
    const height = 100;
    const margin = { top: 15, right: 5, bottom: 20, left: 30 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    const yMax = Math.max(10, max(buckets) ?? 10);
    const xScale = scaleLinear().domain([0, 6]).range([0, chartWidth]);
    const yScale = scaleLinear().domain([0, yMax]).range([chartHeight, 0]);

    select(container).select('svg').remove();

    const svg = select(container)
      .append('svg')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .append('g')
      .attr('transform', `translate(${margin.left}, ${margin.top})`);

    // Y-axis with labels
    const yTicks = yScale.ticks(4);
    svg
      .append('g')
      .selectAll('text')
      .data(yTicks)
      .enter()
      .append('text')
      .attr('x', -8)
      .attr('y', (d) => yScale(d))
      .attr('text-anchor', 'end')
      .attr('dominant-baseline', 'middle')
      .style('font-size', '10px')
      .style('fill', 'var(--secondary-text-color)')
      .text((d) => d);

    // X-axis labels
    const xAxisLabels = ['-10m', '-20m', '-30m', '-40m', '-50m', '-60m'];
    svg
      .append('g')
      .attr('transform', `translate(0, ${chartHeight})`)
      .selectAll('text')
      .data(xAxisLabels)
      .enter()
      .append('text')
      .attr('x', (d, i) => xScale(i + 0.5))
      .attr('y', 15)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .style('font-size', '10px')
      .style('fill', 'var(--secondary-text-color)')
      .text((d) => d);

    // Bars
    svg
      .selectAll('.bar')
      .data(buckets)
      .enter()
      .append('rect')
      .attr('class', 'bar')
      .attr('x', (d, i) => xScale(i))
      .attr('y', (d) => yScale(d))
      .attr('width', xScale(1) - xScale(0) - 2)
      .attr('height', (d) => chartHeight - yScale(d))
      .attr('fill', (d, i) => colors[i]);

    // Add text labels on top of the bars
    svg
      .selectAll('.bar-label')
      .data(buckets)
      .enter()
      .append('text')
      .attr('class', 'bar-label')
      .attr('x', (d, i) => xScale(i + 0.5)) // Center the text horizontally in the bar
      .attr('y', (d) => yScale(d) - 4) // Position it 4px above the bar
      .attr('text-anchor', 'middle')
      .style('font-size', '10px')
      .style('fill', 'var(--primary-text-color)')
      .text((d) => (d > 0 ? d : '')); // Only show text if count is > 0
  }

  private _renderMap() {
    if (!this._config.map) {
      return '';
    }

    interface MapEntity {
      entity_id: string;
      state: string;
      attributes: {
        latitude: number;
        longitude: number;
        icon: string;
        friendly_name: string;
      };
    }
    const entitiesToShow: (string | MapEntity)[] = [];
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
            latitude: tracker.attributes.latitude as number,
            longitude: tracker.attributes.longitude as number,
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

    const countEntity = this.hass.states[this._config.count];
    const currentStrikeCountStr = countEntity?.state;

    if (!currentStrikeCountStr || currentStrikeCountStr === 'unavailable') {
      return; // Wait for a valid count
    }

    const currentCount = Number(currentStrikeCountStr);
    if (isNaN(currentCount)) {
      return; // Not a number
    }

    // Initialize last strike count on first valid read
    if (this._lastStrikeCount === undefined) {
      this._lastStrikeCount = currentStrikeCountStr;
    } else {
      const lastCount = Number(this._lastStrikeCount);

      if (currentCount > lastCount) {
        const numNewStrikes = currentCount - lastCount;
        const distance = parseFloat(this.hass.states[this._config.distance]?.state ?? '');
        const azimuth = parseFloat(this.hass.states[this._config.azimuth]?.state ?? '');

        if (!isNaN(distance) && !isNaN(azimuth)) {
          const now = Date.now();
          const oneHourAgo = now - 3600 * 1000;

          const strikes = this._strikes.filter((s) => s.timestamp && s.timestamp > oneHourAgo);

          for (let i = 0; i < numNewStrikes; i++) {
            strikes.unshift({ distance, azimuth, timestamp: now });
          }

          this._strikes = strikes;
          this._saveStrikesToStorage();
        }
      }
    }

    this._lastStrikeCount = currentStrikeCountStr;

    if (this.shadowRoot?.querySelector('.radar-chart')) {
      this._renderRadarChart();
    }
    if (this._config.show_history_chart && this.shadowRoot?.querySelector('.history-chart')) {
      this._renderHistoryChart();
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

    return html`
      <ha-card .header=${title}>
        <div class="card-content">
          <div class="content-container">
            ${this._renderCompass(azimuth, distance, distanceUnit, count)}
            <div class="radar-chart"></div>
          </div>
          ${this._config.show_history_chart ? html`<div class="history-chart"></div>` : ''} ${this._renderMap()}
        </div>
      </ha-card>
    `;
  }

  public getCardSize(): number {
    // Base (header + info): 2 units. Map: 3 units.
    // Radar is ~3 units tall, Compass is ~2, History Chart is ~2.
    const mapSize = this._config?.map ? 3 : 0;
    const vizSize = 3; // Radar is always shown and is the taller element
    const historyChartSize = this._config?.show_history_chart ? 2 : 0;
    return 2 + mapSize + vizSize + historyChartSize;
  }

  static styles = cardStyles;
  // Provides a default configuration for the card in the UI editor
  static getStubConfig(): Record<string, unknown> {
    return {
      type: 'custom:blitzortung-lightning-card',
      distance: 'sensor.blitzortung_lightning_distance',
      count: 'sensor.blitzortung_lightning_counter',
      azimuth: 'sensor.blitzortung_lightning_azimuth',
      radar_max_distance: 100,
      radar_history_size: 20,
      map: 'device_tracker.blitzortung_lightning_map',
      show_history_chart: true,
      zoom: 8,
      grid_color: 'var(--primary-text-color)',
      strike_color: 'var(--error-color)',
    };
  }
}

customElements.define('blitzortung-lightning-card', BlitzortungLightningCard);
