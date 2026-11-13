import { test, expect } from './fixtures/hass';
import { removeSensors, setSensors, useDashboard } from './helpers/homeassistant';

/**
 * The editor is opened the way a user opens it - edit mode, then the card's Edit
 * button - so it runs inside HA's own card editor dialog, against whatever
 * elements this frontend defines. It is the part of the card most exposed to the
 * frontend changing underneath it: it builds on `ha-entity-picker`, `ha-select`,
 * `ha-switch` and friends.
 */
const PREFIX = 'e2e_editor';

let urlPath: string;

test.beforeAll(async () => {
  const sensors = await setSensors(PREFIX, { distance: 8.5, counter: 7, azimuth: 90 });
  urlPath = await useDashboard('editor', {
    views: [
      {
        title: 'Editor',
        cards: [
          {
            type: 'custom:blitzortung-lightning-card',
            title: 'E2E editor',
            ...sensors,
            lightning_detection_radius: 100,
            always_show_full_card: true,
            map_tile_source: 'openfreemap',
          },
        ],
      },
    ],
  });
});

test.afterAll(async () => {
  await removeSensors(PREFIX);
});

test.describe('The editor in a real frontend', () => {
  test('opens, lists the four tiles and builds on elements this frontend defines', async ({ page, consoleErrors }) => {
    await page.goto(`/${urlPath}/0?edit=1`);
    await expect(page.locator('blitzortung-lightning-card ha-card')).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: /^edit$/i }).click();

    const editor = page.locator('blitzortung-lightning-card-editor');
    await expect(editor).toBeVisible({ timeout: 30_000 });

    // The layout editor shows compass, radar, history chart and map.
    await expect(editor.locator('.layout-tile')).toHaveCount(4, { timeout: 30_000 });

    // The entity pickers carry the configured sensors.
    await expect(editor.locator('ha-entity-picker').first()).toBeAttached({ timeout: 30_000 });
    await expect
      .poll(() => editor.evaluate((host) => host.shadowRoot?.querySelectorAll('ha-entity-picker').length ?? 0))
      .toBeGreaterThanOrEqual(3);

    // Every custom element the editor renders is defined: an element HA removed
    // or renamed would otherwise just draw nothing.
    const undefinedTags = await editor.evaluate((host) => {
      const tags = new Set<string>();
      const walk = (root: ParentNode) => {
        for (const el of Array.from(root.querySelectorAll('*'))) {
          const tag = el.tagName.toLowerCase();
          if (tag.includes('-')) tags.add(tag);
          if (el.shadowRoot) walk(el.shadowRoot);
        }
      };
      walk(host.shadowRoot!);
      return [...tags].filter((tag) => !customElements.get(tag));
    });
    expect(undefinedTags).toEqual([]);
    expect(consoleErrors.filter((text) => /blitzortung|has already been used/i.test(text))).toEqual([]);
  });
});
