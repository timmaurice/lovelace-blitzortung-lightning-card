import { LitElement, html } from 'lit';
import { property, state } from 'lit/decorators.js';
import { BlitzortungCardConfig, HomeAssistant, LovelaceCardEditor } from './types';
import editorStyles from './blitzortung-lightning-card-editor.scss';
import { localize } from './localize';
class BlitzortungLightningCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @state() private _config!: BlitzortungCardConfig;
  public setConfig(config: BlitzortungCardConfig): void {
    this._config = config;
  }

  protected firstUpdated(): void {
    // A trick to load ha-entity-picker.
    // See: https://github.com/home-assistant/frontend/issues/13533
    (async () => {
      if (customElements.get('ha-entity-picker')) return;
      const helpers = await (window as any).loadCardHelpers();
      const card = await helpers.createCardElement({ type: 'entities', entities: [] });
      if (card.constructor.getConfigElement) {
        await card.constructor.getConfigElement();
      }
      this.requestUpdate();
    })();
  }

  private _valueChanged(ev: any): void {
    if (!this._config || !this.hass || !ev.target) {
      return;
    }

    const target = ev.target;
    const configKey = target.configValue as keyof BlitzortungCardConfig;

    const value = target.value;

    const newConfig = { ...this._config };

    if (value === '' || value === null) {
      // For empty strings or null, remove the key from the config.
      // This is useful for optional fields like title, map, and zoom.
      delete newConfig[configKey];
    } else {
      // Cast to any to handle dynamic key assignment
      (newConfig as any)[configKey] = target.type === 'number' ? Number(value) : value;
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
    type: 'textfield' | 'entity' | 'select';
    required?: boolean;
    attributes?: { readonly [key: string]: any };
    options?: readonly { readonly value: string; readonly label: string }[];
  }) {
    const value = this._config[fieldConfig.configValue] ?? '';

    if (fieldConfig.type === 'textfield') {
      return html`
        <ha-textfield
          .label=${localize(this.hass, fieldConfig.label)}
          .value=${value}
          .configValue=${fieldConfig.configValue}
          @input=${this._valueChanged}
          ...=${fieldConfig.attributes}
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
          ?required=${fieldConfig.required}
        >
          ${fieldConfig.options?.map((opt) => html`<mwc-list-item .value=${opt.value}>${opt.label}</mwc-list-item>`)}
        </ha-select>
      `;
    }

    return html``;
  }

  protected render() {
    if (!this.hass || !this._config) {
      return html``;
    }

    const fields = [
      { configValue: 'title', label: 'component.blc.editor.title', type: 'textfield' },
      { configValue: 'distance', label: 'component.blc.editor.distance_entity', type: 'entity', required: true },
      { configValue: 'count', label: 'component.blc.editor.count_entity', type: 'entity', required: true },
      { configValue: 'azimuth', label: 'component.blc.editor.azimuth_entity', type: 'entity', required: true },
      {
        configValue: 'visualization_type',
        label: 'component.blc.editor.visualization_type',
        type: 'select',
        options: [
          { value: 'radar', label: 'Radar' },
          { value: 'compass', label: 'Compass' },
        ],
      },
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
      { configValue: 'radar_grid_color', label: 'component.blc.editor.radar_grid_color', type: 'textfield' },
      { configValue: 'radar_strike_color', label: 'component.blc.editor.radar_strike_color', type: 'textfield' },
      { configValue: 'map', label: 'component.blc.editor.map_entity', type: 'entity' },
      {
        configValue: 'zoom',
        label: 'component.blc.editor.map_zoom',
        type: 'textfield',
        attributes: { type: 'number' },
      },
    ] as const;

    const form = html` <div class="card-config">${fields.map((field) => this._renderField(field))}</div> `;

    return form;
  }

  static styles = editorStyles;
}

customElements.define('blitzortung-lightning-card-editor', BlitzortungLightningCardEditor);
