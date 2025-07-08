import { LitElement, html } from 'lit';
import { property, state } from 'lit/decorators.js';
import { BlitzortungCardConfig, HomeAssistant, LovelaceCardEditor, LovelaceCardConfig } from './types';
import editorStyles from './blitzortung-lightning-card-editor.scss';
import { localize } from './localize';

interface CardHelpers {
  createCardElement(
    config: LovelaceCardConfig,
  ): Promise<LovelaceCardEditor & { constructor: { getConfigElement?: () => Promise<void> } }>;
}

interface WindowWithCardHelpers extends Window {
  loadCardHelpers(): Promise<CardHelpers>;
}

class BlitzortungLightningCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @state() private _config!: BlitzortungCardConfig;
  public setConfig(config: BlitzortungCardConfig): void {
    this._config = config;
  }

  protected firstUpdated(): void {
    // This is a trick to load all the necessary editor components.
    // See: https://github.com/thomasloven/hass-config/wiki/Pre-loading-Lovelace-Elements
    (async (): Promise<void> => {
      try {
        const helpers = await (window as unknown as WindowWithCardHelpers).loadCardHelpers();

        // This will load ha-entity-picker, ha-select, ha-textfield, etc.
        const entitiesCard = await helpers.createCardElement({ type: 'entities', entities: [] });
        if (entitiesCard?.constructor.getConfigElement) {
          await entitiesCard.constructor.getConfigElement();
        }

        // This will load ha-color-picker
        const lightCard = await helpers.createCardElement({ type: 'light', entity: 'light.dummy' });
        if (lightCard?.constructor.getConfigElement) {
          await lightCard.constructor.getConfigElement();
        }
      } catch (e) {
        // This can happen if another custom card breaks the helpers.
        console.error('Error loading editor helpers:', e);
      }
      this.requestUpdate();
    })();
  }

  private _valueChanged(ev: Event): void {
    // Stop the event from bubbling up to Lovelace, which can cause race conditions.
    ev.stopPropagation();
    if (!this._config || !this.hass || !ev.target) {
      return;
    }

    // Special handling for events that have a detail object (e.g., ha-color-picker)
    const detailValue = (ev as CustomEvent).detail?.value;

    const target = ev.currentTarget as HTMLElement & {
      configValue: keyof BlitzortungCardConfig;
      value: string | number | null;
      type?: string;
    };
    const configKey = target.configValue as keyof BlitzortungCardConfig;
    const value = detailValue ?? target.value;

    const newConfig = { ...this._config };

    // When switching to compass, remove the radar-specific fields from the config
    // to prevent any lingering state from causing issues.
    if (configKey === 'visualization_type' && value === 'compass') {
      delete newConfig.radar_max_distance;
      delete newConfig.radar_history_size;
      delete newConfig.radar_grid_color;
      delete newConfig.radar_strike_color;
    }

    if (value === '' || value === null) {
      // For empty strings or null, remove the key from the config.
      // This is useful for optional fields like title, map, and zoom.
      delete newConfig[configKey];
    } else {
      // Cast to any to handle dynamic key assignment
      (newConfig as Record<string, unknown>)[configKey] = target.type === 'number' ? Number(value) : value;
    }

    const event = new CustomEvent('config-changed', {
      detail: { config: newConfig },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(event);
  }

  private _renderField(fieldConfig: {
    configValue: keyof BlitzortungCardConfig;
    label: string;
    type: 'textfield' | 'entity' | 'select' | 'color';
    required?: boolean;
    attributes?: Record<string, unknown>;
    options?: readonly { readonly value: string; readonly label: string }[];
  }) {
    const configEntry = this._config[fieldConfig.configValue];
    const value = configEntry === undefined || configEntry === null ? '' : String(configEntry);

    if (fieldConfig.type === 'textfield') {
      return html`
        <ha-textfield
          .label=${localize(this.hass, fieldConfig.label)}
          .value=${value}
          .configValue=${fieldConfig.configValue}
          @input=${this._valueChanged}
          .type=${(fieldConfig.attributes?.type as string) || undefined}
        ></ha-textfield>
      `;
    }

    if (fieldConfig.type === 'entity') {
      return html`
        <ha-entity-picker
          .label=${localize(this.hass, fieldConfig.label)}
          .hass=${this.hass}
          .value=${value}
          .configValue=${fieldConfig.configValue}
          @value-changed=${this._valueChanged}
          allow-custom-entity
          ?required=${fieldConfig.required}
        ></ha-entity-picker>
      `;
    }

    if (fieldConfig.type === 'select') {
      return html`
        <ha-select
          .label=${localize(this.hass, fieldConfig.label)}
          .value=${value}
          .configValue=${fieldConfig.configValue}
          @change=${this._valueChanged}
          @closed=${(ev: Event) => ev.stopPropagation()}
          ?required=${fieldConfig.required}
        >
          ${fieldConfig.options?.map((opt) => html`<mwc-list-item .value=${opt.value}>${opt.label}</mwc-list-item>`)}
        </ha-select>
      `;
    }

    if (fieldConfig.type === 'color') {
      // Using ha-textfield for color input to ensure editor stability.
      return html`
        <ha-textfield
          .label=${localize(this.hass, fieldConfig.label)}
          .value=${value}
          .configValue=${fieldConfig.configValue}
          @input=${this._valueChanged}
        ></ha-textfield>
      `;
    }

    return html``;
  }

  protected render() {
    if (!this.hass || !this._config) {
      return html``;
    }

    const coreFields = [
      { configValue: 'title', label: 'component.blc.editor.title', type: 'textfield' },
      { configValue: 'distance', label: 'component.blc.editor.distance_entity', type: 'entity', required: true },
      { configValue: 'count', label: 'component.blc.editor.count_entity', type: 'entity', required: true },
      { configValue: 'azimuth', label: 'component.blc.editor.azimuth_entity', type: 'entity', required: true },
    ] as const;

    const visualizationFields = [
      {
        configValue: 'visualization_type',
        label: 'component.blc.editor.visualization_type',
        type: 'select',
        options: [
          { value: 'radar', label: 'Radar' },
          { value: 'compass', label: 'Compass' },
        ],
      },
    ] as const;

    const radarFields = [
      {
        configValue: 'radar_max_distance',
        label: 'component.blc.editor.radar_max_distance',
        type: 'textfield',
        attributes: { type: 'number' },
      },
      {
        configValue: 'radar_history_size',
        label: 'component.blc.editor.radar_history_size',
        type: 'textfield',
        attributes: { type: 'number' },
      },
      { configValue: 'radar_grid_color', label: 'component.blc.editor.radar_grid_color', type: 'color' },
      { configValue: 'radar_strike_color', label: 'component.blc.editor.radar_strike_color', type: 'color' },
    ] as const;

    const mapFields = [
      { configValue: 'map', label: 'component.blc.editor.map_entity', type: 'entity' },
      {
        configValue: 'zoom',
        label: 'component.blc.editor.map_zoom',
        type: 'textfield',
        attributes: { type: 'number' },
      },
    ] as const;

    return html`
      <div class="card-config">
        <div class="section">
          <h3>Core Entities</h3>
          ${coreFields.map((field) => this._renderField(field))}
        </div>

        <div class="section">
          <h3>Visualization</h3>
          ${visualizationFields.map((field) => this._renderField(field))}
          ${(this._config.visualization_type ?? 'radar') !== 'compass'
            ? html`
                <h4>Radar Settings</h4>
                ${radarFields.map((field) => this._renderField(field))}
              `
            : ''}
        </div>

        <div class="section">
          <h3>Map Settings</h3>
          ${mapFields.map((field) => this._renderField(field))}
        </div>
      </div>
    `;
  }

  static styles = editorStyles;
}

customElements.define('blitzortung-lightning-card-editor', BlitzortungLightningCardEditor);
