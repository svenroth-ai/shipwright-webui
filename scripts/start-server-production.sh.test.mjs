/**
 * Structural tests for start-server-production.sh — the macOS/Linux production
 * deploy script (the bash parallel of start-server-production.ps1). Bash is not
 * portably executable end-to-end under `node --test` on every CI host, so — like
 * the .ps1 sibling (start-server-production.test.mjs) — we assert the deploy's
 * *structure* by reading the script text.
 *
 * The Mac script MUST preserve the two load-bearing safety contracts that the
 * Windows script pins:
 *   1. ORDER MATTERS — every `npm install` + `npm run build` runs BEFORE the
 *      old server is killed, so a failed install/build leaves the currently
 *      running server untouched (you can never end up with no server).
 *   2. ~/.claude.json self-heal runs TWICE — once up front (Step 0, heals a
 *      PREVIOUS deploy's leftover corruption) and once AGAIN after the
 *      server-kill + server-up confirmation (THIS deploy's server-kill races
 *      the embedded `claude` writers ~seconds later and corrupts the file, so a
 *      single Step-0 run can never heal it). Same rationale as the .ps1 test.
 *
 * Run: node --test scripts/start-server-production.sh.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const shPath = path.join(here, 'start-server-production.sh');
const src = fs.readFileSync(shPath, 'utf8');
const lines = src.split(/\r?\n/);

// A shell line comment starts with `#` (after optional leading whitespace).
// The `#!` shebang is a comment for our purposes too — it invokes nothing.
const isComment = (l) => l.trimStart().startsWith('#');

// Lines that actually INVOKE the repair helper — `node ... repair-claude-json.mjs`
// on a non-comment line. Prose mentions in the header comment are excluded so
// the count reflects real invocations only.
const invokeLineNumbers = lines
  .map((l, i) => [l, i])
  .filter(([l]) => !isComment(l) && /node\b.*repair-claude-json\.mjs/.test(l))
  .map(([, i]) => i);

const firstLineMatching = (re) => lines.findIndex((l) => re.test(l));
const buildLine = firstLineMatching(/npm run build/); // first build (server)
const killLine = firstLineMatching(/Stopping the old server/); // the server-kill
const upConfirmLine = firstLineMatching(/Hono runs in the background/); // server-up OK

// Non-comment lines that run `npm install` / `npm run build`. The deploy MUST
// sync node_modules with package-lock.json BEFORE building: a dependency added
// by a merged PR lands in the lockfile on `git pull` but is absent from
// node_modules until `npm install` runs, so the build otherwise fails with
// "cannot find module" (e.g. @dnd-kit/core). Same contract as the .ps1.
const installLineNumbers = lines
  .map((l, i) => [l, i])
  .filter(([l]) => !isComment(l) && /npm install/.test(l))
  .map(([, i]) => i);
const buildLineNumbers = lines
  .map((l, i) => [l, i])
  .filter(([l]) => !isComment(l) && /npm run build/.test(l))
  .map(([, i]) => i);

test('deploy structure markers are present (guards the other assertions)', () => {
  // If any of these markers are renamed in a refactor, the ordering assertions
  // below would silently pass on a `-1` index — fail loudly instead.
  assert.ok(buildLine >= 0, 'expected an `npm run build` step');
  assert.ok(killLine >= 0, 'expected a "Stopping the old server" step');
  assert.ok(upConfirmLine >= 0, 'expected a server-up confirmation line');
});

test('starts with a bash shebang (invoked as a POSIX shell script)', () => {
  assert.match(
    lines[0] ?? '',
    /^#!.*\b(bash|sh)\b/,
    'first line must be a shebang selecting bash/sh',
  );
});

test('repair-claude-json.mjs is invoked at least TWICE (start + end)', () => {
  assert.ok(
    invokeLineNumbers.length >= 2,
    `expected >= 2 repair invocations, found ${invokeLineNumbers.length}. ` +
      'A single Step-0 run cannot heal the corruption THIS deploy causes — the ' +
      'server-kill races the embedded `claude` writers seconds after Step 0.',
  );
});

test('the FIRST repair runs before the build (Step 0 — heals a prior deploy)', () => {
  assert.ok(
    invokeLineNumbers[0] >= 0 && invokeLineNumbers[0] < buildLine,
    'first repair invocation must precede the build step',
  );
});

test('the LAST repair runs AFTER the server-kill (heals THIS deploy)', () => {
  const last = invokeLineNumbers[invokeLineNumbers.length - 1];
  assert.ok(
    last > killLine,
    'final repair invocation must run after the server-kill that causes ' +
      'the corruption — otherwise it can never heal it',
  );
});

test('the LAST repair runs AFTER the server-up confirmation (clean window)', () => {
  const last = invokeLineNumbers[invokeLineNumbers.length - 1];
  assert.ok(
    last > upConfirmLine,
    'final repair must run after the server is confirmed up — old embedded ' +
      '`claude` are dead, new ones not yet spawned: the clean heal window',
  );
});

test('npm install runs for BOTH server and client (deps synced from the lockfile before build)', () => {
  assert.ok(
    installLineNumbers.length >= 2,
    `expected >= 2 \`npm install\` invocations (server + client), found ${installLineNumbers.length}. ` +
      'Without npm install a dependency added by a merged PR (present only in ' +
      'package-lock.json after a pull) is missing from node_modules and the ' +
      'build fails with "cannot find module" (e.g. @dnd-kit/core).',
  );
});

test('the FIRST npm install precedes the FIRST build (sync before compile)', () => {
  assert.ok(
    installLineNumbers[0] >= 0 && installLineNumbers[0] < buildLineNumbers[0],
    'first npm install must run before the first npm run build',
  );
});

test('every npm install runs BEFORE the server-kill (a failed install leaves the running server untouched)', () => {
  const lastInstall = installLineNumbers[installLineNumbers.length - 1];
  assert.ok(
    lastInstall >= 0 && lastInstall < killLine,
    'all npm install steps must run before the server-kill so a failed install ' +
      'aborts while the currently running server is still untouched (ORDER MATTERS contract).',
  );
});

test('every npm run build runs BEFORE the server-kill (a failed build leaves the running server untouched)', () => {
  const lastBuild = buildLineNumbers[buildLineNumbers.length - 1];
  assert.ok(
    lastBuild >= 0 && lastBuild < killLine,
    'all npm run build steps must run before the server-kill (ORDER MATTERS contract).',
  );
});
