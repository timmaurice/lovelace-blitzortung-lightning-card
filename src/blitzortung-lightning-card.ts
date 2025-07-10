import { LitElement, html } from 'lit';
import { property, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { BlitzortungCardConfig, HomeAssistant } from './types';
import type { Map as LeafletMap, LayerGroup, DivIcon } from 'leaflet';
import { max } from 'd3-array';
import { scaleLinear } from 'd3-scale';
import { select } from 'd3-selection';
import 'd3-transition';

// Statically import the editor to bundle it into a single file.
import './blitzortung-lightning-card-editor';
import { localize } from './localize';
import { calculateAzimuth, getDirection } from './utils';
import cardStyles from './blitzortung-lightning-card.scss';
import leafletCss from 'leaflet/dist/leaflet.css';
import leafletStyles from './leaflet-styles.scss';

type Strike = { distance: number; azimuth: number; timestamp: number; latitude?: number; longitude?: number };

console.info(
  `%c BLITZORTUNG-LIGHTNING-CARD %c v__CARD_VERSION__ `,
  'color: orange; font-weight: bold; background: black',
  'color: white; font-weight: bold; background: dimgray',
);
export class BlitzortungLightningCard extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @state() private _config!: BlitzortungCardConfig;
  @state() private _tooltip = { visible: false, content: '', x: 0, y: 0 };
  private _map: LeafletMap | undefined = undefined;
  private _markers: LayerGroup | undefined = undefined;
  private _leaflet: typeof import('leaflet') | undefined;

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

  private get _historyMaxAgeMs(): number {
    const period = this._config.history_chart_period ?? '1h';
    if (period === '15m') {
      return 15 * 60 * 1000;
    }
    return 60 * 60 * 1000; // 1h
  }

  // New: Get recent strikes from geo_location entities
  private _getRecentStrikes(): Strike[] {
    const now = Date.now();
    const maxAge = this._historyMaxAgeMs;
    const oldestTimestamp = now - maxAge;
    return Object.values(this.hass.states)
      .filter(
        (entity) =>
          entity.entity_id.startsWith('geo_location.lightning_strike_') &&
          entity.attributes.source === 'blitzortung' &&
          entity.attributes.publication_date,
      )
      .map((entity) => {
        const pubDate = new Date(entity.attributes.publication_date as string).getTime();
        return {
          distance: Number(entity.state),
          azimuth: undefined, // geo_location does not provide azimuth
          timestamp: pubDate,
          latitude: Number(entity.attributes.latitude),
          longitude: Number(entity.attributes.longitude),
        };
      })
      .filter((strike) => strike.timestamp > oldestTimestamp)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  private _formatTimeAgo(timestamp: number): string {
    const now = Date.now();
    const seconds = Math.floor((now - timestamp) / 1000);

    if (seconds < 60) {
      return localize(this.hass, 'component.blc.card.tooltips.just_now');
    }
    const minutes = Math.floor(seconds / 60);
    return localize(this.hass, 'component.blc.card.tooltips.minutes_ago', { minutes });
  }

  private _getStrikeTooltipContent(strike: Strike, distanceUnit: string): string {
    // Always show a direction, fallback to 0 (North) if azimuth is undefined
    const direction = getDirection(
      this.hass,
      typeof strike.azimuth === 'number' && !isNaN(strike.azimuth) ? strike.azimuth : 0,
    );
    const timeAgo = this._formatTimeAgo(strike.timestamp);

    const distanceLabel = localize(this.hass, 'component.blc.card.tooltips.distance');
    const directionLabel = localize(this.hass, 'component.blc.card.tooltips.direction');
    const timeLabel = localize(this.hass, 'component.blc.card.tooltips.time');

    return `
      <strong>${distanceLabel}:</strong> ${strike.distance.toFixed(1)} ${distanceUnit}<br>
      <strong>${directionLabel}:</strong> ${typeof strike.azimuth === 'number' && !isNaN(strike.azimuth) ? strike.azimuth.toFixed(0) : 0}° ${direction}<br>
      <strong>${timeLabel}:</strong> ${timeAgo}
    `;
  }

  private _showTooltip(event: MouseEvent | L.LeafletMouseEvent, strike: Strike, distanceUnit: string): void {
    const content = this._getStrikeTooltipContent(strike, distanceUnit);
    this._tooltip = { ...this._tooltip, visible: true, content };
    this._moveTooltip(event); // Initial position
  }

  private _moveTooltip(event: MouseEvent | L.LeafletMouseEvent): void {
    if (!this._tooltip.visible) return;

    const cardRect = this.getBoundingClientRect();
    const clientX = 'originalEvent' in event ? event.originalEvent.clientX : event.clientX;
    const clientY = 'originalEvent' in event ? event.originalEvent.clientY : event.clientY;

    // Position relative to the card's top-left corner
    const x = clientX - cardRect.left;
    const y = clientY - cardRect.top;

    // Add a small offset to prevent the tooltip from flickering by being under the cursor
    this._tooltip = { ...this._tooltip, x: x + 15, y: y + 15 };
  }

  private _hideTooltip(): void {
    if (this._tooltip.visible) {
      this._tooltip = { ...this._tooltip, visible: false };
    }
  }

  private _renderCompass(azimuth: string, distance: string, distanceUnit: string, count: string) {
    const angle = Number.parseFloat(azimuth);
    if (isNaN(angle)) {
      return '';
    }

    const gridColor = this._config.grid_color ?? 'var(--primary-text-color)';
    const strikeColor = this._config.strike_color ?? 'var(--error-color)';
    const directionText = getDirection(this.hass, angle);

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
          <g class="compass-pointer" style="transform: rotate(${angle}deg);">
            <path d="M 50 10 L 53 19.6 L 47 19.6 Z" fill=${strikeColor} />
          </g>

          <!-- Center Text -->
          <a class="clickable-entity" data-entity-id=${this._config.count} @click=${this._handleEntityClick}>
            <text x="50" y="38" font-size="6" text-anchor="middle" dominant-baseline="central" fill=${gridColor}>
              ${count} ⚡
            </text>
          </a>
          <a class="clickable-entity" data-entity-id=${this._config.azimuth} @click=${this._handleEntityClick}>
            <text x="50" y="53" font-size="8" text-anchor="middle" dominant-baseline="central" fill=${gridColor}>
              ${azimuth}° ${directionText}
            </text>
          </a>
          <a class="clickable-entity" data-entity-id=${this._config.distance} @click=${this._handleEntityClick}>
            <text x="50" y="68" font-size="6" text-anchor="middle" dominant-baseline="central" fill=${gridColor}>
              ${distance} ${distanceUnit}
            </text>
          </a>
        </svg>
      </div>
    `;
  }

  private async _updateMapMarkers(): Promise<void> {
    if (!this._map) return;
    const L = await this._getLeaflet();
    if (!this._markers) {
      this._markers = L.layerGroup().addTo(this._map);
    } else {
      this._markers.clearLayers();
    }
    const distanceUnit = this.hass.states[this._config.distance]?.attributes.unit_of_measurement ?? 'km';
    const bounds = L.latLngBounds([]);
    // Home marker
    const homeZone = this.hass.states['zone.home'];
    let homeLat = this.hass.config.latitude;
    let homeLon = this.hass.config.longitude;
    if (homeZone?.attributes.latitude && homeZone?.attributes.longitude) {
      homeLat = homeZone.attributes.latitude as number;
      homeLon = homeZone.attributes.longitude as number;
      const homeIcon: DivIcon = L.divIcon({
        html: `<div class="leaflet-home-marker"><ha-icon icon="mdi:home"></ha-icon></div>`,
        className: '',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });
      const homeMarker = L.marker([homeLat, homeLon], {
        icon: homeIcon,
        title: homeZone.attributes.friendly_name || 'Home',
        zIndexOffset: 0,
      }).addTo(this._markers);
      bounds.extend(homeMarker.getLatLng());
    }
    // Strikes (newest first, up to 100)
    const mapStrikes = this._getRecentStrikes()
      .filter((s) => s.latitude != null && s.longitude != null)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 100);
    mapStrikes.forEach((strike, index) => {
      // Calculate azimuth for popover
      strike.azimuth = calculateAzimuth(homeLat, homeLon, strike.latitude!, strike.longitude!);
      const lat = strike.latitude!;
      const lon = strike.longitude!;
      const isNewest = index === 0;
      const strikeIcon: DivIcon = L.divIcon({
        html: `<div class="leaflet-strike-marker${isNewest ? ' new-strike' : ''}"><ha-icon icon="mdi:flash"></ha-icon></div>`,
        className: '',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });
      const strikeMarker = L.marker([lat, lon], {
        icon: strikeIcon,
        zIndexOffset: mapStrikes.length - index + (isNewest ? 1000 : 0),
      }).addTo(this._markers);
      strikeMarker.on('mouseover', (e) => this._showTooltip(e, strike, distanceUnit));
      strikeMarker.on('mousemove', (e) => this._moveTooltip(e));
      strikeMarker.on('mouseout', () => this._hideTooltip());
      bounds.extend(strikeMarker.getLatLng());
    });
    if (bounds.isValid()) {
      this._map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
    } else if (this._map.getZoom() === 0) {
      this._map.setView([homeLat, homeLon], 10);
    }
  }

  private _renderRadarChart() {
    const radarContainer = this.shadowRoot?.querySelector('.radar-chart');
    if (!radarContainer) return;
    const width = 220,
      height = 220,
      margin = 20;
    const chartRadius = Math.min(width, height) / 2 - margin;
    const distanceEntity = this.hass.states[this._config.distance];
    const distanceUnit = distanceEntity?.attributes.unit_of_measurement ?? 'km';
    const strikes = this._getRecentStrikes()
      .filter((s) => s.latitude != null && s.longitude != null)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 100);
    // Calculate azimuth for each strike
    let homeLat = this.hass.config.latitude;
    let homeLon = this.hass.config.longitude;
    const homeZone = this.hass.states['zone.home'];
    if (homeZone?.attributes.latitude && homeZone?.attributes.longitude) {
      homeLat = homeZone.attributes.latitude as number;
      homeLon = homeZone.attributes.longitude as number;
    }
    strikes.forEach((strike) => {
      strike.azimuth = calculateAzimuth(homeLat, homeLon, strike.latitude!, strike.longitude!);
    });
    const maxDistance = this._config.radar_max_distance ?? max(strikes, (d) => d.distance) ?? 100;
    const rScale = scaleLinear().domain([0, maxDistance]).range([0, chartRadius]);
    const opacityScale = scaleLinear()
      .domain([0, strikes.length - 1])
      .range([1, 0.15]);

    const svgRoot = select(radarContainer)
      .selectAll('svg')
      .data([null])
      .join('svg')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('role', 'img')
      .attr('aria-labelledby', 'radar-title radar-desc');

    svgRoot
      .selectAll('title')
      .data([null])
      .join('title')
      .attr('id', 'radar-title')
      .text('Radar chart of recent lightning strikes.');

    svgRoot
      .selectAll('desc')
      .data([null])
      .join('desc')
      .attr('id', 'radar-desc')
      .text(
        `Showing the ${strikes.length} most recent strikes. The center is your location. Strikes are plotted by distance and direction.`,
      );

    const svg = svgRoot
      .selectAll('g.radar-main-group')
      .data([null])
      .join('g')
      .attr('class', 'radar-main-group')
      .attr('transform', `translate(${width / 2}, ${height / 2})`);

    // Add background circles (grid)
    const gridCircles = rScale.ticks(4).slice(1);
    svg
      .selectAll('.grid-circle')
      .data(gridCircles)
      .join(
        (enter) =>
          enter
            .append('circle')
            .attr('class', 'grid-circle')
            .style('fill', 'none')
            .style('stroke', this._config.grid_color ?? 'var(--primary-text-color)')
            .style('opacity', 0),
        (update) => update,
        (exit) => exit.transition().duration(500).style('opacity', 0).remove(),
      )
      .transition()
      .duration(500)
      .attr('r', (d) => rScale(d))
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
      .join('line')
      .attr('class', 'cardinal-line')
      .style('stroke', this._config.grid_color ?? 'var(--primary-text-color)')
      .style('opacity', 0.3)
      .transition()
      .duration(500)
      .attr('x1', 0)
      .attr('y1', 0)
      .attr('x2', (d) => rScale(maxDistance) * Math.cos((d.angle - 90) * (Math.PI / 180)))
      .attr('y2', (d) => rScale(maxDistance) * Math.sin((d.angle - 90) * (Math.PI / 180)));

    svg
      .selectAll('.cardinal-label')
      .data(cardinalPoints)
      .join('text')
      .attr('class', 'cardinal-label')
      .text((d) => d.label)
      .style('text-anchor', 'middle')
      .style('dominant-baseline', 'middle') // Vertically center the text.
      .style('fill', this._config.grid_color ?? 'var(--primary-text-color)')
      .style('font-size', '10px')
      .transition()
      .duration(500)
      .attr('x', (d) => (rScale(maxDistance) + 10) * Math.cos((d.angle - 90) * (Math.PI / 180)))
      .attr('y', (d) => (rScale(maxDistance) + 10) * Math.sin((d.angle - 90) * (Math.PI / 180)));

    // Plot the strikes
    const strikeDots = svg
      .selectAll<SVGCircleElement, Strike>('circle.strike-dot')
      .data(strikes, (d) => d.timestamp)
      .join(
        (enter) =>
          enter
            .append('circle')
            .attr('class', (d, i) => 'strike-dot' + (i === 0 ? ' new-strike-dot' : ''))
            .style('cursor', 'pointer')
            .style('fill', (d, i) => (i === 0 ? '#FF0000' : (this._config.strike_color ?? 'var(--error-color)')))
            .attr('r', 3)
            .style('fill-opacity', (d, i) => opacityScale(i)),
        (update) =>
          update
            .attr('class', (d, i) => 'strike-dot' + (i === 0 ? ' new-strike-dot' : ''))
            .style('fill', (d, i) => (i === 0 ? '#FF0000' : (this._config.strike_color ?? 'var(--error-color)')))
            .attr('r', 3)
            .style('fill-opacity', (d, i) => opacityScale(i)),
        (exit) => exit.remove(),
      );
    // Set position and tooltip for all dots (new and updated)
    strikeDots
      .attr('cx', (d) =>
        d.azimuth !== undefined ? rScale(d.distance) * Math.cos((d.azimuth - 90) * (Math.PI / 180)) : 0,
      )
      .attr('cy', (d) =>
        d.azimuth !== undefined ? rScale(d.distance) * Math.sin((d.azimuth - 90) * (Math.PI / 180)) : 0,
      )
      .on('mouseover', (event, d) => {
        this._showTooltip(event, d, distanceUnit);
      })
      .on('mousemove', (event) => {
        this._moveTooltip(event);
      })
      .on('mouseout', () => {
        this._hideTooltip();
      });
  }

  // Fetch count entity history and use for history chart
  private async _fetchCountHistory(): Promise<Array<{ timestamp: number; value: number }>> {
    // Use Home Assistant REST API to fetch history for the count entity
    const entityId = this._config.count;
    const now = new Date();
    const start = new Date(now.getTime() - this._historyMaxAgeMs);
    const url = `history/period/${start.toISOString()}?filter_entity_id=${entityId}&minimal_response`;
    // The `minimal_response` parameter returns a different data structure, but `callApi`
    // transforms it back to the verbose format for us.
    const historyData = await this.hass.callApi<
      Array<Array<{ last_changed: string; state: string; [key: string]: unknown }>>
    >('GET', url);

    if (!Array.isArray(historyData) || !Array.isArray(historyData[0])) return [];
    return historyData[0].map((entry) => ({
      timestamp: new Date(entry.last_changed).getTime(),
      value: Number(entry.state),
    }));
  }

  private async _renderHistoryChart() {
    const container = this.shadowRoot?.querySelector('.history-chart');
    if (!container) return;
    const period = this._config.history_chart_period ?? '1h';
    let buckets: number[] = [];
    let colors: string[] = [];
    let xAxisLabels: string[] = [];
    let bucketDurationMinutes: number;
    if (period === '15m') {
      bucketDurationMinutes = 3;
      buckets = Array(5).fill(0);
      xAxisLabels = ['-3m', '-6m', '-9m', '-12m', '-15m'];
      colors = ['#FFFFFF', '#FFFF00', '#FFA500', '#FF4500', '#FF0000'];
    } else {
      bucketDurationMinutes = 10;
      buckets = Array(6).fill(0);
      xAxisLabels = ['-10m', '-20m', '-30m', '-40m', '-50m', '-60m'];
      colors = ['#FFFFFF', '#FFFF00', '#FFA500', '#FF4500', '#FF0000', '#8B0000'];
    }
    // Fetch count history
    const history = await this._fetchCountHistory();
    if (history.length < 2) return;
    // Calculate deltas per bucket
    const now = Date.now();
    for (let i = 0; i < buckets.length; i++) {
      const bucketStart = now - (i + 1) * bucketDurationMinutes * 60 * 1000;
      const bucketEnd = now - i * bucketDurationMinutes * 60 * 1000;
      const values = history.filter((h) => h.timestamp >= bucketStart && h.timestamp < bucketEnd);
      if (values.length > 1) {
        buckets[i] = values[values.length - 1].value - values[0].value;
      } else {
        buckets[i] = 0;
      }
    }

    const width = 280;
    const height = 100;
    const margin = { top: 15, right: 5, bottom: 20, left: 30 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    const yMax = Math.max(10, max(buckets) ?? 10);
    const xScale = scaleLinear().domain([0, buckets.length]).range([0, chartWidth]);
    const yScale = scaleLinear().domain([0, yMax]).range([chartHeight, 0]);

    const svgRoot = select(container)
      .selectAll('svg')
      .data([null])
      .join('svg')
      .attr('viewBox', `0 0 ${width} ${height}`);

    const svg = svgRoot
      .selectAll('g.history-main-group')
      .data([null])
      .join('g')
      .attr('class', 'history-main-group')
      .attr('transform', `translate(${margin.left}, ${margin.top})`);

    // Y-axis with labels
    const yAxis = svg.selectAll('g.y-axis').data([null]).join('g').attr('class', 'y-axis');
    const yTicks = yScale.ticks(4);
    yAxis
      .selectAll('text')
      .data(yTicks, (d) => d as number)
      .join(
        (enter) =>
          enter
            .append('text')
            .attr('x', -8)
            .attr('y', (d) => yScale(d))
            .attr('text-anchor', 'end')
            .attr('dominant-baseline', 'middle')
            .style('font-size', '10px')
            .style('fill', 'var(--secondary-text-color)')
            .text((d) => d),
        (update) =>
          update
            .transition()
            .duration(500)
            .attr('y', (d) => yScale(d))
            .text((d) => d),
        (exit) => exit.remove(),
      );

    // X-axis labels
    svg
      .selectAll('g.x-axis')
      .data([null])
      .join('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0, ${chartHeight})`)
      .selectAll('text')
      .data(xAxisLabels)
      .join('text')
      .attr('x', (d, i) => xScale(i + 0.5))
      .attr('y', 15)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .style('font-size', '10px')
      .style('fill', 'var(--secondary-text-color)')
      .text((d) => d);

    // Bars
    svg
      .selectAll('g.bars')
      .data([null])
      .join('g')
      .attr('class', 'bars')
      .selectAll('.bar')
      .data(buckets)
      .join('rect')
      .attr('class', 'bar')
      .attr('x', (d, i) => xScale(i))
      .attr('width', xScale(1) - xScale(0) - 2)
      .attr('fill', (d, i) => colors[i])
      .transition()
      .duration(500)
      .attr('y', (d) => yScale(d))
      .attr('height', (d) => chartHeight - yScale(d));

    // Add text labels on top of the bars
    svg
      .selectAll('g.bar-labels')
      .data([null])
      .join('g')
      .attr('class', 'bar-labels')
      .selectAll('.bar-label')
      .data(buckets)
      .join('text')
      .attr('class', 'bar-label')
      .attr('x', (d, i) => xScale(i + 0.5)) // Center the text horizontally in the bar
      .attr('text-anchor', 'middle')
      .style('font-size', '10px')
      .style('fill', 'var(--primary-text-color)')
      .text((d) => (d > 0 ? d : '')) // Only show text if count is > 0
      .transition()
      .duration(500)
      .attr('y', (d) => yScale(d) - 4); // Position it 4px above the bar
  }

  private _destroyMap(): void {
    if (this._map) {
      this._map.remove();
      this._map = undefined;
      this._markers = undefined;
    }
  }

  private async _getLeaflet() {
    if (!this._leaflet) {
      this._leaflet = await import('leaflet');
    }
    return this._leaflet;
  }

  private async _initMap(): Promise<void> {
    const mapContainer = this.shadowRoot?.querySelector('#map-container');
    if (!mapContainer || !(mapContainer instanceof HTMLElement) || this._map) {
      return;
    }
    const L = await this._getLeaflet();

    const darkMode = this.hass?.themes?.darkMode ?? false;
    const tileUrl = darkMode
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
    const tileAttribution = darkMode
      ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
      : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

    this._map = L.map(mapContainer, {
      zoomControl: false, // ha-map doesn't show it by default
    });
    L.tileLayer(tileUrl, {
      attribution: tileAttribution,
      maxZoom: 19,
    }).addTo(this._map);

    this._markers = L.layerGroup().addTo(this._map);

    // Invalidate size after the container is rendered and sized.
    // This is crucial for maps inside flex/grid containers.
    setTimeout(() => this._map?.invalidateSize(), 0);

    this._updateMapMarkers(); // Initial marker update
  }

  private _renderMap() {
    if (!this._config.show_map) {
      return '';
    }
    // The map will be initialized in `updated` into this container.
    return html`<div id="map-container" class="leaflet-map"></div>`;
  }

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

  updated(changedProperties: Map<string | number | symbol, unknown>): void {
    super.updated(changedProperties);
    // Always update map and radar on hass change
    const shouldUpdateVisuals = changedProperties.has('hass') || changedProperties.has('_config');

    // Map logic
    if (this._config?.show_map) {
      if (!this._map) {
        this._initMap();
      } else {
        if (shouldUpdateVisuals) {
          this._updateMapMarkers();
        }
        // Check if dark mode has changed
        if (changedProperties.has('hass')) {
          const oldHass = changedProperties.get('hass') as HomeAssistant | undefined;
          if (oldHass && this.hass.themes?.darkMode !== oldHass.themes?.darkMode) {
            this._destroyMap();
            this._initMap();
          }
        }
      }
    } else if (this._map) {
      // If map is disabled but instance exists, destroy it
      this._destroyMap();
    }

    if (shouldUpdateVisuals) {
      if (this.shadowRoot?.querySelector('.radar-chart')) {
        this._renderRadarChart();
      }
      if (this._config?.show_history_chart && this.shadowRoot?.querySelector('.history-chart')) {
        this._renderHistoryChart();
      }
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
        ${this._tooltip.visible
          ? html`<div class="custom-tooltip" style="transform: translate(${this._tooltip.x}px, ${this._tooltip.y}px);">
              ${unsafeHTML(this._tooltip.content)}
            </div>`
          : ''}
      </ha-card>
    `;
  }

  public getCardSize(): number {
    // 1 unit = 50px.
    // Header: 1 unit
    // Compass/Radar (220px): ~4 units
    // History Chart (100px): 2 units
    // Map (300px): 6 units
    let size = 1 + 4; // Header + Compass/Radar
    if (this._config?.show_history_chart) {
      size += 2;
    }
    if (this._config?.show_map) {
      size += 6;
    }
    return size;
  }

  // Provides a default configuration for the card in the UI editor
  static styles = [leafletCss, cardStyles, leafletStyles];
  static getStubConfig(): Record<string, unknown> {
    return {
      type: 'custom:blitzortung-lightning-card',
      distance: 'sensor.blitzortung_lightning_distance',
      count: 'sensor.blitzortung_lightning_counter',
      azimuth: 'sensor.blitzortung_lightning_azimuth',
      radar_max_distance: 100,
      show_map: true,
      history_chart_period: '1h',
      show_history_chart: true,
      grid_color: 'var(--primary-text-color)',
      strike_color: 'var(--error-color)',
    };
  }
}

customElements.define('blitzortung-lightning-card', BlitzortungLightningCard);
