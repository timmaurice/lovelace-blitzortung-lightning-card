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

  protected render() {
    if (!this.hass || !this._config) {
      return html``;
    }

    const form = html`
      <div class="card-config">
        <ha-textfield
          .label=${localize(this.hass, 'component.blc.editor.title')}
          .value=${this._config.title ?? ''}
          .configValue=${'title'}
          @input=${this._valueChanged}
        ></ha-textfield>
        <ha-entity-picker
          .label=${localize(this.hass, 'component.blc.editor.distance_entity')}
          .hass=${this.hass}
          .value=${this._config.distance}
          .configValue=${'distance'}
          @value-changed=${this._valueChanged}
          allow-custom-entity
          required
        ></ha-entity-picker>
        <ha-entity-picker
          .label=${localize(this.hass, 'component.blc.editor.count_entity')}
          .hass=${this.hass}
          .value=${this._config.count}
          .configValue=${'count'}
          @value-changed=${this._valueChanged}
          allow-custom-entity
          required
        ></ha-entity-picker>
        <ha-entity-picker
          .label=${localize(this.hass, 'component.blc.editor.azimuth_entity')}
          .hass=${this.hass}
          .value=${this._config.azimuth}
          .configValue=${'azimuth'}
          @value-changed=${this._valueChanged}
          allow-custom-entity
          required
        ></ha-entity-picker>
        <ha-entity-picker
          .label=${localize(this.hass, 'component.blc.editor.map_entity')}
          .hass=${this.hass}
          .value=${this._config.map ?? ''}
          .configValue=${'map'}
          @value-changed=${this._valueChanged}
          allow-custom-entity
        ></ha-entity-picker>
        <ha-textfield
          .label=${localize(this.hass, 'component.blc.editor.map_zoom')}
          type="number"
          .value=${this._config.zoom ?? ''}
          .configValue=${'zoom'}
          @input=${this._valueChanged}
        ></ha-textfield>
      </div>
    `;

    return form;
  }

  static styles = editorStyles;
}

customElements.define('blitzortung-lightning-card-editor', BlitzortungLightningCardEditor);
