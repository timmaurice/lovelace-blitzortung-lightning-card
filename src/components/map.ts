import { LitElement, html } from 'lit';
import { property, state } from 'lit/decorators.js';
import type { Map as LeafletMap, LayerGroup, DivIcon, Marker, LatLngBounds } from 'leaflet';
import leafletCss from 'leaflet/dist/leaflet.css';
import leafletStyles from '../styles/leaflet-styles.scss';
import { BlitzortungCardConfig, HomeAssistant } from '../types';

type Strike = { distance: number; azimuth: number; timestamp: number; latitude: number; longitude: number };
const NEW_STRIKE_CLASS = 'new-strike';

export class BlitzortungMap extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public config!: BlitzortungCardConfig;
  @property({ attribute: false }) public strikes: Strike[] = [];
  @property({ attribute: false }) public homeCoords: { lat: number; lon: number } | null = null;

  @state() private _userInteractedWithMap = false;

  private _map: LeafletMap | undefined = undefined;
  private _markers: LayerGroup | undefined = undefined;
  private _strikeMarkers: Map<number, Marker> = new Map();
  private _homeMarker: Marker | undefined;
  private _newestStrikeTimestamp: number | null = null;
  private _leaflet: typeof import('leaflet') | undefined;
  private _programmaticMapChange = false;
  private _recenterButton: HTMLElement | undefined;

  private _showTooltip(event: L.LeafletMouseEvent, strike: Strike): void {
    this.dispatchEvent(new CustomEvent('show-tooltip', { detail: { event, strike }, bubbles: true, composed: true }));
  }

  private _moveTooltip(event: L.LeafletMouseEvent): void {
    this.dispatchEvent(new CustomEvent('move-tooltip', { detail: { event }, bubbles: true, composed: true }));
  }

  private _hideTooltip(): void {
    this.dispatchEvent(new CustomEvent('hide-tooltip', { bubbles: true, composed: true }));
  }

  connectedCallback(): void {
    super.connectedCallback();
    setTimeout(() => this._initMap(), 0);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._destroyMap();
  }

  protected updated(changedProperties: Map<string | number | symbol, unknown>): void {
    super.updated(changedProperties);
    if (this._map) {
      if (changedProperties.has('strikes') || changedProperties.has('homeCoords')) {
        this._updateMapMarkers();
      }
      if (changedProperties.has('config')) {
        const oldConfig = changedProperties.get('config') as BlitzortungCardConfig;
        if (oldConfig && (oldConfig.map_theme_mode ?? 'auto') !== (this.config.map_theme_mode ?? 'auto')) {
          this._destroyMap();
          this._initMap();
        }
      }
      if (changedProperties.has('_userInteractedWithMap')) {
        this._updateRecenterButtonState();
      }
    }
  }

  private _autoZoomMap(bounds: LatLngBounds | { isValid?: () => boolean }): void {
    if (!this._map || this._userInteractedWithMap) {
      return;
    }

    const L = this._leaflet!;
    let zoomFunc: (() => void) | null = null;

    const isRealBounds =
      bounds instanceof L.LatLngBounds &&
      bounds.isValid() &&
      typeof bounds.getNorthEast === 'function' &&
      typeof bounds.getSouthWest === 'function' &&
      !bounds.getNorthEast().equals(bounds.getSouthWest());

    if (isRealBounds) {
      zoomFunc = () => this._map!.fitBounds(bounds as LatLngBounds, { padding: [50, 50], maxZoom: 15 });
    } else if (this._map.getZoom() === 0 && this.homeCoords) {
      const { lat: homeLat, lon: homeLon } = this.homeCoords;
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

  private async _updateMapMarkers(): Promise<void> {
    if (!this._map) return;
    const L = await this._getLeaflet();
    if (!this._markers) {
      this._markers = L.layerGroup().addTo(this._map);
    }
    const bounds = L.latLngBounds([]);

    // Home marker
    if (this.homeCoords) {
      const { lat: homeLat, lon: homeLon } = this.homeCoords;
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
    const mapStrikes = this.strikes.slice(0, 100);
    const newStrikeTimestamps = new Set(mapStrikes.map((s) => s.timestamp));
    const currentNewestStrike = mapStrikes.length > 0 ? mapStrikes[0] : null;

    const previousNewestTimestamp = this._newestStrikeTimestamp;

    // Add new markers and update existing ones
    mapStrikes.forEach((strike, index) => {
      const isNewest = index === 0;
      const zIndex = mapStrikes.length - index + (isNewest ? 1000 : 0);
      if (!this._strikeMarkers.has(strike.timestamp)) {
        const strikeIcon: DivIcon = L.divIcon({
          html: `<div class="leaflet-strike-marker"><ha-icon icon="mdi:flash"></ha-icon></div>`,
          className: 'leaflet-strike-marker-wrapper',
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        });
        const strikeMarker = L.marker([strike.latitude, strike.longitude], {
          icon: strikeIcon,
          zIndexOffset: zIndex,
        }).addTo(this._markers!);

        strikeMarker.on('mouseover', (e) => this._showTooltip(e, strike));
        strikeMarker.on('mousemove', (e) => this._moveTooltip(e));
        strikeMarker.on('mouseout', () => this._hideTooltip());

        this._strikeMarkers.set(strike.timestamp, strikeMarker);
      } else {
        const existingMarker = this._strikeMarkers.get(strike.timestamp);
        if (existingMarker) {
          existingMarker.setZIndexOffset(zIndex);
        }
      }
      bounds.extend([strike.latitude, strike.longitude]);
    });

    // Remove old markers
    this._strikeMarkers.forEach((marker, timestamp) => {
      if (!newStrikeTimestamps.has(timestamp)) {
        this._markers?.removeLayer(marker);
        this._strikeMarkers.delete(timestamp);
      }
    });

    // Update 'new-strike' class
    if (currentNewestStrike?.timestamp !== previousNewestTimestamp) {
      if (previousNewestTimestamp) {
        this._strikeMarkers.get(previousNewestTimestamp)?.getElement()?.classList.remove(NEW_STRIKE_CLASS);
      }
      const newMarker = currentNewestStrike ? this._strikeMarkers.get(currentNewestStrike.timestamp) : undefined;
      if (newMarker) {
        requestAnimationFrame(() => newMarker.getElement()?.classList.add(NEW_STRIKE_CLASS));
      }
    }

    this._newestStrikeTimestamp = currentNewestStrike ? currentNewestStrike.timestamp : null;
    this._autoZoomMap(bounds);
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
    if (this.config.map_theme_mode === 'dark') {
      darkMode = true;
    } else if (this.config.map_theme_mode === 'light') {
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

    this._map.on('zoomstart movestart dragstart', () => {
      if (!this._programmaticMapChange) {
        this._userInteractedWithMap = true;
        this._updateRecenterButtonState();
      }
    });

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
          this._updateMapMarkers();
          this._updateRecenterButtonState();
        });

        return container;
      },
    });
    this._map.addControl(new recenterControl());

    this._map.invalidateSize();
    this._updateMapMarkers();
    this._updateRecenterButtonState();
  }

  private _updateRecenterButtonState(): void {
    if (!this._recenterButton || !this._leaflet) {
      return;
    }
    const L = this._leaflet;

    if (this._userInteractedWithMap) {
      L.DomUtil.removeClass(this._recenterButton, 'active');
      this._recenterButton.setAttribute('aria-label', 'Recenter map and enable auto-zoom');
    } else {
      L.DomUtil.addClass(this._recenterButton, 'active');
      this._recenterButton.title = 'Auto-zoom enabled';
    }
  }

  protected render() {
    return html`<div id="map-container" class="leaflet-map"></div>`;
  }

  static styles = [leafletCss, leafletStyles];
}

customElements.define('blitzortung-map', BlitzortungMap);
