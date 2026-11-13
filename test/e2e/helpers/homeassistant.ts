/**
 * Talks to the Home Assistant that `test/e2e/ha/docker-compose.yml` provides.
 *
 * Unlike the developer playground in `test-env/` (gitignored, hand-built, with
 * the real Blitzortung sensors faked in YAML), this instance is tracked and
 * minimal, so a clean checkout or CI boots the same thing every time. It mounts
 * `dist/` as `/config/www` - the card is served as `/local/<bundle>` - and the
 * suite registers that as a Lovelace resource itself. The Blitzortung
 * integration is not installed: the specs put the sensors and strike states the
 * card reads onto the state machine over the REST API. Everything they write
 * goes into dashboards of their own.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const E2E_DIR = resolve(here, '..');
const REPO_ROOT = resolve(E2E_DIR, '../..');
/** The compose file lives with the test instance, not at the repository root. */
const COMPOSE_DIR = resolve(E2E_DIR, 'ha');
export const BUNDLE_NAME = 'blitzortung-lightning-card.js';
/** Where the frontend fetches the bundle from, given the `dist:/config/www` mount. */
export const BUNDLE_URL = `/local/${BUNDLE_NAME}`;
const BUNDLE = resolve(REPO_ROOT, `dist/${BUNDLE_NAME}`);
const PACKAGE_JSON = resolve(REPO_ROOT, 'package.json');
const TOKEN_FILE = resolve(E2E_DIR, '.auth.json');

/** Read from the compose file so the suite cannot drift from the environment. */
function portFromCompose(): string {
  const compose = readFileSync(resolve(COMPOSE_DIR, 'docker-compose.yml'), 'utf8');
  const match = compose.match(/'(\d+):8123'/) ?? compose.match(/"(\d+):8123"/);
  if (!match) throw new Error('No published Home Assistant port found in docker-compose.yml');
  return match[1];
}

export const PORT = process.env.HA_E2E_PORT ?? portFromCompose();
export const BASE_URL = `http://127.0.0.1:${PORT}`;
export const USERNAME = process.env.HA_E2E_USER ?? 'admin';
export const PASSWORD = process.env.HA_E2E_PASSWORD ?? 'password';

/**
 * The bundle is built (locally or by CI) and bind-mounted into the container read-only, so the
 * browser gets whatever is on disk - not what `src/` currently says. Rollup
 * stamps `v<version>` into the banner it prints on load, so the version in the
 * file is a cheap way of noticing that the built bundle predates the
 * package. That has bitten sibling repositories: the suite passed against an
 * old bundle and said nothing about the code under test.
 */
function assertBundleIsCurrent(): void {
  const { version } = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as { version: string };
  const bundle = readFileSync(BUNDLE, 'utf8');
  if (!bundle.includes(`v${version}`)) {
    throw new Error(
      `dist/${BUNDLE_NAME} does not carry v${version} - the built bundle is stale, run \`npm run build\``,
    );
  }
}

/** Brings the repository's own compose environment up if it is not running. */
export function ensureRunning(): void {
  // The container serves the card straight out of dist/. Without a build there
  // is nothing to load, and every spec would fail on a missing custom element
  // instead of saying what is actually wrong.
  if (!existsSync(BUNDLE)) {
    throw new Error(`No ${BUNDLE} - run \`npm run build\` before the end-to-end suite`);
  }
  assertBundleIsCurrent();
  execFileSync('docker', ['compose', 'up', '-d'], { cwd: COMPOSE_DIR, stdio: 'inherit' });
}

export async function waitForFrontend(timeoutMs = 180_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      // Not /api/onboarding: that endpoint is gone once onboarding is done.
      const res = await fetch(`${BASE_URL}/manifest.json`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Home Assistant did not answer at ${BASE_URL} within ${timeoutMs}ms`);
}

/**
 * Waits until the core is actually running, not merely answering HTTP.
 *
 * Lovelace resources and the registries land well after the HTTP server starts serving. A check that stops at the
 * frontend can therefore read a half-set-up instance and fail on things that
 * were only late, not broken.
 */
export async function waitForCoreRunning(timeoutMs = 180_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastState = 'unknown';
  while (Date.now() < deadline) {
    try {
      const config = await callWebsocket<{ state: string }>({ type: 'get_config' });
      lastState = config.state;
      if (config.state === 'RUNNING') return;
    } catch {
      // websocket not ready yet
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Home Assistant never reached RUNNING (last saw ${lastState})`);
}

/**
 * Completes Home Assistant's onboarding when the instance is fresh.
 *
 * `test/e2e/ha/config/.storage` is not tracked, so a clean checkout (or CI) starts
 * a Home Assistant that still wants an owner account. Creating that account
 * through the same HTTP API the onboarding screen uses means the suite needs no
 * state from any developer's machine. On an instance that is already onboarded
 * `/api/onboarding` reports every step as done, and this does nothing.
 */
export async function ensureOnboarded(): Promise<void> {
  const clientId = `${BASE_URL}/`;
  const steps = (await (await fetch(`${BASE_URL}/api/onboarding`)).json().catch(() => [])) as {
    step: string;
    done: boolean;
  }[];
  const pending = new Set(steps.filter((s) => !s.done).map((s) => s.step));
  if (pending.size === 0) return;

  let accessToken: string | undefined;
  if (pending.has('user')) {
    const created = await fetch(`${BASE_URL}/api/onboarding/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        name: 'Admin',
        username: USERNAME,
        password: PASSWORD,
        language: 'en',
      }),
    });
    if (!created.ok) throw new Error(`onboarding user step failed: ${created.status}`);
    const { auth_code: code } = (await created.json()) as { auth_code: string };
    const token = await fetch(`${BASE_URL}/auth/token`, {
      method: 'POST',
      body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId }),
    });
    if (!token.ok) throw new Error(`onboarding token exchange failed: ${token.status}`);
    accessToken = ((await token.json()) as { access_token: string }).access_token;
  } else {
    throw new Error(
      `Home Assistant is partly onboarded (${[...pending].join(', ')}) but the user step is done; ` +
        'finish it by hand or remove test/e2e/ha/config/.storage',
    );
  }

  const authorized = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
  const bodies: Record<string, unknown> = {
    core_config: {},
    analytics: {},
    integration: { client_id: clientId, redirect_uri: `${clientId}?auth_callback=1` },
  };
  for (const [step, body] of Object.entries(bodies)) {
    if (!pending.has(step)) continue;
    const res = await fetch(`${BASE_URL}/api/onboarding/${step}`, {
      method: 'POST',
      headers: authorized,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`onboarding ${step} step failed: ${res.status}`);
  }
}

/**
 * The card is served from /local/ through the `dist` mount, but Lovelace only
 * loads it once it is a registered resource. A fresh instance has none, so
 * register it; an instance that already has an entry for the bundle is left
 * untouched.
 */
export async function ensureBundleResource(): Promise<void> {
  const pathOf = (url: string) => new URL(url, 'http://ha.invalid').pathname;
  const existing = await resources();
  if (existing.some((resource) => pathOf(resource.url) === BUNDLE_URL)) return;
  await callWebsocket({ type: 'lovelace/resources/create', res_type: 'module', url: BUNDLE_URL });
}

export interface Tokens {
  access_token: string;
}

export function saveTokens(tokens: Tokens): void {
  writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}

export function readTokens(): Tokens {
  if (!existsSync(TOKEN_FILE)) throw new Error('No token file - did global setup run?');
  return JSON.parse(readFileSync(TOKEN_FILE, 'utf8')) as Tokens;
}

/**
 * Sends one command over the websocket API and returns its result. Node ships a
 * WebSocket client, so this needs no dependency, and it is the same API the
 * frontend itself speaks.
 */
export async function callWebsocket<T = unknown>(message: Record<string, unknown>): Promise<T> {
  const token = readTokens().access_token;
  const socket = new WebSocket(`ws://127.0.0.1:${PORT}/api/websocket`);

  return new Promise<T>((resolve_, reject) => {
    const fail = (reason: string) => {
      socket.close();
      reject(new Error(reason));
    };
    const timer = setTimeout(() => fail('websocket timed out'), 30_000);

    socket.addEventListener('error', () => fail('websocket error'));
    socket.addEventListener('message', (event) => {
      const payload = JSON.parse(String(event.data)) as Record<string, unknown>;
      switch (payload.type) {
        case 'auth_required':
          socket.send(JSON.stringify({ type: 'auth', access_token: token }));
          return;
        case 'auth_invalid':
          clearTimeout(timer);
          fail('websocket authentication was refused');
          return;
        case 'auth_ok':
          socket.send(JSON.stringify({ id: 1, ...message }));
          return;
        case 'result': {
          clearTimeout(timer);
          socket.close();
          if (payload.success) resolve_(payload.result as T);
          else reject(new Error(`websocket command failed: ${JSON.stringify(payload.error)}`));
        }
      }
    });
  });
}

/** Puts a state on the bus, the way any client would. */
export async function setState(
  entityId: string,
  state: string,
  attributes: Record<string, unknown> = {},
): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/states/${entityId}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${readTokens().access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ state, attributes }),
  });
  if (!res.ok) throw new Error(`setting ${entityId} failed: ${res.status} ${await res.text()}`);
}

/** The state an entity currently has, or `undefined` if there is none. */
export async function getState(entityId: string): Promise<string | undefined> {
  const res = await fetch(`${BASE_URL}/api/states/${entityId}`, {
    headers: { Authorization: `Bearer ${readTokens().access_token}` },
  });
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`reading ${entityId} failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { state: string }).state;
}

export async function removeState(entityId: string): Promise<void> {
  await fetch(`${BASE_URL}/api/states/${entityId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${readTokens().access_token}` },
  });
}

/**
 * Gives the caller its own dashboard.
 *
 * Every spec file asks for a different name, so specs can run in parallel
 * without fighting over one dashboard - and none of them touches whatever the
 * manual test instance has on its own dashboards. A dashboard of our own is
 * also the only reliable path: in HA 2026.9 `/lovelace/0` redirects to the new
 * home panel, so the shipped overview cannot be driven from a test.
 */
export async function useDashboard(name: string, config: Record<string, unknown>): Promise<string> {
  const urlPath = `e2e-${name}`;
  const dashboards = await callWebsocket<{ url_path: string }[]>({
    type: 'lovelace/dashboards/list',
  });
  if (!dashboards.some((dashboard) => dashboard.url_path === urlPath)) {
    await callWebsocket({
      type: 'lovelace/dashboards/create',
      url_path: urlPath,
      title: `E2E ${name}`,
      mode: 'storage',
      show_in_sidebar: false,
    });
  }
  await callWebsocket({ type: 'lovelace/config/save', url_path: urlPath, config });
  return urlPath;
}

/** The Lovelace resources Home Assistant has persisted. */
export async function resources(): Promise<{ id: string; url: string; type: string }[]> {
  return callWebsocket({ type: 'lovelace/resources' });
}

/** The location `ha/config/configuration.yaml` gives the instance; the card measures strikes from it. */
export const HOME = { latitude: 52.3731339, longitude: 4.8903147 };

/** A point `northKm` north and `eastKm` east of home - close enough to flat for a few hundred km. */
export function offsetFromHome(northKm: number, eastKm: number): { latitude: number; longitude: number } {
  const latitude = HOME.latitude + northKm / 111.32;
  const longitude = HOME.longitude + eastKm / (111.32 * Math.cos((HOME.latitude * Math.PI) / 180));
  return { latitude, longitude };
}

export interface SeededStrike {
  entityId: string;
  /** Kilometres north of / east of home. */
  northKm: number;
  eastKm: number;
  /** How long ago the strike was published. */
  ageMinutes: number;
  /** What the Blitzortung integration puts in `source`; anything else is not ours. */
  source?: string;
}

/**
 * Puts a `geo_location.lightning_strike_*` state on the bus the way the
 * Blitzortung integration would. The card reads these straight from `hass.states`,
 * so this is the whole integration as far as the card can tell.
 */
export async function setStrike(strike: SeededStrike): Promise<void> {
  const { latitude, longitude } = offsetFromHome(strike.northKm, strike.eastKm);
  await setState(strike.entityId, 'blitzortung', {
    source: strike.source ?? 'blitzortung',
    latitude,
    longitude,
    publication_date: new Date(Date.now() - strike.ageMinutes * 60_000).toISOString(),
    friendly_name: strike.entityId,
  });
}

/** The three sensors every card config names. */
export async function setSensors(
  prefix: string,
  values: { distance: number; counter: number; azimuth: number },
): Promise<{ distance_entity: string; counter_entity: string; azimuth_entity: string }> {
  const ids = {
    distance_entity: `sensor.${prefix}_lightning_distance`,
    counter_entity: `sensor.${prefix}_lightning_counter`,
    azimuth_entity: `sensor.${prefix}_lightning_azimuth`,
  };
  await setState(ids.distance_entity, String(values.distance), {
    unit_of_measurement: 'km',
    device_class: 'distance',
    state_class: 'measurement',
    friendly_name: 'Lightning distance',
  });
  await setState(ids.counter_entity, String(values.counter), {
    state_class: 'total_increasing',
    friendly_name: 'Lightning counter',
  });
  await setState(ids.azimuth_entity, String(values.azimuth), {
    unit_of_measurement: '°',
    friendly_name: 'Lightning azimuth',
  });
  return ids;
}

/** Removes the sensors `setSensors` created. */
export async function removeSensors(prefix: string): Promise<void> {
  for (const name of ['distance', 'counter', 'azimuth']) await removeState(`sensor.${prefix}_lightning_${name}`);
}
