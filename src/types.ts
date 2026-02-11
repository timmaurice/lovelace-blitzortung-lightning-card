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

export interface HomeAssistant {
  states: { [entity_id: string]: HassEntity };
  themes: {
    darkMode: boolean;
    [key: string]: unknown;
  };
  language: string;
  config: {
    latitude: number;
    longitude: number;
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
  title?: string;
  card_section_order?: ('compass_radar' | 'history_chart' | 'map')[];
  history_chart_bar_color?: string;
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
  }>;
}
