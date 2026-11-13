import { test, expect } from './fixtures/hass';
import { BUNDLE_NAME, BUNDLE_URL, resources, useDashboard } from './helpers/homeassistant';

const CARD_NAME = 'blitzortung-lightning-card';
const EDITOR_NAME = 'blitzortung-lightning-card-editor';

test.describe('Lovelace resource registration', () => {
  test('has exactly one resource for the card bundle', async () => {
    // `ha/docker-compose.yml` mounts dist/ as /config/www, so the bundle is
    // served as /local/<bundle> and global setup registers it once. Two entries
    // would evaluate the module twice.
    const pathOf = (url: string) => new URL(url, 'http://ha.invalid').pathname;
    const ours = (await resources()).filter((resource) => pathOf(resource.url).endsWith(`/${BUNDLE_NAME}`));

    expect(ours).toHaveLength(1);
    expect(pathOf(ours[0].url)).toBe(BUNDLE_URL);
    expect(ours[0].type).toBe('module');
  });

  test('serves the bundle and defines the card and its parts without a clash', async ({ page, consoleErrors }) => {
    const urlPath = await useDashboard('resources', { views: [{ title: 'Empty', cards: [] }] });

    await page.goto(`/${urlPath}/0`);
    await page.waitForFunction((name) => customElements.get(name) !== undefined, CARD_NAME, { timeout: 60_000 });

    // The editor is a separate element in the same bundle: asking the card for
    // its config element is what opening the editor does.
    await page.evaluate((name) => {
      const constructor = customElements.get(name) as unknown as { getConfigElement(): HTMLElement };
      constructor.getConfigElement();
    }, CARD_NAME);

    for (const tag of [
      EDITOR_NAME,
      'blitzortung-compass',
      'blitzortung-radar-chart',
      'blitzortung-history-chart',
      'blitzortung-map',
    ]) {
      await expect.poll(() => page.evaluate((name) => !!customElements.get(name), tag)).toBe(true);
    }

    // The card registers itself in the picker, once.
    const registered = await page.evaluate((name) => {
      const registry = (window as unknown as { customCards?: { type: string }[] }).customCards ?? [];
      return registry.filter((card) => card.type === name).length;
    }, CARD_NAME);
    expect(registered).toBe(1);

    expect(consoleErrors.filter((text) => /has already been used|blitzortung/i.test(text))).toEqual([]);
  });
});
