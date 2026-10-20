import { BlitzortungCardConfig } from './types';
import { isDefaultLayout, LEGACY_SHOW_KEYS, layoutFromSectionOrder, parseCardLayout, serializeLayout } from './utils';

/**
 * Handles the migration of legacy configuration properties to their new names.
 * This ensures backward compatibility for users updating the card.
 *
 * @param rawConfig The raw configuration object from Home Assistant.
 * @returns A new configuration object with legacy properties migrated.
 */
export function migrateConfig(rawConfig: Record<string, unknown>): {
  config: Record<string, unknown>;
  migrated: boolean;
} {
  const config = { ...rawConfig };
  let migrated = false;

  // Migration from old property names
  // Legacy: `distance: string` -> New: `distance_entity: string`
  if (typeof config.distance === 'string') {
    config.distance_entity = config.distance;
    delete config.distance;
    migrated = true;
  }

  // Legacy: `radar_max_distance: number` -> New: `lightning_detection_radius: number`
  if (config.radar_max_distance !== undefined) {
    config.lightning_detection_radius = config.radar_max_distance;
    delete config.radar_max_distance;
    migrated = true;
  }

  // Legacy: `distance: number` or `max_distance: number` -> New: `lightning_detection_radius: number`
  if (config.distance !== undefined && typeof config.distance === 'number') {
    config.lightning_detection_radius = config.lightning_detection_radius ?? config.distance;
    delete config.distance;
    migrated = true;
  }
  if (config.max_distance !== undefined) {
    config.lightning_detection_radius = config.lightning_detection_radius ?? config.max_distance;
    delete config.max_distance;
    migrated = true;
  }

  // Legacy: `counter: string` -> New: `counter_entity: string`
  if (config.counter) {
    config.counter_entity = config.counter;
    delete config.counter;
    migrated = true;
  }

  // Legacy: `azimuth: string` -> New: `azimuth_entity: string`
  if (config.azimuth) {
    config.azimuth_entity = config.azimuth;
    delete config.azimuth;
    migrated = true;
  }

  // Migration for period (v1.2.0) and location (v1.6.0)
  const migrations: Record<string, string | undefined> = {
    radar_period: 'period',
    history_chart_period: 'period',
    overwrite_home_location: undefined, // Mark for deletion
    latitude: undefined,
    longitude: undefined,
  };

  for (const [oldKey, newKey] of Object.entries(migrations)) {
    if (config[oldKey] !== undefined) {
      if (newKey && config[newKey] === undefined) {
        config[newKey] = config[oldKey];
      }
      delete config[oldKey];
      migrated = true;
    }
  }

  // Legacy (up to 1.18): `card_section_order` -> `card_layout`. An existing `card_layout` wins.
  if (config.card_section_order !== undefined) {
    if (config.card_layout === undefined && Array.isArray(config.card_section_order)) {
      const legacy = config as Partial<BlitzortungCardConfig>;
      const items = layoutFromSectionOrder(legacy, config.card_section_order);
      if (!isDefaultLayout(items, legacy)) {
        config.card_layout = serializeLayout(items);
      }
    }
    delete config.card_section_order;
    migrated = true;
  }

  // Legacy (up to 1.19): `show_compass`/`show_radar`/`show_history_chart`/`show_map` -> the tile
  // left out of `card_layout`. Runs after `card_section_order`, which still reads them, and takes
  // the layout before the keys go: a compass whose radar is switched off keeps the full width.
  const showKeys = Object.values(LEGACY_SHOW_KEYS);
  if (showKeys.some((key) => config[key] !== undefined)) {
    const legacy = config as Partial<BlitzortungCardConfig>;
    const items = (parseCardLayout(legacy.card_layout) ?? layoutFromSectionOrder(legacy)).filter(
      (item) => config[LEGACY_SHOW_KEYS[item.component]] !== false,
    );
    for (const key of showKeys) {
      delete config[key];
    }
    if (isDefaultLayout(items, config)) {
      delete config.card_layout;
    } else {
      config.card_layout = serializeLayout(items);
    }
    migrated = true;
  }

  return { config, migrated };
}
