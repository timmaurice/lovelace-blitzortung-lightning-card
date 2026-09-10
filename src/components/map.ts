import { LitElement, html } from 'lit';
import { property, state } from 'lit/decorators.js';
import type { Map as MapLibreMap, MapOptions, Marker, LngLatBounds, IControl, RequestParameters } from 'maplibre-gl';
import { scalePow } from 'd3-scale';
import maplibreCss from 'maplibre-gl/dist/maplibre-gl.css';
import mapStyles from '../styles/map-styles.scss';
import { BlitzortungCardConfig, HomeAssistant, MapTileSource } from '../types';
import { localize } from '../localize';
import { installMapLibreWorker } from '../maplibre-worker';

type Strike = { distance: number; azimuth: number; timestamp: number; latitude: number; longitude: number };

/** What MapLibre accepts as its `style` option: a URL, or a whole style object. */
type MapStyle = NonNullable<MapOptions['style']>;
/**
 * Just enough of the MapLibre style spec to find the URLs that have to be made absolute.
 * Deliberately structural: the full `StyleSpecification` lives in a transitive package that
 * `maplibre-gl` does not re-export, and nothing here needs the other 200 fields.
 */
type StyleWithUrls = {
  glyphs?: unknown;
  sprite?: unknown;
  sources?: Record<string, Record<string, unknown>>;
};

const NEW_STRIKE_CLASS = 'new-strike';
const DEFAULT_MAP_ZOOM = 8;
// MapLibre's own default upper bound. Clamping to anything higher would be a lie: the library
// caps the camera at 22, so a configured 24 would silently render as 22.
const MAX_MAP_ZOOM = 22;

const OPENFREEMAP_DARK_STYLE = 'https://tiles.openfreemap.org/styles/dark';
const OPENFREEMAP_LIGHT_STYLE = 'https://tiles.openfreemap.org/styles/positron';

// ─── Home Assistant's own tile proxy (`map_tiles`, HA 2026.9+) ────────────────────────────
// Requesting the base map straight from OpenFreeMap means every dashboard render sends a
// bounding box around the user's home to a third party, with no way to turn it off (issue
// #98). `map_tiles` proxies OpenStreetMap through the user's own instance instead.
//
// Home Assistant ships the MapLibre styles for it, so there is no style to author here: the
// style at `/static/map/{light,dark}.json` supplies the vector source, glyphs, sprites,
// attribution and zoom range. That is the same base map, in the same two themes, that Home
// Assistant's own map view draws — but it is fetched and rewritten here rather than handed to
// MapLibre as a URL, see `_loadCoreTilesStyle`.
const CORE_TILES_COMPONENT = 'map_tiles';
const CORE_TILES_LIGHT_STYLE = '/static/map/light.json';
const CORE_TILES_DARK_STYLE = '/static/map/dark.json';
// Everything the style then pulls — TileJSON, vector tiles, glyphs, sprites — lives under this
// prefix, and every one of them is refused with 401 unless the request carries a token.
const CORE_TILES_API_PREFIX = '/api/map_tiles/';
// Tokens rotate every 30 minutes, with the previous one staying valid. Renewing well inside
// that window means a tile request is never made with an expired token.
const CORE_TILES_TOKEN_REFRESH_MS = 10 * 60 * 1000;

/**
 * Custom top-left control that recenters the map. Mirrors MapLibre's own control chrome
 * (`maplibregl-ctrl`/`maplibregl-ctrl-group`) so it visually matches the built-in
 * zoom control it's stacked beneath.
 */
class RecenterControl implements IControl {
  private _container: HTMLElement | undefined;
  private _link: HTMLAnchorElement | undefined;

  constructor(
    private readonly onClick: () => void,
    private readonly label: string,
  ) {}

  onAdd(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'maplibregl-ctrl maplibregl-ctrl-group';

    const link = document.createElement('a');
    link.className = 'recenter-button';
    link.href = '#';
    link.innerHTML = `<ha-icon icon="mdi:crosshairs-gps"></ha-icon>`;
    link.setAttribute('role', 'button');
    link.setAttribute('aria-label', this.label);
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
  private _hasAutoZoomedOnce = false;
  private _recenterButton: HTMLAnchorElement | undefined;
  private _resizeObserver: ResizeObserver | null = null;
  private _isInitializingMap = false;
  private _coreTilesToken: string | null = null;
  private _coreTilesTokenTimer: number | undefined;
  private _coreTilesWarned = false;
  // Which theme the live map was built for, so a theme switch can be told from a re-render.
  // `undefined` while there is no map.
  private _appliedDarkMode: boolean | undefined;

  /** `map_theme_mode` wins where it is set; `auto` follows Home Assistant's own theme. */
  private get _darkMode(): boolean {
    if (this.config?.map_theme_mode === 'dark') return true;
    if (this.config?.map_theme_mode === 'light') return false;
    return this.hass?.themes?.darkMode ?? false;
  }

  // Off means: never fit to the strikes, and the recenter control becomes a plain reset action.
  private get _autoZoomEnabled(): boolean {
    return this.config.map_auto_zoom !== false;
  }

  // The zoom the map opens at, and resets to when auto-zoom is off.
  private get _configuredZoom(): number {
    const zoom = Number(this.config.map_zoom);
    if (!isFinite(zoom)) {
      return DEFAULT_MAP_ZOOM;
    }
    return Math.min(Math.max(zoom, 0), MAX_MAP_ZOOM);
  }

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

    // A new `hass` is how an HA theme switch reaches the card in `auto` mode, and it arrives
    // as no config change at all. The style is chosen when the map is constructed, so a theme
    // the live map was not built for means building it again.
    if (this._appliedDarkMode !== undefined && this._darkMode !== this._appliedDarkMode) {
      this._destroyMap();
      this._initMap();
      return;
    }

    if (changedProperties.has('strikes') || changedProperties.has('homeCoords')) {
      this._updateMapMarkers();
    }
    if (changedProperties.has('config')) {
      const oldConfig = changedProperties.get('config') as BlitzortungCardConfig;
      if (oldConfig) {
        if (
          (oldConfig.map_theme_mode ?? 'auto') !== (this.config.map_theme_mode ?? 'auto') ||
          (oldConfig.map_tile_source ?? 'auto') !== (this.config.map_tile_source ?? 'auto')
        ) {
          this._destroyMap();
          this._initMap();
        } else if (oldConfig.map_marker_style !== this.config.map_marker_style) {
          this._strikeMarkers.forEach((marker) => {
            marker.remove();
          });
          this._strikeMarkers.clear();
          this._newestStrikeTimestamp = null;
          this._updateMapMarkers();
        } else if (
          oldConfig.map_auto_zoom !== this.config.map_auto_zoom ||
          oldConfig.map_zoom !== this.config.map_zoom
        ) {
          // Clearing `_hasAutoZoomedOnce` lets _autoZoomMap place the view again, so the
          // editor's live preview reflects the change without waiting for a new strike.
          this._userInteractedWithMap = false;
          this._hasAutoZoomedOnce = false;
          this._updateMapMarkers();
          this._updateRecenterButtonState();
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

    // Never fit to the strikes, but do settle on home once - homeCoords can resolve after the
    // map was built, leaving it at [0, 0].
    if (!this._autoZoomEnabled) {
      if (!this._hasAutoZoomedOnce && this.homeCoords) {
        this._hasAutoZoomedOnce = true;
        this._resetView();
      }
      return;
    }

    const northEast = bounds.getNorthEast();
    const southWest = bounds.getSouthWest();
    const isRealBounds = !bounds.isEmpty() && (northEast.lng !== southWest.lng || northEast.lat !== southWest.lat);

    // First fit snaps directly instead of flying in from the initial view.
    const animate = this._hasAutoZoomedOnce;
    this._hasAutoZoomedOnce = true;

    if (isRealBounds) {
      zoomFunc = () => this._map!.fitBounds(bounds, { padding: 50, maxZoom: 15, animate });
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

  // Snaps to home at the configured zoom, for when there are no strike bounds to fit.
  private _resetView(): void {
    if (!this._map || !this.homeCoords) {
      return;
    }
    const { lat, lon } = this.homeCoords;
    this._beginProgrammaticMapChange();
    this._map.jumpTo({ center: [lon, lat], zoom: this._configuredZoom });
  }

  // `compact: true` alone doesn't start the attribution collapsed: MapLibre populates it
  // asynchronously (styledata), and that first population is what adds `maplibregl-compact`
  // *and* `-compact-show`. So collapse once it actually has content, not at init.
  private _collapseAttributionOnce(mapContainer: HTMLElement): void {
    if (!this._map) return;
    const collapse = () => {
      const attrib = mapContainer.querySelector('.maplibregl-ctrl-attrib');
      if (!attrib || attrib.classList.contains('maplibregl-attrib-empty')) return;
      attrib.classList.remove('maplibregl-compact-show');
      attrib.removeAttribute('open');
      this._map?.off('styledata', collapse);
      this._map?.off('sourcedata', collapse);
    };
    this._map.on('styledata', collapse);
    this._map.on('sourcedata', collapse);
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
    this._stopCoreTilesTokenRefresh();
    this._coreTilesToken = null;
    this._appliedDarkMode = undefined;
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
      this._hasAutoZoomedOnce = false;
    }
  }

  private get _tileSourcePreference(): MapTileSource {
    return this.config.map_tile_source ?? 'auto';
  }

  private _coreTilesInstalled(): boolean {
    return this.hass?.config?.components?.includes(CORE_TILES_COMPONENT) === true;
  }

  /**
   * Decides which base map this init will use, fetching a first token for the core proxy.
   * Returns false to mean "fall back to OpenFreeMap": either the user asked for it, or
   * `map_tiles` is not there, or the token could not be fetched. Renewal is started by the
   * caller, after it has re-checked that the component is still connected — starting it here
   * would leak an interval when the card is detached while this await is in flight.
   */
  private async _useCoreTiles(): Promise<boolean> {
    const preference = this._tileSourcePreference;
    if (preference === 'openfreemap') {
      return false;
    }
    // `core` is a deliberate override, so it still tries when the component is not listed —
    // a failed token fetch below is what turns that into a fallback.
    if (preference === 'auto' && !this._coreTilesInstalled()) {
      return false;
    }
    return (await this._fetchCoreTilesToken()) !== null;
  }

  // A failed token fetch is a fallback, not a crash — and it warns once per component rather
  // than on every render, so a permanently unavailable proxy cannot flood the console.
  private async _fetchCoreTilesToken(): Promise<string | null> {
    try {
      const response = await this.hass.callWS<{ token?: string }>({ type: 'map_tiles/access_token' });
      if (!response?.token) {
        throw new Error('map_tiles/access_token returned no token');
      }
      this._coreTilesToken = response.token;
      return response.token;
    } catch (err) {
      this._coreTilesToken = null;
      this._warnCoreTilesFallback('Could not get a map_tiles token', err);
      return null;
    }
  }

  /**
   * Fetches Home Assistant's style and hands back a MapLibre-ready object, or null to mean
   * "fall back to OpenFreeMap" — the same fallback a failed token gets, and warned the same
   * once-per-component way.
   *
   * The style cannot simply be passed as a URL: MapLibre rejects relative URLs inside a style
   * outright (`Invalid sprite URL "/api/map_tiles/sprites/basics/sprites"`) and stops loading,
   * leaving an empty canvas with no tile, glyph or sprite request made. Home Assistant's own
   * frontend resolves those paths before handing the style over; so does this.
   */
  private async _loadCoreTilesStyle(styleUrl: string): Promise<MapStyle | null> {
    try {
      const response = await fetch(styleUrl);
      if (!response.ok) {
        throw new Error(`${styleUrl} responded ${response.status}`);
      }
      return this._resolveStyleUrls(await response.json()) as MapStyle;
    } catch (err) {
      this._warnCoreTilesFallback(`Could not load the map_tiles style ${styleUrl}`, err);
      return null;
    }
  }

  /**
   * Rewrites every instance-relative URL in a style to an absolute one: `glyphs`, `sprite`
   * (a string or, as Home Assistant sends it, an array of `{id, url}`), each source's `url`,
   * and any `tiles` a source lists directly.
   */
  private _resolveStyleUrls(style: StyleWithUrls): StyleWithUrls {
    const resolved: StyleWithUrls = { ...style };

    if (typeof style.glyphs === 'string') {
      resolved.glyphs = this._toAbsoluteUrl(style.glyphs);
    }
    if (typeof style.sprite === 'string') {
      resolved.sprite = this._toAbsoluteUrl(style.sprite);
    } else if (Array.isArray(style.sprite)) {
      resolved.sprite = style.sprite.map((entry: unknown) => {
        const sprite = entry as { url?: unknown };
        return typeof sprite?.url === 'string' ? { ...sprite, url: this._toAbsoluteUrl(sprite.url) } : entry;
      });
    }
    if (style.sources && typeof style.sources === 'object') {
      resolved.sources = Object.fromEntries(
        Object.entries(style.sources).map(([id, source]) => {
          const next = { ...source };
          if (typeof next.url === 'string') {
            next.url = this._toAbsoluteUrl(next.url);
          }
          if (Array.isArray(next.tiles)) {
            next.tiles = next.tiles.map((tile: unknown) =>
              typeof tile === 'string' ? this._toAbsoluteUrl(tile) : tile,
            );
          }
          return [id, next];
        }),
      );
    }

    return resolved;
  }

  /**
   * Resolves one style URL against this instance. Only paths are rewritten — an absolute URL
   * or a `data:` URI is already resolvable and is handed back untouched.
   *
   * Concatenation, deliberately, not `new URL(path, origin)`: the URL constructor
   * percent-encodes the placeholders MapLibre substitutes later, so `{fontstack}` becomes
   * `%7Bfontstack%7D` and the glyph and tile requests 404.
   */
  private _toAbsoluteUrl(url: string): string {
    return url.startsWith('/') ? `${window.location.origin}${url}` : url;
  }

  private _warnCoreTilesFallback(message: string, err: unknown): void {
    if (this._coreTilesWarned) {
      return;
    }
    this._coreTilesWarned = true;
    console.warn(`[Blitzortung Map] ${message}; using OpenFreeMap tiles instead.`, err);
  }

  private _startCoreTilesTokenRefresh(): void {
    this._stopCoreTilesTokenRefresh();
    this._coreTilesTokenTimer = window.setInterval(() => {
      void this._fetchCoreTilesToken();
    }, CORE_TILES_TOKEN_REFRESH_MS);
  }

  private _stopCoreTilesTokenRefresh(): void {
    if (this._coreTilesTokenTimer !== undefined) {
      window.clearInterval(this._coreTilesTokenTimer);
      this._coreTilesTokenTimer = undefined;
    }
  }

  // The proxy authenticates by query parameter only — an `Authorization: Bearer` header is
  // rejected with 401 — and MapLibre gives no other hook for per-request credentials.
  // Reading the token here (rather than baking it into the style) means a renewal takes
  // effect on the next request without rebuilding the map.
  private _transformRequest = (url: string): RequestParameters => {
    // Absolute first, unconditionally. `_resolveStyleUrls` only reaches URLs written in the
    // style document; the tile templates MapLibre reads out of the proxy's TileJSON at
    // runtime never pass through it and stay root-relative (`/api/map_tiles/vector/...`).
    // Tile requests are handed to the Web Worker, which this card constructs from a Blob URL
    // — and a `blob:` URL is a cannot-be-a-base URL, so resolving a relative URL against it
    // throws `Failed to construct 'Request'` and every vector tile ends up `errored` with the
    // map silently blank. This function runs on the main thread, before the URL is passed to
    // the worker, so absolutising here is what makes it resolvable there.
    const absolute = this._toAbsoluteUrl(url);
    if (this._coreTilesToken && this._isCoreTilesUrl(absolute)) {
      const separator = absolute.includes('?') ? '&' : '?';
      return { url: `${absolute}${separator}token=${encodeURIComponent(this._coreTilesToken)}` };
    }
    return { url: absolute };
  };

  // Not just the tiles: the style's TileJSON, glyphs and sprites are all served from the same
  // proxy and all 401 without a token. The path is what identifies them, not a prefix of the
  // string — callers pass an already-absolutised URL, but a relative one still resolves here.
  private _isCoreTilesUrl(url: string): boolean {
    try {
      return new URL(url, document.baseURI).pathname.startsWith(CORE_TILES_API_PREFIX);
    } catch {
      return false;
    }
  }

  private async _getMapLibre() {
    if (!this._maplibregl) {
      // v6 really does need its Web Worker as a separate file — it is no longer a string inside
      // the main bundle the way it was in v5. Without it MapLibre cannot parse vector tiles and
      // gives no sign of it: the style comes back with no sources and no layers, isStyleLoaded()
      // stays false, no tile request is made and nothing throws. `installMapLibreWorker` supplies
      // the worker from a blob built out of the bundled source; it must run before the first
      // `new maplibregl.Map(...)` below. Moving off v5 was not optional either —
      // GHSA-jrc7-96c5-q579 is a critical XSS sanitizer bypass there.
      const maplibregl = await import('maplibre-gl');
      installMapLibreWorker(maplibregl);
      this._maplibregl = maplibregl;
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

      const darkMode = this._darkMode;

      const useCoreTiles = await this._useCoreTiles();
      if (!this.isConnected || this._map) {
        return;
      }

      // Both sides ship a real dark style, so the theme is a choice between two styles rather
      // than anything done to the rendered canvas. The proxy's style is fetched and resolved
      // here; OpenFreeMap's is a URL MapLibre can load by itself.
      const coreStyle = useCoreTiles
        ? await this._loadCoreTilesStyle(darkMode ? CORE_TILES_DARK_STYLE : CORE_TILES_LIGHT_STYLE)
        : null;
      if (!this.isConnected || this._map) {
        return;
      }
      if (coreStyle) {
        this._startCoreTilesTokenRefresh();
      } else {
        // Nothing under the proxy is being requested any more, so the token is not needed and
        // must not outlive the decision to fall back.
        this._coreTilesToken = null;
      }

      const style: MapStyle = coreStyle ?? (darkMode ? OPENFREEMAP_DARK_STYLE : OPENFREEMAP_LIGHT_STYLE);

      // Seed an initial center/zoom from home coordinates when known, so the first
      // auto-zoom (in _autoZoomMap) has a sensible zoom level to fall back to
      // instead of MapLibre's default zoom 0 (whole world).
      const initialCenter: [number, number] = this.homeCoords ? [this.homeCoords.lon, this.homeCoords.lat] : [0, 0];
      const initialZoom = this.homeCoords ? this._configuredZoom : 0;

      this._map = new maplibregl.Map({
        container: mapContainer,
        style,
        center: initialCenter,
        zoom: initialZoom,
        maxZoom: MAX_MAP_ZOOM,
        attributionControl: false,
        transformRequest: this._transformRequest,
      });
      // Recorded only once the map exists, so a failed construction cannot leave a theme
      // marked as applied and suppress the rebuild that a later theme switch needs.
      this._appliedDarkMode = darkMode;

      this._map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
      this._collapseAttributionOnce(mapContainer);
      this._map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');

      // MapLibre sets `originalEvent` only for camera changes a person actually caused (drag,
      // wheel, touch, keyboard) — a more reliable signal than the programmatic-change guard
      // alone: a single resize can fire move events after the guard's settle window has
      // elapsed, which would otherwise be misread as real interaction and silently disable
      // auto-zoom. The guard still applies `interaction-disabled` (pointer-events: none)
      // during our own camera moves, so a real drag can't reach the map while one is running.
      const markUserInteracted = (event?: { originalEvent?: unknown }) => {
        if (!event?.originalEvent) return;
        this._userInteractedWithMap = true;
        this._updateRecenterButtonState();
      };
      this._map.on('zoomstart', markUserInteracted);
      this._map.on('movestart', markUserInteracted);
      this._map.on('dragstart', markUserInteracted);
      this._map.on('moveend', this._handleMapMoveEnd);

      const recenterControl = new RecenterControl(
        () => {
          this._userInteractedWithMap = false;
          // With auto-zoom on, _updateMapMarkers refits the strikes; with it off, nothing does.
          if (!this._autoZoomEnabled) {
            this._resetView();
          }
          this._updateMapMarkers();
          this._updateRecenterButtonState();
        },
        localize(this.hass, 'component.blc.card.map.recenter'),
      );
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

    // Active = the map still shows the view the card placed, so the button has nothing to do.
    const atCardsView = !this._userInteractedWithMap;
    const key = this._autoZoomEnabled
      ? atCardsView
        ? 'auto_zoom_enabled'
        : 'recenter_enable_auto_zoom'
      : atCardsView
        ? 'at_configured_view'
        : 'recenter_reset_zoom';
    const label = localize(this.hass, `component.blc.card.map.${key}`);

    this._recenterButton.classList.toggle('active', atCardsView);
    this._recenterButton.title = label;
    this._recenterButton.setAttribute('aria-label', label);
  }

  protected render() {
    const strikeColor = this.config.strike_color || 'var(--warning-color, #ffc107)';
    return html`<div id="map-container" class="map-container" style="--map-strike-color: ${strikeColor};"></div>`;
  }

  static styles = [maplibreCss, mapStyles];
}

customElements.define('blitzortung-map', BlitzortungMap);
