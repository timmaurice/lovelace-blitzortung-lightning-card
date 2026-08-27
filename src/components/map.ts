import { LitElement, html } from 'lit';
import { property, state } from 'lit/decorators.js';
import type { Map as MapLibreMap, Marker, LngLatBounds, IControl } from 'maplibre-gl';
import { scalePow } from 'd3-scale';
import maplibreCss from 'maplibre-gl/dist/maplibre-gl.css';
import mapStyles from '../styles/map-styles.scss';
import { BlitzortungCardConfig, HomeAssistant } from '../types';

type Strike = { distance: number; azimuth: number; timestamp: number; latitude: number; longitude: number };
const NEW_STRIKE_CLASS = 'new-strike';

/**
 * Custom top-left control that lets the user re-enable auto-zoom after they've
 * manually panned/zoomed the map. Mirrors MapLibre's own control chrome
 * (`maplibregl-ctrl`/`maplibregl-ctrl-group`) so it visually matches the built-in
 * zoom control it's stacked beneath.
 */
class RecenterControl implements IControl {
  private _container: HTMLElement | undefined;
  private _link: HTMLAnchorElement | undefined;

  constructor(private readonly onClick: () => void) {}

  onAdd(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'maplibregl-ctrl maplibregl-ctrl-group';

    const link = document.createElement('a');
    link.className = 'recenter-button';
    link.href = '#';
    link.innerHTML = `<ha-icon icon="mdi:crosshairs-gps"></ha-icon>`;
    link.setAttribute('role', 'button');
    link.setAttribute('aria-label', 'Recenter Map');
    link.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onClick();
    });

    container.appendChild(link);
    this._container = container;
    this._link = link;
    return container;
  }

  onRemove(): void {
    this._container?.remove();
  }

  getLink(): HTMLAnchorElement | undefined {
    return this._link;
  }
}

export class BlitzortungMap extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public config!: BlitzortungCardConfig;
  @property({ attribute: false }) public strikes: Strike[] = [];
  @property({ attribute: false }) public homeCoords: { lat: number; lon: number } | null = null;

  @state() private _userInteractedWithMap = false;

  private _map: MapLibreMap | undefined = undefined;
  private _strikeMarkers: Map<number, Marker> = new Map();
  private _homeMarker: Marker | undefined;
  private _newestStrikeTimestamp: number | null = null;
  private _maplibregl: typeof import('maplibre-gl') | undefined;
  private _programmaticMapChange = false;
  private _programmaticChangeSettleTimer: number | undefined;
  private _recenterButton: HTMLAnchorElement | undefined;
  private _resizeObserver: ResizeObserver | null = null;
  private _isInitializingMap = false;

  private _showTooltip(event: MouseEvent, strike: Strike): void {
    this.dispatchEvent(new CustomEvent('show-tooltip', { detail: { event, strike }, bubbles: true, composed: true }));
  }

  private _moveTooltip(event: MouseEvent): void {
    this.dispatchEvent(new CustomEvent('move-tooltip', { detail: { event }, bubbles: true, composed: true }));
  }

  private _hideTooltip(): void {
    this.dispatchEvent(new CustomEvent('hide-tooltip', { bubbles: true, composed: true }));
  }

  connectedCallback(): void {
    super.connectedCallback();
    this._initMap();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._destroyMap();
  }

  protected updated(changedProperties: Map<string | number | symbol, unknown>): void {
    super.updated(changedProperties);
    if (!this._map) {
      this._initMap();
      return;
    }

    if (changedProperties.has('strikes') || changedProperties.has('homeCoords')) {
      this._updateMapMarkers();
    }
    if (changedProperties.has('config')) {
      const oldConfig = changedProperties.get('config') as BlitzortungCardConfig;
      if (oldConfig) {
        if ((oldConfig.map_theme_mode ?? 'auto') !== (this.config.map_theme_mode ?? 'auto')) {
          this._destroyMap();
          this._initMap();
        } else if (oldConfig.map_marker_style !== this.config.map_marker_style) {
          this._strikeMarkers.forEach((marker) => {
            marker.remove();
          });
          this._strikeMarkers.clear();
          this._newestStrikeTimestamp = null;
          this._updateMapMarkers();
        }
      }
    }
    if (changedProperties.has('_userInteractedWithMap')) {
      this._updateRecenterButtonState();
    }
  }

  private _autoZoomMap(bounds: LngLatBounds): void {
    if (!this._map || this._userInteractedWithMap) {
      return;
    }

    let zoomFunc: (() => void) | null = null;

    const northEast = bounds.getNorthEast();
    const southWest = bounds.getSouthWest();
    const isRealBounds = !bounds.isEmpty() && (northEast.lng !== southWest.lng || northEast.lat !== southWest.lat);

    if (isRealBounds) {
      zoomFunc = () => this._map!.fitBounds(bounds, { padding: 50, maxZoom: 15 });
    } else if (this.homeCoords) {
      const { lat: homeLat, lon: homeLon } = this.homeCoords;
      zoomFunc = () => {
        this._map!.jumpTo({ center: [homeLon, homeLat], zoom: this._map!.getZoom() });
      };
    }

    if (zoomFunc) {
      this._beginProgrammaticMapChange();
      zoomFunc();
    }
  }

  // Marks the next camera movement(s) as programmatic rather than user-initiated, so the
  // zoomstart/movestart/dragstart listeners below don't mistake them for real interaction and
  // disable auto-zoom. Used both for our own fitBounds/jumpTo calls and for `_map.resize()` —
  // MapLibre can reposition the camera during a resize (e.g. on first layout, or whenever the
  // card's container size settles inside HA's grid), and that's just as capable of firing
  // move events as an explicit zoom.
  //
  // The clear is scheduled up front (not only from a moveend handler) because a resize with
  // nothing to reposition may not fire moveend at all — waiting for an event that might never
  // arrive would leave the guard stuck on forever. `_handleMapMoveEnd` reschedules the same
  // timer on every moveend it sees, so a call that *does* trigger movement (including
  // MapLibre's own multi-step settling for a single logical change) keeps the guard up until
  // motion actually stops, rather than clearing after just the first of several move events.
  private _beginProgrammaticMapChange(): void {
    if (!this._map) {
      return;
    }
    this._programmaticMapChange = true;
    this._map.getContainer().classList.add('interaction-disabled');
    this._scheduleProgrammaticMapChangeClear();
  }

  private _scheduleProgrammaticMapChangeClear(): void {
    if (this._programmaticChangeSettleTimer) {
      window.clearTimeout(this._programmaticChangeSettleTimer);
    }
    this._programmaticChangeSettleTimer = window.setTimeout(() => {
      this._programmaticChangeSettleTimer = undefined;
      this._programmaticMapChange = false;
      this._map?.getContainer().classList.remove('interaction-disabled');
    }, 150);
  }

  private _handleMapMoveEnd = (): void => {
    if (this._programmaticMapChange) {
      this._scheduleProgrammaticMapChangeClear();
    }
  };

  private _buildMarkerElement(html: string, wrapperClassName = ''): HTMLDivElement {
    const el = document.createElement('div');
    if (wrapperClassName) {
      el.className = wrapperClassName;
    }
    el.innerHTML = html;
    return el;
  }

  private async _updateMapMarkers(): Promise<void> {
    if (!this._map) return;
    const maplibregl = await this._getMapLibre();
    if (!this._map || !this.isConnected) return;

    const bounds = new maplibregl.LngLatBounds();

    // Home marker
    if (this.homeCoords) {
      const { lat: homeLat, lon: homeLon } = this.homeCoords;
      if (!this._homeMarker) {
        const el = this._buildMarkerElement(`<div class="home-marker"><ha-icon icon="mdi:home"></ha-icon></div>`);
        const title = this.hass.states['zone.home']?.attributes.friendly_name || 'Home';
        el.title = title;
        el.setAttribute('aria-label', title);
        this._homeMarker = new maplibregl.Marker({ element: el }).setLngLat([homeLon, homeLat]).addTo(this._map);
      } else {
        this._homeMarker.setLngLat([homeLon, homeLat]);
      }
      bounds.extend([homeLon, homeLat]);
    } else if (this._homeMarker) {
      this._homeMarker.remove();
      this._homeMarker = undefined;
    }

    // Strikes
    const now = Date.now();
    const maxAgeMs = (this.config.period === '15m' ? 15 : this.config.period === '30m' ? 30 : 60) * 60 * 1000;
    const endOfLife = now - maxAgeMs;
    const opacityScale = scalePow().exponent(0.7).domain([now, endOfLife]).range([1, 0]).clamp(true);

    const newStrikeTimestamps = new Set(this.strikes.map((s) => s.timestamp));
    const currentNewestStrike = this.strikes.length > 0 ? this.strikes[0] : null;

    const previousNewestTimestamp = this._newestStrikeTimestamp;

    // Add new markers and update existing ones
    this.strikes.forEach((strike, index) => {
      const isNewest = index === 0;
      const zIndex = this.strikes.length - index + (isNewest ? 1000 : 0);
      if (!this._strikeMarkers.has(strike.timestamp)) {
        const markerStyle = this.config.map_marker_style ?? 'standard';
        let markerHtml = `<div class="strike-marker"><ha-icon icon="mdi:flash"></ha-icon></div>`;
        if (markerStyle === 'crosshair') {
          markerHtml = `<div class="strike-marker crosshair"><ha-icon icon="mdi:crosshairs"></ha-icon></div>`;
        } else if (markerStyle === 'dot') {
          markerHtml = `<div class="strike-marker dot"></div>`;
        } else if (markerStyle === 'plus') {
          markerHtml = `<div class="strike-marker plus"><ha-icon icon="mdi:plus"></ha-icon></div>`;
        }

        const el = this._buildMarkerElement(markerHtml, 'strike-marker-wrapper');
        el.style.zIndex = String(zIndex);
        el.style.opacity = String(opacityScale(strike.timestamp));
        el.addEventListener('mouseenter', (e) => this._showTooltip(e, strike));
        el.addEventListener('mousemove', (e) => this._moveTooltip(e));
        el.addEventListener('mouseleave', () => this._hideTooltip());

        const strikeMarker = new maplibregl.Marker({ element: el })
          .setLngLat([strike.longitude, strike.latitude])
          .addTo(this._map!);

        this._strikeMarkers.set(strike.timestamp, strikeMarker);
      } else {
        const existingMarker = this._strikeMarkers.get(strike.timestamp);
        if (existingMarker) {
          const el = existingMarker.getElement();
          el.style.zIndex = String(zIndex);
          el.style.opacity = String(opacityScale(strike.timestamp));
        }
      }
      bounds.extend([strike.longitude, strike.latitude]);
    });

    // Remove old markers
    this._strikeMarkers.forEach((marker, timestamp) => {
      if (!newStrikeTimestamps.has(timestamp)) {
        marker.remove();
        this._strikeMarkers.delete(timestamp);
      }
    });

    // Update 'new-strike' class
    if (currentNewestStrike?.timestamp !== previousNewestTimestamp) {
      if (previousNewestTimestamp) {
        this._strikeMarkers.get(previousNewestTimestamp)?.removeClassName(NEW_STRIKE_CLASS);
      }
      const newMarker = currentNewestStrike ? this._strikeMarkers.get(currentNewestStrike.timestamp) : undefined;
      if (newMarker) {
        requestAnimationFrame(() => newMarker.addClassName(NEW_STRIKE_CLASS));
      }
    }

    this._newestStrikeTimestamp = currentNewestStrike ? currentNewestStrike.timestamp : null;
    this._autoZoomMap(bounds);
  }

  private _destroyMap(): void {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this._programmaticChangeSettleTimer) {
      window.clearTimeout(this._programmaticChangeSettleTimer);
      this._programmaticChangeSettleTimer = undefined;
    }
    this._programmaticMapChange = false;
    if (this._map) {
      try {
        this._map.remove();
      } catch (err) {
        console.warn('[Blitzortung Map] Error removing map:', err);
      }
      this._map = undefined;
      this._strikeMarkers.clear();
      this._homeMarker = undefined;
      this._newestStrikeTimestamp = null;
      this._recenterButton = undefined;
      this._userInteractedWithMap = false;
    }
  }

  private async _getMapLibre() {
    if (!this._maplibregl) {
      // maplibre-gl is pinned to v5 (see package.json): its dist/maplibre-gl.js is a
      // self-contained build that constructs its Web Worker from an inline Blob
      // automatically, no manual setWorkerUrl() wiring needed. v6 dropped that in favor of
      // a separately-hosted worker file, which doesn't fit this project's single-file
      // bundle — don't bump past v5 without re-solving that.
      this._maplibregl = await import('maplibre-gl');
    }
    return this._maplibregl!;
  }

  private async _initMap(): Promise<void> {
    const mapContainer = this.shadowRoot?.querySelector('#map-container');
    if (
      !this.isConnected ||
      !mapContainer ||
      !(mapContainer instanceof HTMLElement) ||
      this._map ||
      this._isInitializingMap
    ) {
      return;
    }

    this._isInitializingMap = true;

    try {
      const maplibregl = await this._getMapLibre();

      if (!this.isConnected || this._map) {
        return;
      }

      // Re-verify container is still in DOM and is the same one
      const currentContainer = this.shadowRoot?.querySelector('#map-container');
      if (!currentContainer || currentContainer !== mapContainer) {
        return;
      }

      let darkMode: boolean;
      if (this.config.map_theme_mode === 'dark') {
        darkMode = true;
      } else if (this.config.map_theme_mode === 'light') {
        darkMode = false;
      } else {
        darkMode = this.hass?.themes?.darkMode ?? false;
      }

      const styleUrl = darkMode
        ? 'https://tiles.openfreemap.org/styles/dark'
        : 'https://tiles.openfreemap.org/styles/positron';

      // Seed an initial center/zoom from home coordinates when known, so the first
      // auto-zoom (in _autoZoomMap) has a sensible zoom level to fall back to
      // instead of MapLibre's default zoom 0 (whole world).
      const initialCenter: [number, number] = this.homeCoords ? [this.homeCoords.lon, this.homeCoords.lat] : [0, 0];
      const initialZoom = this.homeCoords ? 13 : 0;

      this._map = new maplibregl.Map({
        container: mapContainer,
        style: styleUrl,
        center: initialCenter,
        zoom: initialZoom,
      });

      this._map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');

      const markUserInteracted = () => {
        if (!this._programmaticMapChange) {
          this._userInteractedWithMap = true;
          this._updateRecenterButtonState();
        }
      };
      this._map.on('zoomstart', markUserInteracted);
      this._map.on('movestart', markUserInteracted);
      this._map.on('dragstart', markUserInteracted);
      this._map.on('moveend', this._handleMapMoveEnd);

      const recenterControl = new RecenterControl(() => {
        this._userInteractedWithMap = false;
        this._updateMapMarkers();
        this._updateRecenterButtonState();
      });
      this._map.addControl(recenterControl, 'top-left');
      this._recenterButton = recenterControl.getLink();

      if (typeof ResizeObserver !== 'undefined') {
        this._resizeObserver = new ResizeObserver(() => {
          if (this._map) {
            this._beginProgrammaticMapChange();
            this._map.resize();
          }
        });
        this._resizeObserver.observe(mapContainer);
      }

      this._beginProgrammaticMapChange();
      this._map.resize();
      this._updateMapMarkers();
      this._updateRecenterButtonState();
    } catch (err) {
      console.error('[Blitzortung Map] Failed to initialize map:', err);
    } finally {
      this._isInitializingMap = false;
    }
  }

  private _updateRecenterButtonState(): void {
    if (!this._recenterButton) {
      return;
    }

    if (this._userInteractedWithMap) {
      this._recenterButton.classList.remove('active');
      this._recenterButton.setAttribute('aria-label', 'Recenter map and enable auto-zoom');
    } else {
      this._recenterButton.classList.add('active');
      this._recenterButton.title = 'Auto-zoom enabled';
    }
  }

  protected render() {
    const strikeColor = this.config.strike_color || 'var(--warning-color, #ffc107)';
    return html`<div id="map-container" class="map-container" style="--map-strike-color: ${strikeColor};"></div>`;
  }

  static styles = [maplibreCss, mapStyles];
}

customElements.define('blitzortung-map', BlitzortungMap);
