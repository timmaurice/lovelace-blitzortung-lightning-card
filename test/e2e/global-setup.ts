import { chromium } from '@playwright/test';
import {
  BASE_URL,
  PASSWORD,
  USERNAME,
  ensureBundleResource,
  ensureOnboarded,
  ensureRunning,
  saveTokens,
  waitForCoreRunning,
  waitForFrontend,
} from './helpers/homeassistant';

/**
 * Signs in once and keeps the tokens, so the specs can talk to the websocket
 * API without every one of them logging in again. Home Assistant hands the
 * frontend its tokens through localStorage, so we take them from there rather
 * than inventing a second authentication path.
 */
export default async function globalSetup(): Promise<void> {
  ensureRunning();
  await waitForFrontend();
  await ensureOnboarded();

  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.goto(`${BASE_URL}/`);
    const username = page.getByRole('textbox', { name: 'Username' });
    await username.waitFor({ state: 'visible', timeout: 60_000 });
    await username.fill(USERNAME);
    await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
    const keepLoggedIn = page.getByRole('checkbox', { name: /keep me logged in/i });
    if (!(await keepLoggedIn.isChecked().catch(() => true))) await keepLoggedIn.check();
    await page.getByRole('button', { name: /log in/i }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/auth/'), { timeout: 60_000 });

    const tokens = await page.waitForFunction(
      () => {
        const raw = window.localStorage.getItem('hassTokens');
        return raw ? JSON.parse(raw) : null;
      },
      undefined,
      { timeout: 30_000 },
    );
    saveTokens(await tokens.jsonValue());
    await page.context().storageState({ path: 'test/e2e/.storage-state.json' });
    // Only now can the websocket be used, and only now is it safe to assert on
    // anything that setup registers at startup.
    await waitForCoreRunning();
    await ensureBundleResource();
  } finally {
    await browser.close();
  }
}
