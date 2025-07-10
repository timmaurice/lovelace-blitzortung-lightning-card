import { HomeAssistant } from './types';
import { localize } from './localize';

/**
 * Calculates the azimuth (bearing) from one geographic point to another.
 * @param lat1 Latitude of the starting point.
 * @param lon1 Longitude of the starting point.
 * @param lat2 Latitude of the destination point.
 * @param lon2 Longitude of the destination point.
 * @returns The azimuth in degrees (0-360).
 */
export function calculateAzimuth(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  let brng = Math.atan2(y, x);
  brng = toDeg(brng);
  return (brng + 360) % 360;
}

/**
 * Converts an angle in degrees to a compass direction string (e.g., 'NNE').
 * @param hass The HomeAssistant object for localization.
 * @param angle The angle in degrees.
 * @returns The localized compass direction.
 */
export function getDirection(hass: HomeAssistant, angle: number | undefined): string {
  if (typeof angle !== 'number' || isNaN(angle)) {
    angle = 0;
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
