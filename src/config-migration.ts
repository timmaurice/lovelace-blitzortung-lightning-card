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
    config.counter_entity = config.counter as string;
    delete config.counter;
    migrated = true;
  }

  // Legacy: `azimuth: string` -> New: `azimuth_entity: string`
  if (config.azimuth) {
    config.azimuth_entity = config.azimuth as string;
    delete config.azimuth;
    migrated = true;
  }

  // Legacy: `radar_period` or `history_chart_period` -> New: `period`
  if (config.radar_period !== undefined) {
    config.period = config.radar_period;
    delete config.radar_period;
    migrated = true;
  } else if (config.history_chart_period !== undefined) {
    config.period = config.history_chart_period;
    delete config.history_chart_period;
    migrated = true;
  }

  return { config, migrated };
}
