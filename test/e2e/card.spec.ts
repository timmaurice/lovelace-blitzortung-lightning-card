import { test, expect } from './fixtures/hass';
import {
  removeSensors,
  removeState,
  setSensors,
  setStrike,
  useDashboard,
  type SeededStrike,
} from './helpers/homeassistant';

/**
 * The Blitzortung integration is not part of the e2e instance. The card reads
 * `geo_location.lightning_strike_*` states with `source: blitzortung` straight
 * from `hass.states`, so the specs seed exactly those over the REST API.
 *
 * The strikes are global to the instance (the card scans every entity with that
 * prefix), so everything that counts them lives in this one file, whose tests run
 * in order. Specs in other files never look at strikes.
 */
const PREFIX = 'e2e_card';
const RADIUS_KM = 100;

const STRIKES: (SeededStrike & { counted: boolean })[] = [
  // Inside the radius, inside the period: the three the card must draw.
  { entityId: 'geo_location.lightning_strike_e2e_1', northKm: 5, eastKm: 0, ageMinutes: 2, counted: true },
  { entityId: 'geo_location.lightning_strike_e2e_2', northKm: 0, eastKm: 20, ageMinutes: 10, counted: true },
  { entityId: 'geo_location.lightning_strike_e2e_3', northKm: -30, eastKm: -40, ageMinutes: 30, counted: true },
  // Outside the 100 km radius.
  { entityId: 'geo_location.lightning_strike_e2e_far', northKm: 250, eastKm: 0, ageMinutes: 5, counted: false },
  // Older than the one hour period.
  { entityId: 'geo_location.lightning_strike_e2e_old', northKm: 3, eastKm: 0, ageMinutes: 120, counted: false },
  // Not a Blitzortung strike.
  {
    entityId: 'geo_location.lightning_strike_e2e_other',
    northKm: 4,
    eastKm: 4,
    ageMinutes: 3,
    source: 'something_else',
    counted: false,
  },
];
const EXPECTED = STRIKES.filter((strike) => strike.counted).length;

let sensors: Awaited<ReturnType<typeof setSensors>>;
let fullCard: string;
let liveCard: string;

function card(extra: Record<string, unknown> = {}) {
  return {
    type: 'custom:blitzortung-lightning-card',
    title: 'E2E Lightning',
    ...sensors,
    lightning_detection_radius: RADIUS_KM,
    period: '1h',
    map_tile_source: 'openfreemap',
    ...extra,
  };
}

async function clearStrikes() {
  for (const strike of STRIKES) await removeState(strike.entityId);
}

test.beforeAll(async () => {
  await clearStrikes();
  sensors = await setSensors(PREFIX, { distance: 12.3, counter: 42, azimuth: 180 });
  fullCard = await useDashboard('card-full', {
    views: [{ title: 'Card', cards: [card()] }],
  });
  liveCard = await useDashboard('card-live', {
    views: [{ title: 'Card', cards: [card()] }],
  });
});

test.afterAll(async () => {
  await clearStrikes();
  await removeSensors(PREFIX);
});

test.describe.configure({ mode: 'serial' });

test.describe('The card with seeded strikes', () => {
  test('says so when nothing has struck recently', async ({ page }) => {
    await page.goto(`/${liveCard}/0`);
    const message = page.locator('blitzortung-lightning-card .no-strikes-message');
    await expect(message).toBeVisible({ timeout: 60_000 });
    await expect(message).toContainText('No lightning strikes detected recently');
    await expect(page.locator('blitzortung-radar-chart')).toHaveCount(0);
  });

  test('draws a strike that arrives while the dashboard is open', async ({ page }) => {
    await page.goto(`/${liveCard}/0`);
    await expect(page.locator('blitzortung-lightning-card .no-strikes-message')).toBeVisible({ timeout: 60_000 });

    await setStrike(STRIKES[0]);

    // The empty message gives way to the full layout without a reload.
    await expect(page.locator('blitzortung-lightning-card .no-strikes-message')).toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator('blitzortung-radar-chart circle.strike-dot')).toHaveCount(1, { timeout: 30_000 });
    await removeState(STRIKES[0].entityId);
  });

  test.describe('with the full set seeded', () => {
    test.beforeAll(async () => {
      for (const strike of STRIKES) await setStrike(strike);
    });

    test('compass shows the sensor values', async ({ page }) => {
      await page.goto(`/${fullCard}/0`);
      const compass = page.locator('blitzortung-compass');
      await expect(compass).toBeVisible({ timeout: 60_000 });
      await expect(compass).toContainText('42');
      await expect(compass).toContainText('180');
      await expect(compass).toContainText('12.3 km');
    });

    test('radar draws only the strikes in range, in the period, from Blitzortung', async ({ page }) => {
      await page.goto(`/${fullCard}/0`);
      const dots = page.locator('blitzortung-radar-chart circle.strike-dot');
      await expect(dots).toHaveCount(EXPECTED, { timeout: 60_000 });
      // The newest strike leads and is the one flagged as new.
      await expect(page.locator('blitzortung-radar-chart circle.new-strike-dot')).toHaveCount(1);
    });

    test('radar tooltip names distance, direction and time', async ({ page }) => {
      await page.goto(`/${fullCard}/0`);
      const dots = page.locator('blitzortung-radar-chart circle.strike-dot');
      await expect(dots).toHaveCount(EXPECTED, { timeout: 60_000 });

      await dots.first().hover({ force: true });
      const tooltip = page.locator('blitzortung-lightning-card .custom-tooltip.visible');
      await expect(tooltip).toBeVisible();
      await expect(tooltip).toContainText('Distance');
      await expect(tooltip).toContainText('Direction');
      await expect(tooltip).toContainText('Time');
    });

    test('map shows the home marker and one marker per counted strike', async ({ page, consoleErrors }) => {
      await page.goto(`/${fullCard}/0`);
      const map = page.locator('blitzortung-map');
      await expect(map.locator('.maplibregl-canvas')).toBeAttached({ timeout: 60_000 });
      await expect(map.locator('.home-marker')).toHaveCount(1, { timeout: 60_000 });
      await expect(map.locator('.strike-marker-wrapper')).toHaveCount(EXPECTED, { timeout: 60_000 });

      // A marker style from the config reaches the DOM.
      expect(consoleErrors.filter((text) => /blitzortung/i.test(text))).toEqual([]);
    });

    test('map marker style from the config reaches the marker', async ({ page }) => {
      const urlPath = await useDashboard('card-marker', {
        views: [{ title: 'Card', cards: [card({ map_marker_style: 'crosshair' })] }],
      });
      await page.goto(`/${urlPath}/0`);
      await expect(page.locator('blitzortung-map .strike-marker.crosshair')).toHaveCount(EXPECTED, {
        timeout: 60_000,
      });
    });

    test('a strike aging out of the period disappears', async ({ page }) => {
      await page.goto(`/${fullCard}/0`);
      const dots = page.locator('blitzortung-radar-chart circle.strike-dot');
      await expect(dots).toHaveCount(EXPECTED, { timeout: 60_000 });

      // Same entity, now published long ago - what the passage of time does.
      await setStrike({ ...STRIKES[2], ageMinutes: 120 });
      await expect(dots).toHaveCount(EXPECTED - 1, { timeout: 30_000 });
      await expect(page.locator('blitzortung-map .strike-marker-wrapper')).toHaveCount(EXPECTED - 1, {
        timeout: 30_000,
      });
    });
  });
});
