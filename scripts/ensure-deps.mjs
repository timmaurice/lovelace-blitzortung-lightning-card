// Keeps node_modules in sync with package-lock.json before e2e runs.
// Compares the versions npm recorded in node_modules/.package-lock.json with
// package-lock.json and runs `npm ci` when they differ or are missing.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';

const log = (line) => process.stdout.write(`${line}\n`);
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

function findStale() {
  if (!existsSync('node_modules/.package-lock.json')) return ['node_modules is missing'];
  const wanted = readJson('package-lock.json').packages ?? {};
  const installed = readJson('node_modules/.package-lock.json').packages ?? {};
  const stale = [];
  for (const [path, meta] of Object.entries(wanted)) {
    if (path === '' || meta.link) continue;
    const have = installed[path];
    if (!have) {
      // Optional packages (e.g. other platforms' binaries) are legitimately absent.
      if (!meta.optional) stale.push(`${path} is not installed`);
    } else if (have.version !== meta.version) {
      stale.push(`${path}: installed ${have.version}, lockfile ${meta.version}`);
    }
  }
  return stale;
}

const stale = findStale();
if (stale.length === 0) process.exit(0);

log(`node_modules is out of sync with package-lock.json (${stale.length} difference(s)):`);
for (const line of stale.slice(0, 5)) log(`  - ${line}`);
log('Running "npm ci" ...');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npm, ['ci'], { stdio: 'inherit' });
if (result.status !== 0) {
  process.stderr.write('npm ci failed; fix the install before running the e2e tests.\n');
  process.exit(result.status ?? 1);
}
