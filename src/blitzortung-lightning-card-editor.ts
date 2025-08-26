import { LitElement, html } from 'lit';
import { property, state } from 'lit/decorators.js';
import { BlitzortungCardConfig, HomeAssistant, LovelaceCardEditor, LovelaceCardConfig } from './types';
import { HexBase } from 'vanilla-colorful/lib/entrypoints/hex';
import { migrateConfig } from './config-migration';
import editorStyles from './styles/blitzortung-lightning-card-editor.scss';
import { localize } from './localize';

// Conditionally define the hex-color-picker to avoid registration conflicts when another card also uses it.
if (!window.customElements.get('hex-color-picker')) {
  window.customElements.define('hex-color-picker', class extends HexBase {});
}

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
  @state() private _distanceHelpVisible = false;
  @state() private _coreHelpVisible = false;

  public setConfig(rawConfig: BlitzortungCardConfig): void {
    // Run the migration to get the up-to-date config structure.
    const { config: migratedConfig, migrated } = migrateConfig(rawConfig);
    this._config = migratedConfig as BlitzortungCardConfig;

    // If a migration occurred, fire an event to update the raw YAML editor in real-time.
    if (migrated) {
      this._fireConfigChanged(this._config);
    }
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

  private _toggleDistanceHelp(): void {
    this._distanceHelpVisible = !this._distanceHelpVisible;
  }

  private _toggleCoreHelp(): void {
    this._coreHelpVisible = !this._coreHelpVisible;
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

    if (configKey === 'overwrite_home_location') {
      const newConfig = { ...this._config };
      if (value) {
        newConfig.overwrite_home_location = true;
      } else {
        delete newConfig.overwrite_home_location;
        delete newConfig.latitude;
        delete newConfig.longitude;
      }
      this._fireConfigChanged(newConfig);
      return;
    }
    const newConfig = { ...this._config };

    if (value === '' || value === null || value === 'auto') {
      // For empty strings or null, remove the key from the config.
      // This is useful for optional fields like title, map, and zoom.
      delete newConfig[configKey];
    } else {
      // Cast to any to handle dynamic key assignment
      (newConfig as Record<string, unknown>)[configKey] = target.type === 'number' ? Number(value) : value;
    }
    this._fireConfigChanged(newConfig);
  }

  private _fireConfigChanged(config: BlitzortungCardConfig): void {
    const event = new CustomEvent('config-changed', {
      detail: { config },
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
          <div
            class="color-preview"
            style="background-color: ${resolvedValue || 'transparent'}"
            @click=${() => this._toggleColorPicker(fieldConfig.configValue)}
          ></div>
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
      const configValue = fieldConfig.configValue;
      const isDefaultOn =
        configValue === 'show_radar' ||
        configValue === 'show_history_chart' ||
        configValue === 'show_map' ||
        configValue === 'show_grid_labels';
      return html`
        <ha-formfield .label=${localize(this.hass, fieldConfig.label)}>
          <ha-switch
            .checked=${isDefaultOn ? this._config[configValue] !== false : this._config[configValue] === true}
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
      { configValue: 'distance_entity', label: 'component.blc.editor.distance_entity', type: 'entity', required: true },
      { configValue: 'counter_entity', label: 'component.blc.editor.counter_entity', type: 'entity', required: true },
      { configValue: 'azimuth_entity', label: 'component.blc.editor.azimuth_entity', type: 'entity', required: true },
    ] as const;

    return html`
      <div class="card-config">
        <div class="section">
          <div class="section-header">
            <h3>${localize(this.hass, 'component.blc.editor.sections.core')}</h3>
          </div>
          ${coreFields.map((field) => this._renderField(field))}
          <div class="switch-with-help">
            <ha-formfield .label=${localize(this.hass, 'component.blc.editor.overwrite_home_location')}>
              <ha-switch
                .checked=${this._config.overwrite_home_location === true}
                .configValue=${'overwrite_home_location'}
                @change=${this._valueChanged}
              >
              </ha-switch>
            </ha-formfield>
            <ha-icon
              class="help-icon"
              icon="mdi:help-circle-outline"
              @click=${this._toggleCoreHelp}
              title=${localize(this.hass, 'component.blc.editor.toggle_help')}
            ></ha-icon>
          </div>
          ${this._coreHelpVisible
            ? html`<div class="help-text">${localize(this.hass, 'component.blc.editor.coordinates_help')}</div>`
            : ''}
          ${this._config.overwrite_home_location
            ? html`<div class="side-by-side">
                ${this._renderField({
                  configValue: 'latitude',
                  label: 'component.blc.editor.latitude',
                  type: 'textfield',
                  attributes: { type: 'number', step: 'any' },
                  required: true,
                })}
                ${this._renderField({
                  configValue: 'longitude',
                  label: 'component.blc.editor.longitude',
                  type: 'textfield',
                  attributes: { type: 'number', step: 'any' },
                  required: true,
                })}
              </div>`
            : ''}
          <div class="section-header">
            <h4>${localize(this.hass, 'component.blc.editor.sections.map_radar_distance')}</h4>
            <ha-icon
              class="help-icon"
              icon="mdi:help-circle-outline"
              @click=${this._toggleDistanceHelp}
              title=${localize(this.hass, 'component.blc.editor.toggle_help')}
            ></ha-icon>
          </div>
          ${this._distanceHelpVisible
            ? html`<div class="help-text">
                ${localize(this.hass, 'component.blc.editor.distance_help_1')}
                <a href="/config/integrations/integration/blitzortung" target="_blank" rel="noopener noreferrer">
                  ${localize(this.hass, 'component.blc.editor.distance_help_link')} </a
                >${localize(this.hass, 'component.blc.editor.distance_help_2')}
              </div>`
            : ''}
          ${this._renderField({
            configValue: 'lightning_detection_radius',
            label: 'component.blc.editor.lightning_detection_radius',
            type: 'textfield',
            attributes: { type: 'number' },
            required: true,
          })}
          ${this._renderField({
            configValue: 'period',
            label: 'component.blc.editor.period',
            type: 'select',
            options: [
              { value: '1h', label: localize(this.hass, 'component.blc.editor.period_options.1h') },
              { value: '30m', label: localize(this.hass, 'component.blc.editor.period_options.30m') },
              { value: '15m', label: localize(this.hass, 'component.blc.editor.period_options.15m') },
            ],
          })}
          ${this._renderField({
            configValue: 'font_color',
            label: 'component.blc.editor.font_color',
            type: 'color',
          })}
        </div>

        <div class="section">
          <div class="section-header">
            <h3>${localize(this.hass, 'component.blc.editor.sections.compass_radar')}</h3>
          </div>
          ${this._renderField({
            configValue: 'show_radar',
            label: 'component.blc.editor.show_radar',
            type: 'switch',
          })}
          ${this._config.show_radar !== false
            ? html`
                ${this._renderField({
                  configValue: 'grid_color',
                  label: 'component.blc.editor.grid_color',
                  type: 'color',
                })}
                ${this._renderField({
                  configValue: 'strike_color',
                  label: 'component.blc.editor.strike_color',
                  type: 'color',
                })}
                ${this._renderField({
                  configValue: 'show_grid_labels',
                  label: 'component.blc.editor.show_grid_labels',
                  type: 'switch',
                })}
              `
            : ''}
        </div>
        <div class="section">
          <h3>${localize(this.hass, 'component.blc.editor.sections.history_chart')}</h3>
          ${this._renderField({
            configValue: 'show_history_chart',
            label: 'component.blc.editor.show_history_chart',
            type: 'switch',
          })}
          ${this._config.show_history_chart !== false
            ? html`
                ${this._renderField({
                  configValue: 'history_chart_bar_color',
                  label: 'component.blc.editor.history_chart_bar_color',
                  type: 'color',
                })}
              `
            : ''}
        </div>
        <div class="section">
          <h3>${localize(this.hass, 'component.blc.editor.sections.map')}</h3>
          ${this._renderField({ configValue: 'show_map', label: 'component.blc.editor.show_map', type: 'switch' })}
          ${this._config.show_map !== false
            ? html`
                ${this._renderField({
                  configValue: 'map_theme_mode',
                  label: 'component.blc.editor.map_theme_mode',
                  type: 'select',
                  options: [
                    { value: 'auto', label: localize(this.hass, 'component.blc.editor.map_theme_mode_options.auto') },
                    { value: 'light', label: localize(this.hass, 'component.blc.editor.map_theme_mode_options.light') },
                    { value: 'dark', label: localize(this.hass, 'component.blc.editor.map_theme_mode_options.dark') },
                  ],
                })}
              `
            : ''}
        </div>
      </div>
    `;
  }

  static styles = editorStyles;
}

customElements.define('blitzortung-lightning-card-editor', BlitzortungLightningCardEditor);
