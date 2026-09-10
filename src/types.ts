// By defining the types locally, we make the card self-contained and avoid
// dependency conflicts that can cause issues with the visual editor.

export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: {
    [key: string]: unknown;
    friendly_name?: string;
    unit_of_measurement?: string;
  };
  last_changed?: string;
  last_updated?: string;
}

/**
 * The user's number-format preference (HA profile > "Number format"). It exists so the number
 * format can be decoupled from the UI language, so it must be honoured rather than derived from
 * `locale.language`. `none` means "do not localize numbers at all".
 */
export type NumberFormat = 'language' | 'system' | 'comma_decimal' | 'decimal_comma' | 'space_comma' | 'none';

export interface HomeAssistant {
  states: { [entity_id: string]: HassEntity };
  themes: {
    darkMode: boolean;
    [key: string]: unknown;
  };
  language: string;
  // Present since HA 2023.x; the number/date formatting locale, which can differ from `language`.
  locale?: {
    language: string;
    number_format?: NumberFormat;
    [key: string]: unknown;
  };
  config: {
    latitude: number;
    longitude: number;
    // The integrations this instance has loaded. Used to detect `map_tiles` (HA 2026.9+),
    // which proxies OpenStreetMap tiles through the user's own instance.
    components?: string[];
    [key: string]: unknown;
  };
  callApi<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    parameters?: Record<string, unknown>,
    // The 'secure' parameter was added in HA 2024.7. Making it optional
    secure?: boolean,
  ): Promise<T>;
  callWS<T>(msg: { type: string; [key: string]: unknown }): Promise<T>;
}

/**
 * Where the base map's tiles come from. `auto` uses Home Assistant's own `map_tiles` proxy
 * when that integration is loaded and falls back to OpenFreeMap otherwise; `core` and
 * `openfreemap` force one or the other.
 */
export type MapTileSource = 'auto' | 'core' | 'openfreemap';

export interface LovelaceCardConfig {
  type: string;
  [key: string]: unknown;
}

export interface BlitzortungCardConfig extends LovelaceCardConfig {
  distance_entity: string;
  counter_entity: string;
  azimuth_entity: string;
  lightning_detection_radius: number;
  location_zone_entity?: string;
  period?: '15m' | '30m' | '1h';
  show_compass?: boolean;
  show_radar?: boolean;
  grid_color?: string;
  font_color?: string;
  strike_color?: string;
  show_grid_labels?: boolean;
  show_history_chart?: boolean;
  show_map?: boolean;
  map_theme_mode?: 'auto' | 'light' | 'dark';
  map_tile_source?: MapTileSource;
  map_auto_zoom?: boolean;
  map_zoom?: number;
  map_height?: string;
  map_marker_style?: 'standard' | 'crosshair' | 'plus' | 'dot';
  title?: string;
  card_section_order?: ('compass_radar' | 'history_chart' | 'map')[];
  history_chart_bar_color?: string;
  invert_history_direction?: boolean;
  always_show_full_card?: boolean;
}

export interface LovelaceCardEditor extends HTMLElement {
  hass?: HomeAssistant;
  setConfig(config: LovelaceCardConfig): void;
}

export interface WindowWithCards extends Window {
  customCards?: Array<{
    type: string;
    name: string;
    description: string;
    documentationURL: string;
    preview?: boolean;
    getEntitySuggestion?: (hass: HomeAssistant, entityId: string) => { config: Record<string, unknown> } | null;
  }>;
}
