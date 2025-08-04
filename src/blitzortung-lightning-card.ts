import { LitElement, TemplateResult, html, nothing } from 'lit';
import { property, state } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';
import { BlitzortungCardConfig, HomeAssistant, WindowWithCards } from './types';
import type { Map as LeafletMap, LayerGroup, DivIcon, Marker } from 'leaflet';
import { max } from 'd3-array';
import { scaleLinear, scalePow } from 'd3-scale';
import { select } from 'd3-selection';

// Statically import the editor to bundle it into a single file.
import sampleStrikes from './sample.json';
import './blitzortung-lightning-card-editor';
import { localize } from './localize';
import { calculateAzimuth, getDirection, destinationPoint } from './utils';
import cardStyles from './styles/blitzortung-lightning-card.scss';
import leafletCss from 'leaflet/dist/leaflet.css';
import leafletStyles from './styles/leaflet-styles.scss';

const GEO_LOCATION_PREFIX = 'geo_location.lightning_strike_';
const BLITZORTUNG_SOURCE = 'blitzortung';
const RADAR_CHART_WIDTH = 220;
const RADAR_CHART_HEIGHT = 220;
const RADAR_CHART_MARGIN = 20;
const HISTORY_CHART_WIDTH = 280;
const HISTORY_CHART_HEIGHT = 115;
const HISTORY_CHART_MARGIN = { top: 15, right: 5, bottom: 35, left: 30 };
const NEW_STRIKE_CLASS = 'new-strike';

// We filter for entities with lat/lon, so we can make them non-optional here for better type safety.
type Strike = { distance: number; azimuth: number; timestamp: number; latitude: number; longitude: number };

console.info(
  `%c BLITZORTUNG-LIGHTNING-CARD %c v__CARD_VERSION__ `,
  'color: orange; font-weight: bold; background: black',
  'color: white; font-weight: bold; background: dimgray',
);
export class BlitzortungLightningCard extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @state() private _config!: BlitzortungCardConfig;
  @state() private _compassAngle: number | undefined = undefined;
  @state() private _tooltip: { visible: boolean; content: TemplateResult | typeof nothing; x: number; y: number } = {
    visible: false,
    content: nothing,
    x: 0,
    y: 0,
  };
  @state() private _historyData: Array<{ timestamp: number; value: number }> = [];
  @state() private _lastStrikeFromHistory: Date | null = null;
  @state() private _displayedSampleStrikes: Strike[] = [];
  private _map: LeafletMap | undefined = undefined;
  private _markers: LayerGroup | undefined = undefined;
  private _strikeMarkers: Map<number, Marker> = new Map();
  private _homeMarker: Marker | undefined;
  private _newestStrikeTimestamp: number | null = null;
  private _leaflet: typeof import('leaflet') | undefined;
  private _sampleStrikeTimer: number | undefined;
  private _editMode: boolean = false;
  @state() private _userInteractedWithMap = false;
  private _programmaticMapChange = false;
  private _recenterButton: HTMLElement | undefined;

  public setConfig(config: BlitzortungCardConfig): void {
    if (!config) {
      throw new Error('Invalid configuration');
    }
    const requiredEntities = ['distance', 'counter', 'azimuth'] as const;
    const missingKeys = requiredEntities.filter((key) => !config[key]);

    if (missingKeys.length > 0) {
      throw new Error(`The following required configuration options are missing: ${missingKeys.join(', ')}`);
    }
    this._config = config;
  }

  connectedCallback(): void {
    super.connectedCallback();
    // Add a listener to handle when the tab's visibility changes
    document.addEventListener('visibilitychange', this._handleVisibilityChange);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('visibilitychange', this._handleVisibilityChange);
    this._stopSampleStrikeAnimation();
    this._destroyMap();
  }

  /**
   * Called when the card is in edit mode.
   * @param editMode True if the card is in edit mode.
   */
  public set editMode(editMode: boolean) {
    this._editMode = editMode;
    if (editMode) {
      this._userInteractedWithMap = false; // Reset to show auto-zoom animation
      this._startSampleStrikeAnimation();
    } else {
      this._stopSampleStrikeAnimation();
      this._displayedSampleStrikes = [];
    }
    this.requestUpdate(); // Request an update to re-render with the new mode
  }

  private _handleVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') {
      // The tab has become visible. A small timeout allows the browser to
      // settle before we force a redraw. This prevents issues with animations
      setTimeout(() => {
        if (this.isConnected && this._config) {
          if (this._editMode) {
            this._startSampleStrikeAnimation();
          }
          const strikes = this._getStrikesToShow();
          this._renderRadarChart(strikes);
          this._renderHistoryChart();
          if (this._map) {
            this._map.invalidateSize();
          }
        }
      }, 100); // 100ms delay is a safe value
    } else {
      // Tab is not visible, stop animation to save resources
      if (this._editMode) {
        this._stopSampleStrikeAnimation();
      }
    }
  };

  private _startSampleStrikeAnimation(): void {
    this._stopSampleStrikeAnimation();
    this._displayedSampleStrikes = [];
    const allSampleStrikes = [...this._getSampleStrikes()].reverse(); // Oldest first.

    let index = 0;
    const addStrike = () => {
      if (!this._editMode || index >= allSampleStrikes.length) {
        this._stopSampleStrikeAnimation();
        return;
      }
      // Create a new array with the new strike at the beginning
      const newStrikes = [allSampleStrikes[index], ...this._displayedSampleStrikes];

      // Re-calculate all timestamps to simulate aging
      const now = Date.now();
      this._displayedSampleStrikes = newStrikes.map((strike, strikeIndex) => ({
        ...strike,
        timestamp: now - strikeIndex * 60_000, // 1 minute older for each previous strike
      }));

      index++;
    };

    // Add first strike immediately to start the animation
    addStrike();
    this._sampleStrikeTimer = window.setInterval(addStrike, 2000); // Add a new strike every 2 seconds
  }

  private _stopSampleStrikeAnimation(): void {
    if (this._sampleStrikeTimer) {
      clearInterval(this._sampleStrikeTimer);
      this._sampleStrikeTimer = undefined;
    }
  }

  public static getConfigElement() {
    // The editor element itself will handle waiting for any necessary components.
    // We return it immediately to prevent deadlocks.
    return document.createElement('blitzortung-lightning-card-editor');
  }

  protected willUpdate(changedProperties: Map<string | number | symbol, unknown>): void {
    if (!this._config) return;

    const hassChanged = changedProperties.has('hass');
    const configChanged = changedProperties.has('_config');
    const sampleStrikesChanged = this._editMode && changedProperties.has('_displayedSampleStrikes');
    const shouldUpdateAngle = hassChanged || configChanged || sampleStrikesChanged;

    if (shouldUpdateAngle) {
      const { azimuth } = this._getCompassDisplayData();
      const newAzimuth = parseFloat(azimuth);

      if (!isNaN(newAzimuth)) {
        if (this._compassAngle === undefined) {
          this._compassAngle = newAzimuth;
        } else {
          const currentAngle = this._compassAngle;
          const normalizedCurrentAngle = ((currentAngle % 360) + 360) % 360;

          let diff = newAzimuth - normalizedCurrentAngle;
          if (diff > 180) diff -= 360;
          else if (diff < -180) diff += 360;

          this._compassAngle += diff;
        }
      }
    }
  }

  private get _historyMaxAgeMs(): number {
    const period = this._config.history_chart_period ?? '1h';
    if (period === '15m') {
      return 15 * 60 * 1000;
    }
    return 60 * 60 * 1000; // 1h
  }

  private get _radarMaxAgeMs(): number {
    const period = this._config.radar_period ?? '30m';
    if (period === '15m') {
      return 15 * 60 * 1000;
    }
    if (period === '1h') {
      return 60 * 60 * 1000;
    }
    return 30 * 60 * 1000; // 30m
  }

  private _getHomeCoordinates(): { lat: number; lon: number } | null {
    const homeZone = this.hass.states['zone.home'];
    // Prefer zone.home coordinates, fallback to HA core configuration
    const lat = (homeZone?.attributes.latitude as number) ?? this.hass.config.latitude;
    const lon = (homeZone?.attributes.longitude as number) ?? this.hass.config.longitude;

    if (lat != null && lon != null) {
      return { lat, lon };
    }
    return null;
  }

  private _getSampleStrikes(): Strike[] {
    const homeCoords = this._getHomeCoordinates();
    if (!homeCoords) return [];
    const strikes = sampleStrikes.map((strike) => {
      const dest = destinationPoint(homeCoords.lat, homeCoords.lon, strike.distance, strike.azimuth);

      return {
        ...strike,
        timestamp: 0, // Placeholder, will be set dynamically in the animation
        latitude: dest.latitude,
        longitude: dest.longitude,
      };
    });
    return strikes;
  }

  private _getStrikesToShow(): Strike[] {
    const recentStrikes = this._getRecentStrikes();
    if (this._editMode && recentStrikes.length === 0) {
      return this._displayedSampleStrikes;
    }
    return recentStrikes;
  }

  // New: Get recent strikes from geo_location entities
  private _getRecentStrikes(): Strike[] {
    const now = Date.now();
    const oldestTimestamp = now - this._radarMaxAgeMs;

    const homeCoords = this._getHomeCoordinates();
    if (!homeCoords) return [];
    const { lat: homeLat, lon: homeLon } = homeCoords; // Cannot calculate azimuth without a home location.

    return Object.values(this.hass.states)
      .filter(
        (entity) =>
          entity &&
          entity.entity_id.startsWith(GEO_LOCATION_PREFIX) &&
          entity.attributes.source === BLITZORTUNG_SOURCE &&
          entity.attributes.latitude != null &&
          entity.attributes.longitude != null,
      )
      .map((entity) => {
        const pubDate = new Date(entity.attributes.publication_date as string).getTime();
        const latitude = Number(entity.attributes.latitude);
        const longitude = Number(entity.attributes.longitude);
        return {
          distance: Number(entity.state),
          azimuth: calculateAzimuth(homeLat, homeLon, latitude, longitude),
          timestamp: pubDate,
          latitude,
          longitude,
        };
      })
      .filter((strike): strike is Strike => strike.timestamp > oldestTimestamp && !isNaN(strike.distance))
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  private _getStrikeTooltipContent(strike: Strike, distanceUnit: string): TemplateResult {
    const azimuth = typeof strike.azimuth === 'number' && !isNaN(strike.azimuth) ? strike.azimuth : 0;
    const direction = getDirection(this.hass, azimuth);
    const relativeTimeEl = html`<ha-relative-time
      .hass=${this.hass}
      .datetime=${new Date(strike.timestamp)}
    ></ha-relative-time>`;

    const distanceLabel = localize(this.hass, 'component.blc.card.tooltips.distance');
    const directionLabel = localize(this.hass, 'component.blc.card.tooltips.direction');
    const timeLabel = localize(this.hass, 'component.blc.card.tooltips.time');

    return html`
      <strong>${distanceLabel}:</strong> ${strike.distance.toFixed(1)} ${distanceUnit}<br />
      <strong>${directionLabel}:</strong> ${azimuth.toFixed(0)}° ${direction}<br />
      <strong>${timeLabel}:</strong> ${relativeTimeEl}
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

    // Check if tooltip is near the right edge, if so, position it to the bottom left
    const tooltipGoesLeft = x > cardRect.width - 100; // 100px is a rough estimate of tooltip width
    const xOffset = tooltipGoesLeft ? -115 : 0;

    // Add a small offset to prevent the tooltip from flickering by being under the cursor
    this._tooltip = { ...this._tooltip, x: x + xOffset, y: y + 15 };
  }

  private _hideTooltip(): void {
    if (this._tooltip.visible) {
      this._tooltip = { ...this._tooltip, visible: false, content: nothing };
    }
  }

  private _renderCompass(
    azimuth: string,
    distance: string,
    distanceUnit: string,
    count: string,
    displayAngle?: number,
  ) {
    const angle = Number.parseFloat(azimuth);
    if (isNaN(angle)) {
      return '';
    }

    const rotationAngle = displayAngle ?? angle;
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
          <text
            x="50"
            y="5"
            font-size="4.5"
            text-anchor="middle"
            dominant-baseline="middle"
            fill=${this._config.font_color ?? gridColor}
          >
            ${localize(this.hass, 'component.blc.card.directions.N')}
          </text>
          <text
            x="95"
            y="50"
            font-size="4.5"
            text-anchor="middle"
            dominant-baseline="middle"
            fill=${this._config.font_color ?? gridColor}
          >
            ${localize(this.hass, 'component.blc.card.directions.E')}
          </text>
          <text
            x="50"
            y="95"
            font-size="4.5"
            text-anchor="middle"
            dominant-baseline="middle"
            fill=${this._config.font_color ?? gridColor}
          >
            ${localize(this.hass, 'component.blc.card.directions.S')}
          </text>
          <text
            x="5"
            y="50"
            font-size="4.5"
            text-anchor="middle"
            dominant-baseline="middle"
            fill=${this._config.font_color ?? gridColor}
          >
            ${localize(this.hass, 'component.blc.card.directions.W')}
          </text>

          <!-- Pointer Arrow -->
          <g class="compass-pointer" style="transform: rotate(${rotationAngle}deg);">
            <path d="M 50 10 L 53 19.6 L 47 19.6 Z" fill=${strikeColor} />
          </g>

          <!-- Center Text -->
          <a class="clickable-entity" data-entity-id="${this._config.counter}" @click=${this._handleEntityClick}>
            <text
              x="50"
              y="35"
              font-size="6"
              text-anchor="middle"
              dominant-baseline="central"
              fill=${this._config.font_color ?? gridColor}
            >
              ${count} ⚡
            </text>
          </a>
          <a class="clickable-entity" data-entity-id="${this._config.azimuth}" @click=${this._handleEntityClick}>
            <text
              x="50"
              y="50"
              font-size="9"
              text-anchor="middle"
              dominant-baseline="central"
              fill=${this._config.font_color ?? gridColor}
            >
              ${azimuth}° ${directionText}
            </text>
          </a>
          <a class="clickable-entity" data-entity-id="${this._config.distance}" @click=${this._handleEntityClick}>
            <text
              x="50"
              y="65"
              font-size="6"
              text-anchor="middle"
              dominant-baseline="central"
              fill=${this._config.font_color ?? gridColor}
            >
              ${distance} ${distanceUnit}
            </text>
          </a>
        </svg>
      </div>
    `;
  }

  private _autoZoomMap(bounds: L.LatLngBounds, homeCoords: { lat: number; lon: number } | null): void {
    if (!this._map || this._userInteractedWithMap) {
      return;
    }

    const L = this._leaflet!;
    let zoomFunc: (() => void) | null = null;

    if (bounds.isValid()) {
      zoomFunc = () => this._map!.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
    } else if (this._map.getZoom() === 0 && homeCoords) {
      const { lat: homeLat, lon: homeLon } = homeCoords;
      zoomFunc = () => this._map!.setView([homeLat, homeLon], 10);
    }

    if (zoomFunc) {
      const mapContainer = this._map.getContainer();
      this._programmaticMapChange = true;
      L.DomUtil.addClass(mapContainer, 'interaction-disabled');

      this._map.once('moveend', () => {
        this._programmaticMapChange = false;
        if (this._map) {
          L.DomUtil.removeClass(mapContainer, 'interaction-disabled');
        }
      });
      zoomFunc();
    }
  }

  private async _updateMapMarkers(strikes: Strike[]): Promise<void> {
    if (!this._map) return;
    const L = await this._getLeaflet();
    if (!this._markers) {
      this._markers = L.layerGroup().addTo(this._map);
    }
    const distanceUnit = this.hass.states[this._config.distance]?.attributes.unit_of_measurement ?? 'km';
    const bounds = L.latLngBounds([]);

    // Home marker
    const homeCoords = this._getHomeCoordinates();

    if (homeCoords) {
      const { lat: homeLat, lon: homeLon } = homeCoords;
      if (!this._homeMarker) {
        const homeIcon: DivIcon = L.divIcon({
          html: `<div class="leaflet-home-marker"><ha-icon icon="mdi:home"></ha-icon></div>`,
          className: '',
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        });
        this._homeMarker = L.marker([homeLat, homeLon], {
          icon: homeIcon,
          title: this.hass.states['zone.home']?.attributes.friendly_name || 'Home',
          zIndexOffset: 0,
        }).addTo(this._markers);
      } else {
        this._homeMarker.setLatLng([homeLat, homeLon]);
      }
      bounds.extend(this._homeMarker.getLatLng());
    } else if (this._homeMarker) {
      this._markers?.removeLayer(this._homeMarker);
      this._homeMarker = undefined;
    }

    // Strikes (newest first, up to 100)
    const mapStrikes = strikes.slice(0, 100);
    const newStrikeTimestamps = new Set(mapStrikes.map((s) => s.timestamp));
    const currentNewestStrike = mapStrikes.length > 0 ? mapStrikes[0] : null;

    const previousNewestTimestamp = this._newestStrikeTimestamp;

    // Add new markers and update existing ones
    mapStrikes.forEach((strike, index) => {
      const isNewest = index === 0;
      const zIndex = mapStrikes.length - index + (isNewest ? 1000 : 0);
      if (!this._strikeMarkers.has(strike.timestamp)) {
        // This is a new strike to be added to the map
        const strikeIcon: DivIcon = L.divIcon({
          html: `<div class="leaflet-strike-marker"><ha-icon icon="mdi:flash"></ha-icon></div>`,
          className: 'leaflet-strike-marker-wrapper', // A wrapper for positioning to avoid transform conflicts
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        });
        const strikeMarker = L.marker([strike.latitude, strike.longitude], {
          icon: strikeIcon,
          zIndexOffset: zIndex,
        }).addTo(this._markers!);

        strikeMarker.on('mouseover', (e) => this._showTooltip(e, strike, distanceUnit));
        strikeMarker.on('mousemove', (e) => this._moveTooltip(e));
        strikeMarker.on('mouseout', () => this._hideTooltip());

        this._strikeMarkers.set(strike.timestamp, strikeMarker);
      } else {
        // This is an existing strike, update its zIndex to ensure correct stacking
        const existingMarker = this._strikeMarkers.get(strike.timestamp);
        if (existingMarker) {
          existingMarker.setZIndexOffset(zIndex);
        }
      }
      // Extend bounds for all strikes in the current view
      bounds.extend([strike.latitude, strike.longitude]);
    });

    // Remove old markers that are no longer in the list
    this._strikeMarkers.forEach((marker, timestamp) => {
      if (!newStrikeTimestamps.has(timestamp)) {
        this._markers?.removeLayer(marker);
        this._strikeMarkers.delete(timestamp);
      }
    });

    // Update the 'new-strike' class for the newest marker
    if (currentNewestStrike?.timestamp !== previousNewestTimestamp) {
      // Remove class from the previously newest marker
      if (previousNewestTimestamp) {
        this._strikeMarkers.get(previousNewestTimestamp)?.getElement()?.classList.remove(NEW_STRIKE_CLASS);
      }
      // Add class to the new newest marker
      const newMarker = currentNewestStrike ? this._strikeMarkers.get(currentNewestStrike.timestamp) : undefined;
      // We need to wait for the next frame to ensure the marker has been positioned by Leaflet
      // before we add the animation class. This prevents the animation from starting at the top-left corner.
      if (newMarker) {
        requestAnimationFrame(() => newMarker.getElement()?.classList.add(NEW_STRIKE_CLASS));
      }
    }

    // Update the newest strike timestamp
    this._newestStrikeTimestamp = currentNewestStrike ? currentNewestStrike.timestamp : null;
    this._autoZoomMap(bounds, homeCoords);
  }

  private _renderRadarChart(strikes: Strike[]) {
    const radarContainer = this.shadowRoot?.querySelector('.radar-chart');
    if (!radarContainer) return;

    const now = Date.now();
    const maxAge = this._radarMaxAgeMs;
    const halfMaxAge = now - maxAge / 2;
    const endOfLife = now - maxAge;

    const chartRadius = Math.min(RADAR_CHART_WIDTH, RADAR_CHART_HEIGHT) / 2 - RADAR_CHART_MARGIN;
    const distanceEntity = this.hass.states[this._config.distance];
    const distanceUnit = distanceEntity?.attributes.unit_of_measurement ?? 'km';
    const autoRadar = this._config.auto_radar_max_distance === true;
    const maxDistance = autoRadar ? (max(strikes, (d) => d.distance) ?? 100) : (this._config.radar_max_distance ?? 100);

    const rScale = scaleLinear().domain([0, maxDistance]).range([0, chartRadius]);
    const opacityScale = scalePow().exponent(0.7).domain([now, halfMaxAge, endOfLife]).range([1, 0.25, 0]).clamp(true);
    const svgRoot = select(radarContainer)
      .selectAll('svg')
      .data([null])
      .join('svg')
      .attr('viewBox', `0 0 ${RADAR_CHART_WIDTH} ${RADAR_CHART_HEIGHT}`)
      .attr('role', 'img')
      .attr('aria-labelledby', 'radar-title radar-desc');

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
      .attr('transform', `translate(${RADAR_CHART_WIDTH / 2}, ${RADAR_CHART_HEIGHT / 2})`);

    // Add background circles (grid)
    const gridCircles = rScale.ticks(4).slice(1);
    svg
      .selectAll('.grid-circle')
      .data(gridCircles)
      .join(
        (enter) => enter.append('circle').attr('class', 'grid-circle').style('fill', 'none'),
        (update) => update,
        (exit) => exit.remove(),
      )
      .attr('r', (d) => rScale(d))
      .style('stroke', this._config.grid_color ?? 'var(--primary-text-color)')
      .style('opacity', 0.3);
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
      .style('dominant-baseline', 'middle')
      .style('fill', this._config.font_color ?? this._config.grid_color ?? 'var(--primary-text-color)')
      .style('font-size', '10px')
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
            .style('fill', this._config.strike_color ?? 'var(--error-color)')
            .style('fill-opacity', (d) => opacityScale(d.timestamp))
            .attr('r', 3),
        (update) =>
          update
            .attr('class', (d, i) => 'strike-dot' + (i === 0 ? ' new-strike-dot' : ''))
            .style('fill', this._config.strike_color ?? 'var(--error-color)')
            .style('fill-opacity', (d) => opacityScale(d.timestamp))
            .attr('r', 3),
        (exit) => exit.remove(),
      );
    // Set position and tooltip for all dots (new and updated)
    strikeDots
      .attr('cx', (d) => rScale(d.distance) * Math.cos((d.azimuth - 90) * (Math.PI / 180)))
      .attr('cy', (d) => rScale(d.distance) * Math.sin((d.azimuth - 90) * (Math.PI / 180)))
      .style('cursor', 'pointer')
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
    const entityId = this._config.counter;
    const now = new Date();
    const start = new Date(now.getTime() - this._historyMaxAgeMs);
    const url = `history/period/${start.toISOString()}?filter_entity_id=${entityId}&minimal_response`;
    // The `minimal_response` parameter returns a different data structure, but `callApi`
    // transforms it back to the verbose format for us.
    const historyData = await this.hass.callApi<
      Array<Array<{ last_changed: string; state: string; [key: string]: unknown }>>
    >('GET', url);

    if (!Array.isArray(historyData) || !Array.isArray(historyData[0])) return [];
    return historyData[0]
      .map((entry) => ({
        timestamp: new Date(entry.last_changed).getTime(),
        value: Number(entry.state),
      }))
      .filter((entry) => !isNaN(entry.value));
  }

  private _processHistoryData(): number[] {
    const period = this._config.history_chart_period ?? '1h';
    let bucketDurationMinutes: number;
    if (period === '15m') {
      bucketDurationMinutes = 3;
    } else {
      bucketDurationMinutes = 10;
    }
    // Fetch count history
    if (this._historyData.length < 2) {
      return period === '15m' ? Array(5).fill(0) : Array(6).fill(0);
    }

    // The history data from the API is already sorted chronologically, so no need to sort again.
    const sortedHistory = this._historyData;
    // Calculate deltas (increases) between consecutive history points
    const deltas = [];
    for (let i = 1; i < sortedHistory.length; i++) {
      const strikeCount = sortedHistory[i].value - sortedHistory[i - 1].value;
      if (strikeCount > 0) {
        deltas.push({
          timestamp: sortedHistory[i].timestamp,
          count: strikeCount,
        });
      }
    }

    // Assign deltas to time buckets
    const now = Date.now();
    const buckets = period === '15m' ? Array(5).fill(0) : Array(6).fill(0);
    for (const delta of deltas) {
      const ageMinutes = (now - delta.timestamp) / (60 * 1000);
      if (ageMinutes < bucketDurationMinutes * buckets.length) {
        const bucketIndex = Math.floor(ageMinutes / bucketDurationMinutes);
        buckets[bucketIndex] += delta.count;
      }
    }
    return buckets;
  }

  private _renderHistoryChart() {
    const container = this.shadowRoot?.querySelector('.history-chart');
    if (!container) return;

    const isInEditMode = this._editMode;

    let buckets = this._processHistoryData();

    // Use sample data for editor preview if no real data is available
    if (isInEditMode && !buckets.some((c) => c > 0)) {
      buckets = this._config.history_chart_period === '15m' ? [2, 1, 4, 1, 2] : [1, 2, 4, 1, 2, 1];
    }

    const period = this._config.history_chart_period ?? '1h';
    const barColor = this._config.history_chart_bar_color;
    let defaultColors: string[] = [];
    let xAxisLabels: string[] = [];
    if (period === '15m') {
      xAxisLabels = ['-3', '-6', '-9', '-12', '-15'];
      defaultColors = ['#8B0000', '#D22B2B', '#FF7F00', '#FFD700', '#CCCCCC'];
    } else {
      xAxisLabels = ['-10', '-20', '-30', '-40', '-50', '-60'];
      defaultColors = ['#8B0000', '#B22222', '#D22B2B', '#FF7F00', '#FFD700', '#CCCCCC'];
    }

    const barFillColors = barColor ? Array(buckets.length).fill(barColor) : defaultColors;

    const chartWidth = HISTORY_CHART_WIDTH - HISTORY_CHART_MARGIN.left - HISTORY_CHART_MARGIN.right;
    const chartHeight = HISTORY_CHART_HEIGHT - HISTORY_CHART_MARGIN.top - HISTORY_CHART_MARGIN.bottom;

    const yMax = Math.max(10, max(buckets) ?? 10);
    const xScale = scaleLinear().domain([0, buckets.length]).range([0, chartWidth]);

    const yScale = scaleLinear().domain([0, yMax]).range([chartHeight, 0]);

    const svgRoot = select(container)
      .selectAll('svg')
      .data([null])
      .join('svg')
      .attr('viewBox', `0 0 ${HISTORY_CHART_WIDTH} ${HISTORY_CHART_HEIGHT}`);

    const svg = svgRoot
      .selectAll('g.history-main-group')
      .data([null])
      .join('g')
      .attr('class', 'history-main-group')
      .attr('transform', `translate(${HISTORY_CHART_MARGIN.left}, ${HISTORY_CHART_MARGIN.top})`);

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
            .style('fill', this._config.font_color ?? 'var(--secondary-text-color)')
            .text((d) => d),
        (update) => update.attr('y', (d) => yScale(d)).text((d) => d),
        (exit) => exit.remove(),
      );

    // X-axis labels
    const xAxisGroup = svg
      .selectAll('g.x-axis')
      .data([null])
      .join('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0, ${chartHeight})`);

    xAxisGroup
      .selectAll('text.x-label')
      .data(xAxisLabels)
      .join('text')
      .attr('class', 'x-label')
      .attr('x', (d, i) => xScale(i + 0.5))
      .attr('y', 15)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .style('font-size', '10px')
      .style('fill', this._config.font_color ?? 'var(--secondary-text-color)')
      .text((d) => d);

    // Add x-axis unit label
    xAxisGroup
      .selectAll('text.x-unit-label')
      .data([localize(this.hass, 'component.blc.card.minutes_ago')])
      .join('text')
      .attr('class', 'x-unit-label')
      .attr('x', chartWidth)
      .attr('y', 30)
      .attr('text-anchor', 'end')
      .attr('dominant-baseline', 'middle')
      .style('font-size', '10px')
      .style('fill', this._config.font_color ?? 'var(--secondary-text-color)')
      .text((d) => d);

    // Bars
    const opacityScale = barColor
      ? scaleLinear()
          .domain([0, buckets.length - 1])
          .range([1, 0.2])
      : null;

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
      .attr('fill', (d, i) => barFillColors[i])
      .attr('fill-opacity', (d, i) => (opacityScale ? opacityScale(i) : 1))
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
      .style('fill', this._config.font_color ?? 'var(--primary-text-color)')
      .text((d) => (d > 0 ? d : '')) // Only show text if count is > 0
      .attr('y', (d) => yScale(d) - 4); // Position it 4px above the bar
  }

  private async _updateLastStrikeTime(): Promise<void> {
    const entityId = this._config.counter;
    if (!entityId) return;

    const now = new Date();
    // Look back 7 days, which should be sufficient and is a common retention period.
    const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    // We make the API call as explicit as possible to avoid issues with default behaviors.
    // - `end_time` is specified to ensure we get data up to now.
    // - `significant_changes_only=0` is added to get all state changes, including
    //   those that might be filtered out by default on long history queries.
    // - `minimal_response` is removed as it might be causing issues with incomplete data returns.
    const url = `history/period/${start.toISOString()}?end_time=${now.toISOString()}&filter_entity_id=${entityId}&no_attributes&significant_changes_only=0`;

    try {
      // The response contains the full entity object, but we only need last_changed and state.
      const historyData = await this.hass.callApi<Array<Array<{ last_changed: string; state: string }>>>('GET', url);

      if (!historyData || !Array.isArray(historyData[0]) || historyData[0].length < 1) {
        // If no history, fallback to the entity's last_changed
        const counterEntity = this.hass.states[entityId];
        this._lastStrikeFromHistory = counterEntity?.last_changed ? new Date(counterEntity.last_changed) : null;
        return;
      }

      // The history API returns data chronologically, so we don't need to sort it again.
      const history = historyData[0]
        .map((entry) => ({
          timestamp: new Date(entry.last_changed).getTime(),
          value: Number(entry.state),
        }))
        .filter((entry) => !isNaN(entry.value)); // Filter out 'unavailable' etc.

      if (history.length < 2) {
        // Not enough data to find an increase, use the latest available point or fallback.
        const counterEntity = this.hass.states[entityId];
        const lastHistoryTimestamp = history.length === 1 ? new Date(history[0].timestamp) : null;
        this._lastStrikeFromHistory =
          lastHistoryTimestamp ?? (counterEntity?.last_changed ? new Date(counterEntity.last_changed) : null);
        return;
      }

      for (let i = history.length - 1; i > 0; i--) {
        if (history[i].value > history[i - 1].value) {
          this._lastStrikeFromHistory = new Date(history[i].timestamp);
          return;
        }
      }

      // If no increase was found in the history, it means the value has been constant or decreasing.
      // We can fallback to the entity's last_changed as a last resort.
      const counterEntity = this.hass.states[entityId];
      this._lastStrikeFromHistory = counterEntity?.last_changed ? new Date(counterEntity.last_changed) : null;
    } catch (err) {
      console.error('Error fetching history for last strike time:', err);
      // Fallback in case of API error
      const counterEntity = this.hass.states[entityId];
      this._lastStrikeFromHistory = counterEntity?.last_changed ? new Date(counterEntity.last_changed) : null;
    }
  }

  private _destroyMap(): void {
    if (this._map) {
      this._map.remove();
      this._map = undefined;
      this._markers = undefined;
      this._strikeMarkers.clear();
      this._homeMarker = undefined;
      this._newestStrikeTimestamp = null;
      this._recenterButton = undefined;
      this._userInteractedWithMap = false;
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

    let darkMode: boolean;
    if (this._config.map_theme_mode === 'dark') {
      darkMode = true;
    } else if (this._config.map_theme_mode === 'light') {
      darkMode = false;
    } else {
      darkMode = this.hass?.themes?.darkMode ?? false;
    }

    const tileUrl = darkMode
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
    const tileAttribution = darkMode
      ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
      : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

    this._map = L.map(mapContainer, {
      zoomControl: true,
    });
    L.tileLayer(tileUrl, {
      attribution: tileAttribution,
      maxZoom: 19,
    }).addTo(this._map);

    this._markers = L.layerGroup().addTo(this._map);

    // Listen for user interaction to disable auto-zoom
    this._map.on('zoomstart movestart dragstart', () => {
      // If the flag is set, it's a programmatic change, so we don't mark it as user interaction.
      // The flag will be reset on 'moveend' after the programmatic change is complete.
      if (!this._programmaticMapChange) {
        this._userInteractedWithMap = true;
      }
    });

    // Add a recenter button
    const recenterControl = L.Control.extend({
      options: {
        position: 'topleft',
      },
      onAdd: () => {
        const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
        const link = L.DomUtil.create('a', 'recenter-button', container);
        this._recenterButton = link;
        link.innerHTML = `<ha-icon icon="mdi:crosshairs-gps"></ha-icon>`;
        link.href = '#';
        link.title = 'Recenter Map';
        link.setAttribute('role', 'button');
        link.setAttribute('aria-label', 'Recenter Map');

        L.DomEvent.on(link, 'click', L.DomEvent.stop).on(link, 'click', () => {
          this._userInteractedWithMap = false;
          const strikesToShow = this._getStrikesToShow();
          this._updateMapMarkers(strikesToShow);
        });

        return container;
      },
    });
    this._map.addControl(new recenterControl());

    // Invalidate size after the container is rendered and sized.
    // This is crucial for maps inside flex/grid containers.

    setTimeout(() => {
      if (this._map) {
        this._map.invalidateSize();
        // Now that the map is sized, do the initial update.
        const strikesToShow = this._getStrikesToShow();
        this._updateMapMarkers(strikesToShow);
        this._updateRecenterButtonState();
      }
    }, 0);
  }

  private _updateRecenterButtonState(): void {
    if (!this._recenterButton || !this._leaflet) {
      return;
    }
    const L = this._leaflet;

    if (this._userInteractedWithMap) {
      L.DomUtil.removeClass(this._recenterButton, 'active');
      this._recenterButton.title = 'Recenter map and enable auto-zoom';
    } else {
      L.DomUtil.addClass(this._recenterButton, 'active');
      this._recenterButton.title = 'Auto-zoom enabled';
    }
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

  private _getCompassDisplayData(): { azimuth: string; distance: string; distanceUnit: string; count: string } {
    const strikesToShow = this._getStrikesToShow();
    const distanceEntity = this.hass.states[this._config.distance];
    const distanceUnit = (distanceEntity?.attributes.unit_of_measurement as string) ?? 'km';

    // In edit mode with no real data, use the animated sample strikes to populate the compass.
    const useSampleData = this._editMode && strikesToShow.length > 0 && this._getRecentStrikes().length === 0;

    if (useSampleData) {
      const newestSampleStrike = strikesToShow[0];
      return {
        distance: newestSampleStrike.distance.toFixed(1),
        azimuth: String(Math.round(newestSampleStrike.azimuth)),
        count: String(strikesToShow.length),
        distanceUnit,
      };
    }

    const distanceState = distanceEntity?.state;
    const distanceValue = distanceState ? parseFloat(distanceState) : NaN;

    return {
      distance: !isNaN(distanceValue) ? distanceValue.toFixed(1) : (distanceState ?? 'N/A'),
      count: this.hass.states[this._config.counter]?.state ?? 'N/A',
      azimuth: this.hass.states[this._config.azimuth]?.state ?? 'N/A',
      distanceUnit,
    };
  }

  updated(changedProperties: Map<string | number | symbol, unknown>): void {
    super.updated(changedProperties);

    if (!this._config) {
      return;
    }

    if (changedProperties.has('_userInteractedWithMap')) {
      this._updateRecenterButtonState();
    }

    const hassChanged = changedProperties.has('hass');
    const configChanged = changedProperties.has('_config');
    const sampleStrikesChanged = this._editMode && changedProperties.has('_displayedSampleStrikes');
    const shouldUpdateVisuals = hassChanged || configChanged || sampleStrikesChanged;

    let mapJustInitialized = false;
    // Handle map visibility and theme changes first
    if (this._config?.show_map) {
      if (!this._map) {
        this._initMap();
        mapJustInitialized = true;
      } else if (hassChanged) {
        const oldHass = changedProperties.get('hass') as HomeAssistant | undefined;
        // Only re-init map on theme change if theme is not overridden
        if (oldHass && !this._config.map_theme_mode && this.hass.themes?.darkMode !== oldHass.themes?.darkMode) {
          this._destroyMap();
          this._initMap();
          // initMap already updates visuals, so we can skip the next block for this update cycle
          return;
        }
      }
    } else if (this._map) {
      this._destroyMap();
    }

    // If visuals need updating, re-render things.
    if (shouldUpdateVisuals) {
      const strikesToShow = this._getStrikesToShow();

      if (strikesToShow.length === 0 && !this._editMode) {
        // No recent strikes, let's find the last one from history.
        // We only need to do this if the counter entity has changed.
        if (hassChanged) {
          const oldHass = changedProperties.get('hass') as HomeAssistant | undefined;
          const counterEntityChanged =
            !oldHass || oldHass.states[this._config.counter] !== this.hass.states[this._config.counter];

          if (counterEntityChanged) {
            this._updateLastStrikeTime();
          }
        }
      }

      // The map is updated either by _initMap or here.
      // If it was just initialized, we don't need to update it again.
      if (this._config?.show_map && this._map && !mapJustInitialized) {
        this._updateMapMarkers(strikesToShow);
      }
      if (this.shadowRoot?.querySelector('.radar-chart')) {
        this._renderRadarChart(strikesToShow);
      }
    }

    // History chart logic
    if (this._config?.show_history_chart) {
      const oldHass = changedProperties.get('hass') as HomeAssistant | undefined;
      const oldCount = oldHass?.states[this._config.counter]?.state;
      const newCount = this.hass.states[this._config.counter]?.state;

      // Only fetch history if the config changed or a new strike was detected.
      if (configChanged || (oldHass && oldCount !== newCount)) {
        this._fetchCountHistory()
          .then((data) => {
            this._historyData = data;
          })
          .catch((err) => {
            console.error('Error fetching history for chart:', err);
            this._historyData = []; // Clear data on error to prevent rendering stale info
          });
      }
      if (this.shadowRoot?.querySelector('.history-chart')) {
        this._renderHistoryChart();
      }
    }
  }

  protected render() {
    if (!this.hass || !this._config) {
      return html``;
    }

    const requiredEntities = ['distance', 'counter', 'azimuth'] as const;
    const missingEntityDetails = requiredEntities
      .map((key) => ({
        key,
        entityId: this._config[key],
      }))
      .filter(({ entityId }) => !entityId || !this.hass.states[entityId]);

    if (missingEntityDetails.length > 0) {
      return html`
        <ha-card .header=${this._config.title ?? localize(this.hass, 'component.blc.card.default_title')}>
          <div class="card-content error-message">
            ${localize(this.hass, 'component.blc.card.missing_entities_message')}:
            <ul>
              ${missingEntityDetails.map(
                ({ key, entityId }) =>
                  html`<li>
                    <strong>${localize(this.hass, `component.blc.editor.${key}_entity`)}:</strong> ${entityId ||
                    'Not configured'}
                  </li>`,
              )}
            </ul>
          </div>
        </ha-card>
      `;
    }

    const title = this._config.title ?? localize(this.hass, 'component.blc.card.default_title');
    const strikesToShow = this._getStrikesToShow();

    const { azimuth, distance, distanceUnit, count } = this._getCompassDisplayData();

    const historyBuckets = this._config.show_history_chart ? this._processHistoryData() : [];
    const hasHistoryToShow = historyBuckets.some((c) => c > 0);

    const isInEditMode = this._editMode;

    return html`
      <ha-card .header=${title}>
        <div class="card-content">
          ${strikesToShow.length > 0
            ? html`<div class="content-container">
                ${this._renderCompass(azimuth, distance, distanceUnit, count, this._compassAngle)}
                <div class="radar-chart"></div>
              </div>`
            : html`
                <div class="no-strikes-message">
                  <p>${localize(this.hass, 'component.blc.card.no_strikes_message')}</p>
                  ${this._lastStrikeFromHistory ? this._renderLastStrikeInfo() : ''}
                </div>
              `}
          ${this._config.show_history_chart && (hasHistoryToShow || isInEditMode)
            ? html`<div class="history-chart"></div>`
            : ''}
          ${this._config.show_map && strikesToShow.length > 0 ? this._renderMap() : ''}
        </div>
        ${this._tooltip.visible
          ? html`<div class="custom-tooltip" style="transform: translate(${this._tooltip.x}px, ${this._tooltip.y}px);">
              ${this._tooltip.content}
            </div>`
          : ''}
      </ha-card>
    `;
  }

  private _renderLastStrikeInfo(): TemplateResult | undefined {
    const counterEntity = this.hass.states[this._config.counter];
    if (!counterEntity || !this._lastStrikeFromHistory) {
      return undefined;
    }

    // The ha-relative-time element will produce the full "time ago" string.
    const relativeTimeEl = html`
      <ha-relative-time .hass=${this.hass} .datetime=${this._lastStrikeFromHistory}></ha-relative-time>
    `;

    const localizedTemplate = localize(this.hass, 'component.blc.card.last_strike_time', { time: '%%TIME%%' });
    const [before, after] = localizedTemplate.split('%%TIME%%');

    const linkStyles = {
      color: this._config.font_color ?? 'var(--primary-color)',
    };
    const link = html`<a
      class="clickable-entity"
      style=${styleMap(linkStyles)}
      data-entity-id="${this._config.counter}"
      @click=${this._handleEntityClick}
      >${relativeTimeEl}</a
    >`;

    return html`<p>${before}${link}${after ?? ''}</p>`;
  }

  public getCardSize(): number {
    // 1 unit = 50px.
    // Header: 1 unit
    // Compass/Radar (220px): ~4 units
    // History Chart (115px): 2 units
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
      counter: 'sensor.blitzortung_lightning_counter',
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

// Define properties on the class constructor to avoid TypeScript conflicts with Function.name
Object.defineProperties(BlitzortungLightningCard, {
  name: {
    value: 'Blitzortung Lightning Card',
    configurable: true,
  },
  description: {
    value: 'A custom card to display lightning strike data from the Blitzortung integration.',
    configurable: true,
  },
});

// This is a community convention for custom cards to make them discoverable.
// It's not strictly necessary with modern Home Assistant, but it helps with
// compatibility and discoverability in some cases.
const windowWithCards = window as WindowWithCards;
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: 'blitzortung-lightning-card',
  name: 'Blitzortung Lightning Card',
  description: 'A custom card to display lightning strike data from the Blitzortung integration.',
  // preview: true, // Add this to help HA discover the preview
});
