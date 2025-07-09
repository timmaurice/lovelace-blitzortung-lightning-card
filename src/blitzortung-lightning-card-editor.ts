import { LitElement, html } from 'lit';
import { property, state } from 'lit/decorators.js';
import { BlitzortungCardConfig, HomeAssistant, LovelaceCardEditor, LovelaceCardConfig } from './types';
import 'vanilla-colorful/hex-color-picker.js';
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
  @state() private _colorPickerOpenFor: keyof BlitzortungCardConfig | null = null;

  public setConfig(config: BlitzortungCardConfig): void {
    this._config = config;
  }

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('click', this._handleOutsideClick);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('click', this._handleOutsideClick);
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
      } catch (e) {
        // This can happen if another custom card breaks the helpers.
        console.error('Error loading editor helpers:', e);
      }
      this.requestUpdate();
    })();
  }

  private _handleOutsideClick = (e: MouseEvent): void => {
    if (!this._colorPickerOpenFor) return;

    const path = e.composedPath();
    if (path.some((el) => el instanceof HTMLElement && el.dataset.configValue === this._colorPickerOpenFor)) {
      // Click was inside the currently open picker's wrapper, so do nothing.
      return;
    }

    // Click was outside, close the picker.
    this._closeColorPicker();
  };

  private _toggleColorPicker(configValue: keyof BlitzortungCardConfig): void {
    this._colorPickerOpenFor = this._colorPickerOpenFor === configValue ? null : configValue;
  }

  private _closeColorPicker(): void {
    if (this._colorPickerOpenFor !== null) {
      this._colorPickerOpenFor = null;
    }
  }

  private _valueChanged(ev: Event): void {
    // Stop the event from bubbling up to Lovelace, which can cause race conditions.
    ev.stopPropagation();
    if (!this._config || !this.hass || !ev.target) {
      return;
    }

    const target = ev.currentTarget as HTMLElement & {
      configValue: keyof BlitzortungCardConfig;
      value: string | number | null;
      checked?: boolean;
      type?: string;
    };

    let value: unknown;
    // Check for custom events with a detail object, common in HA components and our new color picker.
    if ((ev as CustomEvent).detail?.value !== undefined) {
      value = (ev as CustomEvent).detail.value;
    } else if (target.checked !== undefined) {
      value = target.checked;
    } else {
      value = target.value;
    }

    const configKey = target.configValue as keyof BlitzortungCardConfig;

    const newConfig = { ...this._config };

    if (value === '' || value === null || value === false) {
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
    type: 'textfield' | 'entity' | 'select' | 'color' | 'switch';
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
      // The color picker needs a concrete color value. If we have a CSS variable,
      // we resolve it to its hex value for display. The config will store the
      // variable until the user picks a new color.
      let resolvedValue = value;
      if (value && value.startsWith('var(')) {
        try {
          const varName = value.substring(4, value.length - 1);
          resolvedValue = getComputedStyle(this).getPropertyValue(varName).trim();
        } catch (e) {
          console.error('Failed to resolve CSS variable', value, e);
          resolvedValue = '#000000'; // Fallback to black
        }
      }

      const handleClear = (e: Event): void => {
        e.stopPropagation(); // Prevent the textfield click from reopening the picker
        // Create a new config object with the key removed
        const newConfig = { ...this._config };
        delete newConfig[fieldConfig.configValue];

        // Fire the event to notify Lovelace of the change
        const event = new CustomEvent('config-changed', {
          detail: { config: newConfig },
          bubbles: true,
          composed: true,
        });
        this.dispatchEvent(event);
        this._closeColorPicker();
      };

      const isPickerOpen = this._colorPickerOpenFor === fieldConfig.configValue;

      return html`
        <div class="color-input-wrapper" data-config-value=${fieldConfig.configValue}>
          <ha-textfield
            .label=${localize(this.hass, fieldConfig.label)}
            .value=${value}
            .configValue=${fieldConfig.configValue}
            .placeholder=${'e.g., #ff0000 or var(--primary-color)'}
            @input=${this._valueChanged}
            @click=${() => this._toggleColorPicker(fieldConfig.configValue)}
          >
            <ha-icon-button
              slot="trailingIcon"
              class="clear-button"
              .label=${'Clear'}
              @click=${handleClear}
              title="Clear color"
            >
              <ha-icon icon="mdi:close"></ha-icon>
            </ha-icon-button>
          </ha-textfield>
          ${isPickerOpen
            ? html`
                <div class="color-picker-popup">
                  <hex-color-picker
                    .configValue=${fieldConfig.configValue}
                    .color=${resolvedValue || '#000000'}
                    @color-changed=${this._valueChanged}
                  ></hex-color-picker>
                </div>
              `
            : ''}
        </div>
      `;
    }

    if (fieldConfig.type === 'switch') {
      return html`
        <ha-formfield .label=${localize(this.hass, fieldConfig.label)}>
          <ha-switch
            .checked=${this._config[fieldConfig.configValue] === true}
            .configValue=${fieldConfig.configValue}
            @change=${this._valueChanged}
          >
          </ha-switch>
        </ha-formfield>
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

    const appearanceFields = [
      { configValue: 'grid_color', label: 'component.blc.editor.grid_color', type: 'color' },
      { configValue: 'strike_color', label: 'component.blc.editor.strike_color', type: 'color' },
    ] as const;

    const featureFields = [
      { configValue: 'show_history_chart', label: 'component.blc.editor.show_history_chart', type: 'switch' },
    ] as const;

    return html`
      <div class="card-config">
        <div class="section">
          <h3>Core Entities</h3>
          ${coreFields.map((field) => this._renderField(field))}
        </div>

        <div class="section">
          <h3>Radar Settings</h3>
          ${radarFields.map((field) => this._renderField(field))}
        </div>

        <div class="section">
          <h3>Appearance</h3>
          ${appearanceFields.map((field) => this._renderField(field))}
        </div>

        <div class="section">
          <h3>Map Settings</h3>
          ${mapFields.map((field) => this._renderField(field))}
        </div>

        <div class="section">
          <h3>Features</h3>
          ${featureFields.map((field) => this._renderField(field))}
        </div>
      </div>
    `;
  }

  static styles = editorStyles;
}

customElements.define('blitzortung-lightning-card-editor', BlitzortungLightningCardEditor);
