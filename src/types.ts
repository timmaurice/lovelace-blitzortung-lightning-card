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
}

export interface HomeAssistant {
  states: { [entity_id: string]: HassEntity };
  themes: {
    darkMode: boolean;
    [key: string]: unknown;
  };
  language: string;
}

export interface LovelaceCardConfig {
  type: string;
  [key: string]: unknown;
}

export interface BlitzortungCardConfig extends LovelaceCardConfig {
  distance: string;
  count: string;
  azimuth: string;
  visualization_type?: 'radar' | 'compass';
  radar_max_distance?: number;
  radar_history_size?: number;
  radar_grid_color?: string;
  radar_strike_color?: string;
  map?: string;
  zoom?: number;
  title?: string;
}

export interface LovelaceCardEditor extends HTMLElement {
  hass?: HomeAssistant;
  setConfig(config: LovelaceCardConfig): void;
}
