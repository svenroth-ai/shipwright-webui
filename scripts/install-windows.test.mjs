/**
 * Structural tests for install-windows.ps1 — the Windows autostart installer.
 * PowerShell is not executable cross-platform under `node --test`, so we assert
 * the installer's *structure* by reading the script text (same convention as
 * start-server-production.test.mjs / kill-targets.test.js).
 *
 * What we pin (iterate-2026-06-19-deploy-npm-install): the dependency-install and
 * build steps must (a) NOT swallow stderr to $null and (b) be gated on the npm
 * exit code. `$ErrorActionPreference = "Stop"` does NOT trap a native command's
 * non-zero exit, so without explicit checks a failed `npm install` (e.g. a new
 * dependency that can't resolve) would silently proceed to create a startup
 * shortcut pointing at a server that won't run.
 *
 * Run: node --test scripts/install-windows.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, 'install-windows.ps1'), 'utf8');
const lines = src.split(/\r?\n/);

// A PowerShell line comment starts with `#` (after optional leading whitespace).
const isComment = (l) => l.trimStart().startsWith('#');

const npmLines = lines.filter((l) => !isComment(l) && /npm (install|run build)/.test(l));

test('installs deps for BOTH server and client + builds BOTH (4 npm steps)', () => {
  const installs = npmLines.filter((l) => /npm install/.test(l)).length;
  const builds = npmLines.filter((l) => /npm run build/.test(l)).length;
  assert.ok(installs >= 2, `expected >= 2 npm install steps, found ${installs}`);
  assert.ok(builds >= 2, `expected >= 2 npm run build steps, found ${builds}`);
});

test('npm steps do NOT suppress stderr to $null (a failed install must surface)', () => {
  const suppressed = npmLines.filter((l) => /2>\s*\$null/.test(l));
  assert.equal(
    suppressed.length,
    0,
    'npm steps must not redirect stderr to $null — a swallowed install/build ' +
      `error would silently produce a broken autostart: ${suppressed.join(' | ')}`,
  );
});

test('each npm step is gated on its exit code ($ErrorActionPreference does not trap native exits)', () => {
  const exitChecks = (src.match(/-ne 0/g) || []).length;
  assert.ok(
    exitChecks >= 4,
    'expected >= 4 exit-code gates for the 4 npm steps (2 install + 2 build), ' +
      `found ${exitChecks}. A failed npm install/build must abort before the ` +
      'startup shortcut is created.',
  );
});
