import { HomeAssistant } from './types';
import { localize } from './localize';

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
  const index = Math.round((angle %= 360) / 22.5) % 16;
  const key = directionKeys[index];
  return localize(hass, `component.blc.card.directions.${key}`);
}
