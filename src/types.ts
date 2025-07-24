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
}

export interface LovelaceCardConfig {
  type: string;
  [key: string]: unknown;
}

export interface BlitzortungCardConfig extends LovelaceCardConfig {
  distance: string;
  counter: string;
  azimuth: string;
  radar_max_distance?: number;
  grid_color?: string;
  font_color?: string;
  strike_color?: string;
  show_history_chart?: boolean;
  history_chart_period?: '1h' | '15m';
  show_map?: boolean;
  title?: string;
  history_chart_bar_color?: string;
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
    preview?: boolean;
  }>;
}
