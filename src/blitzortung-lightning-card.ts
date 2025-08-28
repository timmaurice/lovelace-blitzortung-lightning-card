import { LitElement, TemplateResult, html, nothing } from 'lit';
import { property, state } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';
import { BlitzortungCardConfig, HomeAssistant, WindowWithCards } from './types';

// Statically import the editor to bundle it into a single file.
import sampleStrikes from './sample.json';
import './editor';
import './components/compass';
import './components/radar-chart';
import './components/history-chart';
import './components/map';
import { migrateConfig } from './config-migration';

import { localize } from './localize';
import { calculateAzimuth, getDirection, destinationPoint } from './utils';
import cardStyles from './styles/blitzortung-lightning-card.scss';

const GEO_LOCATION_PREFIX = 'geo_location.lightning_strike_';
const BLITZORTUNG_SOURCE = 'blitzortung';

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
  @state() private _strikesToShowForRender: Strike[] = [];
  @state() private _demoHelpVisible = false;
  private _sampleStrikeTimer: number | undefined;
  private _editMode: boolean = false;

  private _cardJustConnected = false;

  public setConfig(rawConfig: Record<string, unknown>): void {
    if (!rawConfig) {
      throw new Error('Invalid configuration');
    }

    const { config } = migrateConfig(rawConfig);

    const requiredEntities = ['distance_entity', 'counter_entity', 'azimuth_entity'] as const;
    const missingKeys = requiredEntities.filter((key) => !config[key]);

    if (missingKeys.length > 0) {
      throw new Error(`The following required configuration options are missing: ${missingKeys.join(', ')}`);
    }

    if (config.lightning_detection_radius === undefined) {
      throw new Error(`The 'lightning_detection_radius' (numeric) configuration option is required.`);
    }

    this._config = config as BlitzortungCardConfig;
  }

  connectedCallback(): void {
    super.connectedCallback();
    this._cardJustConnected = true;
    // Add a listener to handle when the tab's visibility changes
    document.addEventListener('visibilitychange', this._handleVisibilityChange);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('visibilitychange', this._handleVisibilityChange);
    this._stopSampleStrikeAnimation();
  }

  /**
   * Called when the card is in edit mode.
   * @param editMode True if the card is in edit mode.
   */
  public set editMode(editMode: boolean) {
    this._editMode = editMode;
    if (editMode) {
      this._startSampleStrikeAnimation();
    } else {
      this._stopSampleStrikeAnimation();
      this._displayedSampleStrikes = [];
      this._demoHelpVisible = false;
    }
    this.requestUpdate(); // Request an update to re-render with the new mode
  }

  private _toggleDemoHelp(e: MouseEvent): void {
    e.stopPropagation();
    this._demoHelpVisible = !this._demoHelpVisible;
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
          // The components will re-render themselves via their `updated` hooks.
          this.requestUpdate();
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
    const shouldUpdateVisuals = hassChanged || configChanged || sampleStrikesChanged;

    if (shouldUpdateVisuals) {
      // Calculate strikes once here and cache for the render cycle
      this._strikesToShowForRender = this._getStrikesToShow();
      const { azimuth } = this._getCompassDisplayData(this._strikesToShowForRender);
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
    const period = this._config.period ?? '1h';
    if (period === '15m') {
      return 15 * 60 * 1000;
    }
    if (period === '30m') {
      return 30 * 60 * 1000;
    }
    return 60 * 60 * 1000; // 1h
  }

  private get _radarMaxAgeMs(): number {
    const period = this._config.period ?? '1h';
    if (period === '15m') {
      return 15 * 60 * 1000;
    }
    if (period === '30m') {
      return 30 * 60 * 1000;
    }
    return 60 * 60 * 1000; // 1h
  }

  private _getHomeCoordinates(): { lat: number; lon: number } | null {
    // Priority 1: Manually overridden in card config
    if (this._config.latitude != null && this._config.longitude != null) {
      const coords = { lat: this._config.latitude, lon: this._config.longitude };
      return coords;
    }

    // Priority 2: Fallback to Home Assistant default
    const homeZone = this.hass.states['zone.home'];
    // Prefer zone.home coordinates, fallback to HA core configuration
    const lat = (homeZone?.attributes.latitude as number) ?? this.hass.config.latitude;
    const lon = (homeZone?.attributes.longitude as number) ?? this.hass.config.longitude;

    if (lat != null && lon != null) {
      const coords = { lat, lon };
      return coords;
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
      .filter((strike): strike is Strike => {
        const isWithinTime = strike.timestamp > oldestTimestamp;
        const hasValidDistance = !isNaN(strike.distance);
        if (!isWithinTime || !hasValidDistance) {
          return false;
        }

        return strike.distance <= this._config.lightning_detection_radius;
      })
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

  private _handleShowTooltip(e: CustomEvent): void {
    const { event, strike } = e.detail;
    const distanceUnit = this.hass.states[this._config.distance_entity]?.attributes.unit_of_measurement ?? 'km';
    const content = this._getStrikeTooltipContent(strike, distanceUnit);
    this._tooltip = { ...this._tooltip, visible: true, content };
    this._moveTooltip(event);
  }

  private _handleMoveTooltip(e: CustomEvent): void {
    this._moveTooltip(e.detail.event);
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
    const tooltipGoesLeft = x > cardRect.width - 150; // 150px is a rough estimate of tooltip width
    const xOffset = tooltipGoesLeft ? -115 : 0;

    // Add a small offset to prevent the tooltip from flickering by being under the cursor
    this._tooltip = { ...this._tooltip, x: x + xOffset, y: y + 15 };
  }

  private _handleHideTooltip(): void {
    if (this._tooltip.visible) {
      this._tooltip = { ...this._tooltip, visible: false, content: nothing };
    }
  }

  // Fetch count entity history and use for history chart
  private async _fetchCountHistory(): Promise<Array<{ timestamp: number; value: number }>> {
    // Use Home Assistant REST API to fetch history for the count entity
    const entityId = this._config.counter_entity;
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

  private async _updateLastStrikeTime(): Promise<void> {
    const entityId = this._config.counter_entity;
    if (!entityId) return;

    const now = new Date();
    // Look back 7 days, which should be sufficient and is a common retention period.
    const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    // We make the API call as explicit as possible to avoid issues with default behaviors.
    // - `end_time` is specified to ensure we get data up to now.
    // - `significant_changes_only=0` is added to get all state changes, including
    //   those that might be filtered out by default on long history queries.
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

  private _getCompassDisplayData(strikesToShow: Strike[]): {
    azimuth: string;
    distance: string;
    distanceUnit: string;
    count: string;
  } {
    const distanceEntity = this.hass.states[this._config.distance_entity];
    const distanceUnit = (distanceEntity?.attributes.unit_of_measurement as string) ?? 'km';

    // In edit mode with no real data, use the animated sample strikes to populate the compass.
    const useSampleData = this._editMode && strikesToShow === this._displayedSampleStrikes && strikesToShow.length > 0;

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
      count: this.hass.states[this._config.counter_entity]?.state ?? 'N/A',
      azimuth: this.hass.states[this._config.azimuth_entity]?.state ?? 'N/A',
      distanceUnit,
    };
  }

  updated(changedProperties: Map<string | number | symbol, unknown>): void {
    super.updated(changedProperties);

    if (!this._config) {
      return;
    }

    const isInitialLoad = this._cardJustConnected;
    if (isInitialLoad) {
      this._cardJustConnected = false; // Reset the flag after the first update cycle.
    }

    const configChanged = changedProperties.has('_config');
    const hassChanged = changedProperties.has('hass');
    const oldHass = changedProperties.get('hass') as HomeAssistant | undefined;

    const sampleStrikesChanged = this._editMode && changedProperties.has('_displayedSampleStrikes');
    const shouldUpdateVisuals = hassChanged || configChanged || sampleStrikesChanged;

    // If visuals need updating, re-render things.
    if (shouldUpdateVisuals) {
      if (this._strikesToShowForRender.length === 0 && !this._editMode) {
        // No recent strikes, let's find the last one from history.
        // We only need to do this if the counter entity has changed.
        if (hassChanged) {
          const counterEntityChanged =
            !oldHass || oldHass.states[this._config.counter_entity] !== this.hass.states[this._config.counter_entity];

          if (counterEntityChanged) {
            this._updateLastStrikeTime();
          }
        }
      }
    }

    // History chart logic
    if (this._config?.show_history_chart !== false) {
      const oldConfig = changedProperties.get('_config') as BlitzortungCardConfig | undefined;
      const oldCount = oldHass?.states[this._config.counter_entity]?.state;
      const newCount = this.hass.states[this._config.counter_entity]?.state;

      // Fetch history on initial load, on relevant config changes, or when a new strike is detected.

      const needsHistoryFetch =
        isInitialLoad ||
        (configChanged &&
          oldConfig &&
          (oldConfig.period !== this._config.period || oldConfig.counter_entity !== this._config.counter_entity)) ||
        (oldHass && oldCount !== newCount);

      if (needsHistoryFetch) {
        this._fetchCountHistory()
          .then((data) => (this._historyData = data))
          .catch((err) => {
            console.error('Error fetching history for chart:', err);
            this._historyData = []; // Clear data on error to prevent rendering stale info
          });
      }
    }
  }

  protected render() {
    if (!this.hass || !this._config) {
      return html``;
    }

    const requiredEntities = ['distance_entity', 'counter_entity', 'azimuth_entity'] as const;
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
    const strikesToShow = this._strikesToShowForRender;

    const { azimuth, distance, distanceUnit, count } = this._getCompassDisplayData(strikesToShow);
    const numericCount = parseInt(count, 10);
    const hasHistoryToShow = this._historyData.length > 1;
    const isInEditMode = this._editMode;

    const isShowingSampleData = isInEditMode && strikesToShow.length > 0 && this._getRecentStrikes().length === 0;

    return html`
      <div>
        ${this._demoHelpVisible
          ? html` <div class="demo-help-text">${localize(this.hass, 'component.blc.card.demo_data_tooltip')}</div> `
          : ''}
        <ha-card .header=${title}>
          ${isShowingSampleData
            ? html`
                <a class="demo-badge" @click=${this._toggleDemoHelp}>
                  ${localize(this.hass, 'component.blc.card.demo_data')}
                </a>
              `
            : ''}
          <div
            class="card-content"
            @show-tooltip=${this._handleShowTooltip}
            @move-tooltip=${this._handleMoveTooltip}
            @hide-tooltip=${this._handleHideTooltip}
          >
            ${strikesToShow.length > 0 && !isNaN(numericCount) && numericCount > 0
              ? html`
                  ${this._config.show_radar !== false
                    ? html`<div class="content-container split-view">
                        <blitzortung-compass
                          .hass=${this.hass}
                          .config=${this._config}
                          .azimuth=${azimuth}
                          .distance=${distance}
                          .distanceUnit=${distanceUnit}
                          .count=${count}
                          .displayAngle=${this._compassAngle}
                        ></blitzortung-compass>
                        <div class="radar-chart">
                          <blitzortung-radar-chart
                            .hass=${this.hass}
                            .config=${this._config}
                            .strikes=${strikesToShow}
                            .maxAgeMs=${this._radarMaxAgeMs}
                            .distanceUnit=${distanceUnit}
                          ></blitzortung-radar-chart>
                        </div>
                      </div>`
                    : nothing}
                  ${this._config.show_history_chart !== false && (hasHistoryToShow || isInEditMode)
                    ? html`<div class="history-chart">
                        <blitzortung-history-chart
                          .hass=${this.hass}
                          .config=${this._config}
                          .historyData=${this._historyData}
                          .editMode=${this._editMode}
                        ></blitzortung-history-chart>
                      </div>`
                    : nothing}
                  ${this._config.show_map !== false
                    ? html`<blitzortung-map
                        .hass=${this.hass}
                        .config=${this._config}
                        .strikes=${strikesToShow}
                        .homeCoords=${this._getHomeCoordinates()}
                      ></blitzortung-map>`
                    : nothing}
                `
              : html`
                  <div class="no-strikes-message">
                    <p>${localize(this.hass, 'component.blc.card.no_strikes_message')}</p>
                    ${this._lastStrikeFromHistory ? this._renderLastStrikeInfo() : ''}
                  </div>
                `}
          </div>
          <div
            class="custom-tooltip ${this._tooltip.visible ? 'visible' : ''}"
            style=${styleMap({ transform: `translate(${this._tooltip.x}px, ${this._tooltip.y}px)` })}
          >
            ${this._tooltip.content}
          </div>
        </ha-card>
      </div>
    `;
  }

  private _renderLastStrikeInfo(): TemplateResult | undefined {
    const counterEntity = this.hass.states[this._config.counter_entity];
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
      data-entity-id="${this._config.counter_entity}"
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
    let size = 1; // Header
    if (this._config?.show_radar !== false) {
      size += 4;
    }
    if (this._config?.show_history_chart !== false) {
      size += 2;
    }
    if (this._config?.show_map !== false) {
      size += 6;
    }
    return size;
  }

  // Provides a default configuration for the card in the UI editor
  static styles = cardStyles;
  static getStubConfig(): Record<string, unknown> {
    return {
      type: 'custom:blitzortung-lightning-card',
      distance_entity: 'sensor.blitzortung_lightning_distance',
      counter_entity: 'sensor.blitzortung_lightning_counter',
      azimuth_entity: 'sensor.blitzortung_lightning_azimuth',
      lightning_detection_radius: 100,
      show_radar: true,
      show_map: true,
      period: '1h',
      show_history_chart: true,
      grid_color: 'var(--primary-text-color)',
      strike_color: 'var(--error-color)',
    };
  }
}

customElements.define('blitzortung-lightning-card', BlitzortungLightningCard);

// This is a community convention for custom cards to make them discoverable.
// It's not strictly necessary with modern Home Assistant, but it helps with
// compatibility and discoverability in some cases.
const windowWithCards = window as WindowWithCards;
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: 'blitzortung-lightning-card',
  name: 'Blitzortung Lightning Card',
  description: 'A custom card to display lightning strike data from the Blitzortung integration.',
  documentationURL: 'https://github.com/timmaurice/lovelace-blitzortung-lightning-card',
  // preview: true, // Add this to help HA discover the preview
});
