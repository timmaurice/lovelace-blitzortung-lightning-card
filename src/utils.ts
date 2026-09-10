import { HomeAssistant, NumberFormat } from './types';
import { localize, resolveLanguage } from './localize';

/**
 * Converts degrees to radians.
 * @param degrees The angle in degrees.
 * @returns The angle in radians.
 */
function toRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Converts radians to degrees.
 * @param radians The angle in radians.
 * @returns The angle in degrees.
 */
function toDeg(radians: number): number {
  return (radians * 180) / Math.PI;
}

/**
 * Calculates the destination point given a starting point, distance, and bearing.
 * @param lat1 Latitude of the starting point.
 * @param lon1 Longitude of the starting point.
 * @param distanceKm Distance to the destination in kilometers.
 * @param bearingDeg Bearing in degrees from the north.
 * @returns An object with latitude and longitude of the destination point.
 */
export function destinationPoint(
  lat1: number,
  lon1: number,
  distanceKm: number,
  bearingDeg: number,
): { latitude: number; longitude: number } {
  const R = 6371; // Earth radius in km
  const δ = distanceKm / R; // angular distance
  const θ = toRad(bearingDeg);
  const φ1 = toRad(lat1);
  const λ1 = toRad(lon1);

  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));

  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));

  return {
    latitude: toDeg(φ2),
    longitude: toDeg(λ2),
  };
}

/**
 * Calculates the azimuth (bearing) from one geographic point to another.
 * @param lat1 Latitude of the starting point.
 * @param lon1 Longitude of the starting point.
 * @param lat2 Latitude of the destination point.
 * @param lon2 Longitude of the destination point.
 * @returns The azimuth in degrees (0-360).
 */
export function calculateAzimuth(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const lat1Rad = toRad(lat1);
  const lat2Rad = toRad(lat2);
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
  let bearing = Math.atan2(y, x);
  bearing = toDeg(bearing);
  return (bearing + 360) % 360;
}

/**
 * Calculates the distance between two geographic points using the Haversine formula.
 * @param lat1 Latitude of the first point.
 * @param lon1 Longitude of the first point.
 * @param lat2 Latitude of the second point.
 * @param lon2 Longitude of the second point.
 * @returns The distance in kilometers.
 */
export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in km
}

const KM_PER_MILE = 1.609344;

/**
 * Converts a distance in kilometers to the given display unit. Only 'mi' is converted;
 * any other unit (including the default 'km') is returned unchanged.
 * @param km The distance in kilometers.
 * @param unit The unit to convert to, as reported by the distance entity (e.g. 'km', 'mi').
 * @returns The distance expressed in `unit`.
 */
export function convertDistance(km: number, unit: string): number {
  return unit === 'mi' ? km / KM_PER_MILE : km;
}

/**
 * The inverse of {@link convertDistance}: converts a distance expressed in `unit` back to
 * kilometers. Used to turn a user-entered distance (e.g. a mile-denominated radius) back into
 * the kilometers strike distances are always computed in.
 * @param distance The distance expressed in `unit`.
 * @param unit The unit `distance` is expressed in (e.g. 'km', 'mi').
 * @returns The distance in kilometers.
 */
export function convertToKm(distance: number, unit: string): number {
  return unit === 'mi' ? distance * KM_PER_MILE : distance;
}

/**
 * Converts an angle in degrees to a compass direction string (e.g., 'NNE').
 * @param hass The HomeAssistant object for localization.
 * @param angle The angle in degrees.
 * @returns The localized compass direction.
 */
export function getDirection(hass: HomeAssistant, angle: number | undefined): string {
  if (typeof angle !== 'number' || isNaN(angle)) {
    return '';
  }
  const directionKeys = [
    'N',
    'NNE',
    'NE',
    'ENE',
    'E',
    'ESE',
    'SE',
    'SSE',
    'S',
    'SSW',
    'SW',
    'WSW',
    'W',
    'WNW',
    'NW',
    'NNW',
  ];
  if (angle < 0) {
    angle = 360 + angle;
  }
  const index = Math.round((angle % 360) / 22.5) % 16;
  const key = directionKeys[index];
  return localize(hass, `component.blc.card.directions.${key}`);
}

// The locales HA itself formats each explicit `number_format` choice with. `language` and
// `system` are resolved separately in `formatNumber`, since neither maps to a fixed tag.
const NUMBER_FORMAT_LOCALES: Partial<Record<NumberFormat, string[]>> = {
  comma_decimal: ['en-US', 'en'],
  decimal_comma: ['de-DE', 'de'],
  space_comma: ['fr-FR', 'fr'],
};

/**
 * Formats a number the way Home Assistant would, so that e.g. a German UI renders `10,5` rather
 * than `10.5`.
 *
 * The user's `hass.locale.number_format` preference wins, because it exists precisely so the
 * number format can differ from the UI language; only `language` (the default) follows the
 * active language, and `none` opts out of localized formatting entirely. Grouping separators are
 * deliberately left on for every localized format, matching how HA renders sensor values: a
 * 1500 km distance reads `1.500,0` on a German UI, not `1500,0`.
 *
 * @param hass The HomeAssistant object, used to resolve the number format and active language.
 * @param value The number to format.
 * @param maximumFractionDigits Maximum number of decimals to render.
 * @param minimumFractionDigits Minimum number of decimals to render.
 * @returns The localized string representation of `value`.
 */
export function formatNumber(
  hass: HomeAssistant | undefined,
  value: number,
  maximumFractionDigits = 1,
  minimumFractionDigits = 0,
): string {
  const numberFormat = hass?.locale?.number_format;
  const options: Intl.NumberFormatOptions = { maximumFractionDigits, minimumFractionDigits };
  try {
    if (numberFormat === 'none') {
      // Opted out: a plain decimal point and no grouping, while keeping the caller's decimals.
      return new Intl.NumberFormat('en', { ...options, useGrouping: false }).format(value);
    }
    if (numberFormat === 'system') {
      // Omitting the locale is exactly what "system" means: whatever the browser/OS is set to.
      return new Intl.NumberFormat(undefined, options).format(value);
    }
    const locales = NUMBER_FORMAT_LOCALES[numberFormat ?? 'language'] ?? resolveLanguage(hass);
    return new Intl.NumberFormat(locales, options).format(value);
  } catch {
    // An unknown/invalid language tag would throw a RangeError; fall back to a fixed format.
    return value.toFixed(maximumFractionDigits);
  }
}
