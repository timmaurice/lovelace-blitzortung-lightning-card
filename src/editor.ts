import { LitElement, html, nothing } from 'lit';
import { property, state } from 'lit/decorators.js';
import {
  BlitzortungCardConfig,
  HomeAssistant,
  LovelaceCardEditor,
  LovelaceCardConfig,
  HassEntity,
  LayoutComponent,
  LayoutItem,
} from './types';
import { HexBase } from 'vanilla-colorful/lib/entrypoints/hex';
import { migrateConfig } from './config-migration';
import editorStyles from './styles/blitzortung-lightning-card-editor.scss';
import { localize } from './localize';
import {
  LAYOUT_COMPONENTS,
  MAX_MAP_SPAN,
  convertToKm,
  formatNumber,
  isDefaultLayout,
  layoutFromSectionOrder,
  parseCardLayout,
  serializeLayout,
} from './utils';

// Conditionally define the hex-color-picker to avoid registration conflicts when another card also uses it.
if (!window.customElements.get('hex-color-picker')) {
  window.customElements.define('hex-color-picker', class extends HexBase {});
}

/**
 * The value the card falls back to when a key is absent. A key set to exactly this value is
 * redundant, so the editor removes it rather than writing it into the user's YAML.
 */
const CONFIG_DEFAULTS: Partial<Record<keyof BlitzortungCardConfig, unknown>> = {
  show_compass: true,
  show_radar: true,
  show_history_chart: true,
  show_map: true,
  show_grid_labels: true,
  map_auto_zoom: true,
  map_lock: false,
  invert_history_direction: false,
  always_show_full_card: false,
  map_marker_style: 'standard',
  period: '1h',
};

const LAYOUT_ICONS: Record<LayoutComponent, string> = {
  compass: 'mdi:compass-outline',
  radar: 'mdi:radar',
  history: 'mdi:chart-bar',
  map: 'mdi:map-outline',
};

const SHOW_KEYS: Record<LayoutComponent, keyof BlitzortungCardConfig> = {
  compass: 'show_compass',
  radar: 'show_radar',
  history: 'show_history_chart',
  map: 'show_map',
};

// Pointer travel, in px, that counts as a drag on a resize handle rather than a click.
const RESIZE_DRAG_THRESHOLD = 4;
const SPAN_STEP_PX = 40;

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
  @state() private _draggedTile: LayoutComponent | null = null;
  @state() private _tileDropTarget: LayoutComponent | null = null;
  // The layout while a resize handle is held: rendered live, written to the config on release.
  @state() private _layoutDraft: LayoutItem[] | null = null;
  // An element built before its class exists stays an inert placeholder.
  @state() private _selectorReady = customElements.get('ha-selector') !== undefined;
  @state() private _entitiesPickerReady = customElements.get('ha-entities-picker') !== undefined;

  public setConfig(rawConfig: BlitzortungCardConfig): void {
    // Run the migration to get the up-to-date config structure.
    const { config: migratedConfig, migrated } = migrateConfig(rawConfig);

    // Create a copy to prevent mutating a potentially frozen object. The default layout is
    // deliberately NOT injected here: doing so would write it back out into the user's YAML on
    // the next change. It is derived on demand via `_layout` instead.
    this._config = { ...migratedConfig } as BlitzortungCardConfig;

    // If a migration occurred, fire an event to update the raw YAML editor in real-time.
    if (migrated) {
      this._fireConfigChanged(this._config);
    }

    this.requestUpdate();
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
    // Deliberately fire-and-forget: `render()` must not wait on it. Either of the awaits below
    // can hang forever (a stalled dynamic import, a third-party card whose `getConfigElement()`
    // never resolves), and a `render()` gated on that leaves a permanently blank config panel.
    (async (): Promise<void> => {
      try {
        const helpers = await (window as unknown as WindowWithCardHelpers).loadCardHelpers();

        // This will load ha-entity-picker, ha-select, ha-textfield, etc.
        const entitiesCard = await helpers.createCardElement({ type: 'entities', entities: [] });
        if (entitiesCard?.constructor.getConfigElement) {
          await entitiesCard.constructor.getConfigElement();
        }
      } catch (e) {
        // This can happen if another custom card breaks the helpers, or outside HA entirely.
        // Nothing to do but log it: the editor has already painted, and HA's elements upgrade
        // in place if and when their definitions do land.
        console.error('Error loading editor helpers:', e);
        // Nothing was preloaded, so there is nothing for a re-render to pick up.
        return;
      }
      // The preload only upgrades already-rendered elements, so this render is a refresh, not
      // the first paint - never gate the body on it (see the note above `firstUpdated`).
      this.requestUpdate();
    })();

    if (!this._selectorReady) {
      customElements.whenDefined('ha-selector').then(() => {
        this._selectorReady = true;
      });
    }
    if (!this._entitiesPickerReady) {
      customElements.whenDefined('ha-entities-picker').then(() => {
        this._entitiesPickerReady = true;
      });
    }
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

  private _handleColorPickerKeyDown(e: KeyboardEvent, configValue: keyof BlitzortungCardConfig): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      this._toggleColorPicker(configValue);
    }
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

    if (target.type === 'number' && value !== '' && value !== null) {
      value = Number(value);
    }

    const configKey = target.configValue as keyof BlitzortungCardConfig;

    // Prevent infinite update loops by checking if the value actually changed.
    const currentValue = this._config[configKey];
    // Multi-entity pickers hand back a fresh array every time, so `===` never matches.
    const isUnchangedArray =
      Array.isArray(value) &&
      Array.isArray(currentValue) &&
      value.length === currentValue.length &&
      value.every((entry, i) => entry === currentValue[i]);
    const isNewValueEmpty =
      value === '' || value === null || value === 'auto' || (Array.isArray(value) && value.length === 0);
    const isCurrentValueEmpty =
      currentValue === undefined ||
      currentValue === null ||
      currentValue === 'auto' ||
      (Array.isArray(currentValue) && currentValue.length === 0);

    if (currentValue === value || isUnchangedArray || (isNewValueEmpty && isCurrentValueEmpty)) {
      return;
    }

    const newConfig = { ...this._config };

    if (isNewValueEmpty || value === CONFIG_DEFAULTS[configKey]) {
      // Drop empty strings/null (optional fields like title, map height and zoom) and values
      // that merely restate the default - writing those would clutter the user's YAML.
      delete newConfig[configKey];
    } else {
      (newConfig as Record<string, unknown>)[configKey] = value;
    }

    this._fireConfigChanged(newConfig);
  }

  private get _layout(): LayoutItem[] {
    return this._layoutDraft ?? parseCardLayout(this._config.card_layout) ?? layoutFromSectionOrder(this._config);
  }

  private _writeLayout(items: LayoutItem[], base: BlitzortungCardConfig = this._config): void {
    const newConfig: BlitzortungCardConfig = { ...base, card_layout: serializeLayout(items) };
    if (isDefaultLayout(items, newConfig)) {
      delete newConfig.card_layout;
    }
    this._fireConfigChanged(newConfig);
  }

  private _hideTile(component: LayoutComponent): void {
    this._writeLayout(this._layout.filter((item) => item.component !== component));
  }

  // Re-adding a tile also clears its `show_*: false`, or it would be placed but still not render.
  private _showTile(component: LayoutComponent): void {
    const width = component === 'compass' || component === 'radar' ? 'half' : 'full';
    const base = { ...this._config };
    delete base[SHOW_KEYS[component]];
    this._writeLayout([...this._layout, { component, width, span: 1 }], base);
  }

  private _handleTileDrop(ev: DragEvent, target: LayoutComponent): void {
    ev.preventDefault();
    const dragged = this._draggedTile;
    this._draggedTile = null;
    this._tileDropTarget = null;
    const items = this._layout;
    if (!dragged || dragged === target) return;
    // Taking the target's original index puts the tile behind a target further down and in
    // front of one further up, so either direction can reach either end.
    const next = [...items];
    const [moved] = next.splice(
      items.findIndex((item) => item.component === dragged),
      1,
    );
    next.splice(
      items.findIndex((item) => item.component === target),
      0,
      moved!,
    );
    this._writeLayout(next);
  }

  // A resize handle works by dragging (right edge: width, bottom edge of a half-width map: span)
  // and, for keyboard and touch-precision users, by plain activation, which steps to the next size.
  private _resizeStart(ev: PointerEvent, component: LayoutComponent, axis: 'width' | 'span'): void {
    const items = this._layout;
    const item = items.find((i) => i.component === component);
    if (!item) return;
    ev.preventDefault();
    ev.stopPropagation();
    const handle = ev.currentTarget as HTMLElement;
    const grid = handle.closest('.layout-editor') as HTMLElement;
    const colWidth = grid.clientWidth / 2;
    const startX = ev.clientX;
    const startY = ev.clientY;
    let moved = false;
    this._layoutDraft = items.map((i) => ({ ...i }));
    handle.setPointerCapture?.(ev.pointerId);

    const onMove = (e: PointerEvent): void => {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < RESIZE_DRAG_THRESHOLD) return;
      moved = true;
      const next: LayoutItem = { ...item };
      if (axis === 'width') {
        if (dx > colWidth / 2) next.width = 'full';
        else if (dx < -colWidth / 2) next.width = 'half';
      } else {
        next.span = Math.min(Math.max(item.span + Math.round(dy / SPAN_STEP_PX), 1), MAX_MAP_SPAN);
      }
      this._layoutDraft = items.map((i) => (i.component === component ? next : i));
    };
    const onUp = (): void => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      const draft = this._layoutDraft;
      this._layoutDraft = null;
      if (moved && draft) this._writeLayout(draft);
      else this._stepSize(component, axis);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }

  private _stepSize(component: LayoutComponent, axis: 'width' | 'span'): void {
    this._writeLayout(
      this._layout.map((item) => {
        if (item.component !== component) return item;
        if (axis === 'width') return { ...item, width: item.width === 'half' ? 'full' : 'half' };
        return { ...item, span: item.span >= MAX_MAP_SPAN ? 1 : item.span + 1 };
      }),
    );
  }

  private _handleResizeKey(ev: KeyboardEvent, component: LayoutComponent, axis: 'width' | 'span'): void {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      this._stepSize(component, axis);
    }
  }

  private _renderLayoutEditor(items: LayoutItem[]) {
    const name = (c: LayoutComponent) => localize(this.hass, `component.blc.editor.layout.components.${c}`);
    const hidden = LAYOUT_COMPONENTS.filter((c) => !items.some((item) => item.component === c));
    return html`
      <div class="help-text">${localize(this.hass, 'component.blc.editor.layout.help')}</div>
      <div class="layout-editor">
        ${items.map((item) => {
          const inactive = this._config[SHOW_KEYS[item.component]] === false;
          return html`
            <div
              class="layout-tile ${item.width} span-${item.span} ${inactive ? 'inactive' : ''} ${
                this._draggedTile === item.component ? 'dragging' : ''
              } ${this._tileDropTarget === item.component ? 'drag-over' : ''}"
              data-component=${item.component}
              draggable=${this._layoutDraft ? 'false' : 'true'}
              @dragstart=${(e: DragEvent) => {
                if (this._layoutDraft) {
                  e.preventDefault();
                  return;
                }
                this._draggedTile = item.component;
                if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
              }}
              @dragover=${(e: DragEvent) => {
                e.preventDefault();
                if (this._draggedTile && this._draggedTile !== item.component) this._tileDropTarget = item.component;
              }}
              @dragleave=${() => (this._tileDropTarget = null)}
              @drop=${(e: DragEvent) => this._handleTileDrop(e, item.component)}
              @dragend=${() => {
                this._draggedTile = null;
                this._tileDropTarget = null;
              }}
            >
              <ha-icon class="drag-handle" icon="mdi:drag"></ha-icon>
              <ha-icon icon=${LAYOUT_ICONS[item.component]}></ha-icon>
              <span class="tile-name">${name(item.component)}</span>
              <ha-icon
                class="tile-hide"
                icon="mdi:eye-off-outline"
                role="button"
                tabindex="0"
                title=${localize(this.hass, 'component.blc.editor.layout.hide', { name: name(item.component) })}
                @click=${() => this._hideTile(item.component)}
                @keydown=${(e: KeyboardEvent) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this._hideTile(item.component);
                  }
                }}
              ></ha-icon>
              <div
                class="resize-width"
                role="button"
                tabindex="0"
                title=${localize(this.hass, `component.blc.editor.layout.${item.width === 'half' ? 'make_full' : 'make_half'}`)}
                @pointerdown=${(e: PointerEvent) => this._resizeStart(e, item.component, 'width')}
                @keydown=${(e: KeyboardEvent) => this._handleResizeKey(e, item.component, 'width')}
              ></div>
              ${
                item.component === 'map' && item.width === 'half'
                  ? html`<div
                      class="resize-span"
                      role="button"
                      tabindex="0"
                      title=${localize(this.hass, 'component.blc.editor.layout.span', { count: item.span })}
                      @pointerdown=${(e: PointerEvent) => this._resizeStart(e, item.component, 'span')}
                      @keydown=${(e: KeyboardEvent) => this._handleResizeKey(e, item.component, 'span')}
                    ></div>`
                  : nothing
              }
            </div>
          `;
        })}
      </div>
      ${
        hidden.length
          ? html`<div class="layout-hidden">
              <span>${localize(this.hass, 'component.blc.editor.layout.hidden')}</span>
              ${hidden.map(
                (c) =>
                  html`<button
                    class="layout-chip"
                    title=${localize(this.hass, 'component.blc.editor.layout.show', { name: name(c) })}
                    @click=${() => this._showTile(c)}
                  >
                    <ha-icon icon="mdi:plus"></ha-icon>${name(c)}
                  </button>`,
              )}
            </div>`
          : nothing
      }
    `;
  }

  private _fireConfigChanged(config: BlitzortungCardConfig): void {
    this._config = config;
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
    type: 'textfield' | 'entity' | 'entities' | 'select' | 'color' | 'switch';
    required?: boolean;
    attributes?: Record<string, unknown>;
    options?: readonly { readonly value: string; readonly label: string }[];
    entityFilter?: (entity: HassEntity) => boolean;
    includeDomains?: string[];
  }) {
    const configEntry = this._config[fieldConfig.configValue];
    const value = configEntry === undefined || configEntry === null ? '' : String(configEntry);

    if (fieldConfig.type === 'textfield') {
      return html`
        <ha-input
          .label=${localize(this.hass, fieldConfig.label)}
          .value=${value}
          .configValue=${fieldConfig.configValue}
          @input=${this._valueChanged}
          .type=${(fieldConfig.attributes?.type as string) || undefined}
          .min=${fieldConfig.attributes?.min ?? undefined}
          .max=${fieldConfig.attributes?.max ?? undefined}
          .step=${fieldConfig.attributes?.step ?? undefined}
        ></ha-input>
      `;
    }

    if (fieldConfig.type === 'entity') {
      return html`
        <ha-entity-picker
          .label=${localize(this.hass, fieldConfig.label)}
          .hass=${this.hass}
          .value=${value}
          .configValue=${fieldConfig.configValue}
          .entityFilter=${fieldConfig.entityFilter}
          @value-changed=${this._valueChanged}
          allow-custom-entity
          ?required=${fieldConfig.required}
        ></ha-entity-picker>
      `;
    }

    if (fieldConfig.type === 'entities') {
      // `ha-entities-picker` ships in the `ha-selector-entity` chunk, which Home Assistant only
      // fetches when an entity selector renders. The hidden selector below triggers that import.
      if (!this._entitiesPickerReady) {
        return this._selectorReady
          ? html`<ha-selector
              hidden
              .hass=${this.hass}
              .selector=${{ entity: { multiple: true } }}
              .value=${[]}
            ></ha-selector>`
          : nothing;
      }
      return html`
        <ha-entities-picker
          .label=${localize(this.hass, fieldConfig.label)}
          .hass=${this.hass}
          .value=${Array.isArray(configEntry) ? configEntry : []}
          .configValue=${fieldConfig.configValue}
          .includeDomains=${fieldConfig.includeDomains}
          @value-changed=${this._valueChanged}
        ></ha-entities-picker>
      `;
    }

    if (fieldConfig.type === 'select') {
      return html`
        <ha-select
          .label=${localize(this.hass, fieldConfig.label)}
          .value=${value}
          .configValue=${fieldConfig.configValue}
          .options=${fieldConfig.options}
          @selected=${this._valueChanged}
          @closed=${(ev: Event) => ev.stopPropagation()}
          ?required=${fieldConfig.required}
        >
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

        this._fireConfigChanged(newConfig);
        this._closeColorPicker();
      };

      const isPickerOpen = this._colorPickerOpenFor === fieldConfig.configValue;

      return html`
        <div class="color-input-wrapper" data-config-value=${fieldConfig.configValue}>
          <ha-input
            .label=${localize(this.hass, fieldConfig.label)}
            .value=${value}
            .configValue=${fieldConfig.configValue}
            .placeholder=${'e.g., #ff0000 or var(--primary-color)'}
            @input=${this._valueChanged}
          >
            <ha-icon-button slot="end" class="clear-button" .label=${'Clear'} @click=${handleClear} title="Clear color">
              <ha-icon icon="mdi:close"></ha-icon>
            </ha-icon-button>
          </ha-input>
          <div
            class="color-preview"
            role="button"
            tabindex="0"
            aria-label=${`Toggle color picker for ${fieldConfig.label}`}
            style="background-color: ${resolvedValue || 'transparent'}"
            @click=${() => this._toggleColorPicker(fieldConfig.configValue)}
            @keydown=${(e: KeyboardEvent) => this._handleColorPickerKeyDown(e, fieldConfig.configValue)}
          ></div>
          ${
            isPickerOpen
              ? html`
                  <div class="color-picker-popup">
                    <hex-color-picker
                      .configValue=${fieldConfig.configValue}
                      .color=${resolvedValue || '#000000'}
                      @color-changed=${this._valueChanged}
                    ></hex-color-picker>
                  </div>
                `
              : ''
          }
        </div>
      `;
    }

    if (fieldConfig.type === 'switch') {
      const configValue = fieldConfig.configValue;
      const isDefaultOn = CONFIG_DEFAULTS[configValue] === true;
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

  // The detection radius is entered in whatever unit the selected distance entity reports, so
  // a user whose Home Assistant is set to Imperial configures it in miles rather than km.
  private get _distanceUnit(): string {
    return (this.hass.states[this._config.distance_entity]?.attributes.unit_of_measurement as string) ?? 'km';
  }

  // When the radius is entered in miles, show what it works out to in km - the integration's own
  // radius setting is always in km, so this is the number the user needs to compare it against.
  private _renderMilesConversionHint() {
    const miles = Number(this._config.lightning_detection_radius);
    if (!isFinite(miles) || miles <= 0) {
      return '';
    }
    return localize(this.hass, 'component.blc.editor.distance_help_3', {
      mi: formatNumber(this.hass, miles, 1, 0),
      km: formatNumber(this.hass, convertToKm(miles, 'mi'), 0, 0),
    });
  }

  protected render() {
    if (!this.hass || !this._config) {
      return html``;
    }

    const coreFields = [
      { configValue: 'title', label: 'component.blc.editor.title', type: 'textfield' },
      {
        configValue: 'distance_entity',
        label: 'component.blc.editor.distance_entity',
        type: 'entity',
        required: true,
        entityFilter: (entity: HassEntity) => entity.entity_id.endsWith('_distance'),
      },
      {
        configValue: 'counter_entity',
        label: 'component.blc.editor.counter_entity',
        type: 'entity',
        required: true,
        entityFilter: (entity: HassEntity) => entity.entity_id.endsWith('_counter'),
      },
      {
        configValue: 'azimuth_entity',
        label: 'component.blc.editor.azimuth_entity',
        type: 'entity',
        required: true,
        entityFilter: (entity: HassEntity) => entity.entity_id.endsWith('_azimuth'),
      },
    ] as const;

    return html`
      <div class="card-config">
        <div class="section">
          <div class="section-header">
            <h3>${localize(this.hass, 'component.blc.editor.sections.core')}</h3>
          </div>
          ${coreFields.map((field) => this._renderField(field))}
          <div class="section-header">
            <label>${localize(this.hass, 'component.blc.editor.location_zone_entity')}</label>
            <ha-icon
              class="help-icon"
              icon="mdi:help-circle-outline"
              role="button"
              tabindex="0"
              @click=${this._toggleCoreHelp}
              title=${localize(this.hass, 'component.blc.editor.toggle_help')}
            ></ha-icon>
          </div>
          ${
            this._coreHelpVisible
              ? html`<div class="help-text">${localize(this.hass, 'component.blc.editor.zone_help')}</div>`
              : ''
          }
          ${this._renderField({
            configValue: 'location_zone_entity',
            label: '',
            type: 'entity',
            entityFilter: (entity: HassEntity) => entity.entity_id.startsWith('zone.'),
          })}
          <div class="section-header">
            <h4>${localize(this.hass, 'component.blc.editor.sections.map_radar_distance')}</h4>
            <ha-icon
              class="help-icon"
              icon="mdi:help-circle-outline"
              role="button"
              tabindex="0"
              @click=${this._toggleDistanceHelp}
              title=${localize(this.hass, 'component.blc.editor.toggle_help')}
            ></ha-icon>
          </div>
          ${
            this._distanceHelpVisible
              ? html`<div class="help-text">
                  ${localize(this.hass, 'component.blc.editor.distance_help_1')}
                  <a href="/config/integrations/integration/blitzortung" target="_blank" rel="noopener noreferrer">
                    ${localize(this.hass, 'component.blc.editor.distance_help_link')} </a
                  >${localize(this.hass, 'component.blc.editor.distance_help_2')}${
                    this._distanceUnit === 'mi' ? this._renderMilesConversionHint() : ''
                  }
                </div>`
              : ''
          }
          ${this._renderField({
            configValue: 'lightning_detection_radius',
            label:
              this._distanceUnit === 'mi'
                ? 'component.blc.editor.lightning_detection_radius_mi'
                : 'component.blc.editor.lightning_detection_radius',
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
          ${this._renderField({
            configValue: 'always_show_full_card',
            label: 'component.blc.editor.always_show_full_card',
            type: 'switch',
          })}
        </div>

        <div class="section">
          <div class="section-header">
            <h3>${localize(this.hass, 'component.blc.editor.sections.compass_radar')}</h3>
          </div>
          <div class="side-by-side">
            ${this._renderField({
              configValue: 'show_compass',
              label: 'component.blc.editor.show_compass',
              type: 'switch',
            })}
            ${this._renderField({
              configValue: 'show_radar',
              label: 'component.blc.editor.show_radar',
              type: 'switch',
            })}
          </div>
          ${
            this._config.show_compass !== false || this._config.show_radar !== false
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
                  ${
                    this._config.show_radar !== false
                      ? this._renderField({
                          configValue: 'show_grid_labels',
                          label: 'component.blc.editor.show_grid_labels',
                          type: 'switch',
                        })
                      : ''
                  }
                `
              : ''
          }
        </div>
        <div class="section">
          <h3>${localize(this.hass, 'component.blc.editor.sections.history_chart')}</h3>
          ${this._renderField({
            configValue: 'show_history_chart',
            label: 'component.blc.editor.show_history_chart',
            type: 'switch',
          })}
          ${
            this._config.show_history_chart !== false
              ? html`
                  ${this._renderField({
                    configValue: 'history_chart_bar_color',
                    label: 'component.blc.editor.history_chart_bar_color',
                    type: 'color',
                  })}
                  ${this._renderField({
                    configValue: 'invert_history_direction',
                    label: 'component.blc.editor.invert_history_direction',
                    type: 'switch',
                  })}
                `
              : ''
          }
        </div>
        <div class="section">
          <h3>${localize(this.hass, 'component.blc.editor.sections.map')}</h3>
          ${this._renderField({
            configValue: 'show_map',
            label: 'component.blc.editor.show_map',
            type: 'switch',
          })}
          ${
            this._config.show_map !== false
              ? html`
                  ${this._renderField({
                    configValue: 'map_theme_mode',
                    label: 'component.blc.editor.map_theme_mode',
                    type: 'select',
                    options: [
                      { value: 'auto', label: localize(this.hass, 'component.blc.editor.map_theme_mode_options.auto') },
                      {
                        value: 'light',
                        label: localize(this.hass, 'component.blc.editor.map_theme_mode_options.light'),
                      },
                      { value: 'dark', label: localize(this.hass, 'component.blc.editor.map_theme_mode_options.dark') },
                    ],
                  })}
                  ${this._renderField({
                    configValue: 'map_tile_source',
                    label: 'component.blc.editor.map_tile_source',
                    type: 'select',
                    options: [
                      {
                        value: 'auto',
                        label: localize(this.hass, 'component.blc.editor.map_tile_source_options.auto'),
                      },
                      {
                        value: 'core',
                        label: localize(this.hass, 'component.blc.editor.map_tile_source_options.core'),
                      },
                      {
                        value: 'openfreemap',
                        label: localize(this.hass, 'component.blc.editor.map_tile_source_options.openfreemap'),
                      },
                    ],
                  })}
                  ${this._renderField({
                    configValue: 'map_marker_style',
                    label: 'component.blc.editor.map_marker_style',
                    type: 'select',
                    options: [
                      {
                        value: 'standard',
                        label: localize(this.hass, 'component.blc.editor.map_marker_style_options.standard'),
                      },
                      {
                        value: 'crosshair',
                        label: localize(this.hass, 'component.blc.editor.map_marker_style_options.crosshair'),
                      },
                      {
                        value: 'plus',
                        label: localize(this.hass, 'component.blc.editor.map_marker_style_options.plus'),
                      },
                      { value: 'dot', label: localize(this.hass, 'component.blc.editor.map_marker_style_options.dot') },
                    ],
                  })}
                  ${this._renderField({
                    configValue: 'map_auto_zoom',
                    label: 'component.blc.editor.map_auto_zoom',
                    type: 'switch',
                  })}
                  ${
                    // Shown regardless of auto-zoom: `map_zoom` is the zoom the map opens at
                    // either way, and the level it keeps while there are no strikes to fit. A
                    // hidden field would make an existing value uneditable, not inapplicable.
                    this._renderField({
                      configValue: 'map_zoom',
                      label: 'component.blc.editor.map_zoom',
                      type: 'textfield',
                      // 22 is MapLibre's camera cap; see MAX_MAP_ZOOM in components/map.ts.
                      attributes: { type: 'number', min: 0, max: 22, step: 1 },
                    })
                  }
                  ${this._renderField({
                    configValue: 'map_height',
                    label: 'component.blc.editor.map_height',
                    type: 'textfield',
                  })}
                  ${this._renderField({
                    configValue: 'map_person_entities',
                    label: 'component.blc.editor.map_person_entities',
                    type: 'entities',
                    includeDomains: ['person', 'device_tracker'],
                  })}
                  ${
                    this._entitiesPickerReady
                      ? html`<div class="help-text">
                          ${localize(this.hass, 'component.blc.editor.map_person_entities_hint')}
                        </div>`
                      : nothing
                  }
                  ${this._renderField({
                    configValue: 'map_lock',
                    label: 'component.blc.editor.map_lock',
                    type: 'switch',
                  })}
                `
              : ''
          }
        </div>

        <div class="section">
          <div class="section-header">
            <h3>${localize(this.hass, 'component.blc.editor.sections.card_layout')}</h3>
          </div>
          ${this._renderLayoutEditor(this._layout)}
        </div>
      </div>
    `;
  }

  static styles = editorStyles;
}

customElements.define('blitzortung-lightning-card-editor', BlitzortungLightningCardEditor);
