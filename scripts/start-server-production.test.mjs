/**
 * Structural tests for start-server-production.ps1 — the production deploy
 * script. PowerShell is not executable cross-platform under `node --test`, so we
 * assert the deploy's *structure* by reading the script text (same file-reading
 * convention as repair-claude-json.test.mjs / kill-targets.test.js).
 *
 * The caller is now HALF the deploy: it installs, builds, and hands the swap to
 * the detached scripts/deploy-swap.mjs. It must not kill anything itself — run
 * from the Command Center's embedded terminal it is a descendant of the Hono
 * server, so its own kill used to take it down before it could start the new
 * build (iterate-2026-07-14-deploy-self-kill). That no-kill / delegation contract
 * is pinned in CI by server/src/test/deploy-detach.test.ts; THIS suite is the
 * exhaustive local one (ordering, PORT parity, heal placement).
 *
 * What we pin here:
 *  - the ~/.claude.json self-heal still runs TWICE across the deploy — once
 *    up-front in the caller (Step 0, heals a PREVIOUS deploy's corruption) and
 *    once AFTER the restart. The second one now lives in deploy-swap.mjs: it has
 *    to, because the corruption THIS deploy causes happens when the server-kill
 *    races the embedded `claude` writers — and by then the caller is dead. Older
 *    revisions asserted both invocations sat in this script; that placement is
 *    exactly what made the heal unreachable.
 *  - install + build precede the HAND-OFF (a failed build must leave the running
 *    server untouched — nothing is killed before the swapper is spawned).
 *  - one single $Port variable feeds every sink.
 *
 * Run: node --test scripts/start-server-production.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, 'start-server-production.ps1'), 'utf8');
const swapSrc = fs.readFileSync(path.join(here, 'deploy-swap.mjs'), 'utf8');
const lines = src.split(/\r?\n/);

// A PowerShell line comment starts with `#` (after optional leading whitespace).
const isComment = (l) => l.trimStart().startsWith('#');
const codeLines = lines.filter((l) => !isComment(l));

// Lines that actually INVOKE the repair helper — `node ... repair-claude-json.mjs`
// on a non-comment line. Prose mentions (in the header comment) are excluded so
// the count reflects real invocations only.
const invokeLineNumbers = lines
  .map((l, i) => [l, i])
  .filter(([l]) => !isComment(l) && /node\b.*repair-claude-json\.mjs/.test(l))
  .map(([, i]) => i);

const firstLineMatching = (re) => lines.findIndex((l) => !isComment(l) && re.test(l));
const buildLine = firstLineMatching(/npm run build/); // first build (server)
const handoffLine = firstLineMatching(/deploy-swap\.mjs/); // the detached hand-off
const upConfirmLine = firstLineMatching(/Hono runs in the background/); // server-up OK

const installLineNumbers = lines
  .map((l, i) => [l, i])
  .filter(([l]) => !isComment(l) && /npm install/.test(l))
  .map(([, i]) => i);
const buildLineNumbers = lines
  .map((l, i) => [l, i])
  .filter(([l]) => !isComment(l) && /npm run build/.test(l))
  .map(([, i]) => i);

test('deploy structure markers are present (guards the other assertions)', () => {
  // If any marker is renamed in a refactor, the ordering assertions below would
  // silently pass on a `-1` index — fail loudly instead.
  assert.ok(buildLine >= 0, 'expected an `npm run build` step');
  assert.ok(handoffLine >= 0, 'expected a deploy-swap.mjs hand-off');
  assert.ok(upConfirmLine >= 0, 'expected a server-up confirmation line');
});

test('the caller runs the Step-0 repair BEFORE the build (heals a prior deploy)', () => {
  assert.ok(invokeLineNumbers.length >= 1, 'expected a Step-0 repair invocation');
  assert.ok(
    invokeLineNumbers[0] < buildLine,
    'the first repair invocation must precede the build step',
  );
});

test('the POST-RESTART repair lives in deploy-swap.mjs (the caller is dead by then)', () => {
  // A single Step-0 run cannot heal the corruption THIS deploy causes — the
  // server-kill races the embedded `claude` writers strictly after it. The heal
  // must therefore run in the process that survives the kill.
  assert.match(
    swapSrc,
    /repair-claude-json\.mjs/,
    'deploy-swap.mjs must run the post-restart ~/.claude.json heal — the caller ' +
      'cannot: the kill that causes the corruption is the same kill that kills it.',
  );
});

test('the caller does not attempt a post-restart repair of its own (unreachable code)', () => {
  // Anything the caller schedules after the hand-off may never run. A heal parked
  // there looks like protection and provides none.
  const afterHandoff = invokeLineNumbers.filter((n) => n > handoffLine);
  assert.deepEqual(
    afterHandoff,
    [],
    'a repair invocation after the hand-off is unreachable whenever the deploy ' +
      'runs inside an embedded terminal — it belongs in deploy-swap.mjs.',
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

test('every npm install runs BEFORE the hand-off (a failed install leaves the running server untouched)', () => {
  const lastInstall = installLineNumbers[installLineNumbers.length - 1];
  assert.ok(
    lastInstall >= 0 && lastInstall < handoffLine,
    'all npm install steps must run before the swapper is spawned, so a failed ' +
      'install aborts while the currently running server is still untouched ' +
      '(ORDER MATTERS contract — nothing is killed until the swapper runs).',
  );
});

test('every npm run build runs BEFORE the hand-off (a failed build leaves the running server untouched)', () => {
  const lastBuild = buildLineNumbers[buildLineNumbers.length - 1];
  assert.ok(
    lastBuild >= 0 && lastBuild < handoffLine,
    'all builds must complete before the swapper is spawned — the swapper kills ' +
      'the old server unconditionally.',
  );
});

// --- $PORT / .sh parity (campaign webui-deep-audit D14, F35) ---------------
// The .sh twin derives PORT once with PORT="${PORT:-3847}" and uses it for the
// hand-off, the readiness poll, and every operator message. The .ps1 once
// hardcoded 3847 for the kill sweep + readiness poll, so a Windows operator on a
// custom PORT left the OLD server alive, hit EADDRINUSE, and got a wrong "did NOT
// come up on port 3847" diagnosis. Pin the parity. (The kill sweep itself has
// since moved into deploy-swap.mjs, which applies the SAME guard to its own
// fallback and is handed the resolved port explicitly via --port.)
const localPortLines = codeLines.filter((l) => /Get-NetTCPConnection\s+-LocalPort/i.test(l));

test('derives the port from $env:PORT with a 3847 default (parity with the .sh PORT="${PORT:-3847}")', () => {
  const derives = codeLines.some((l) => /\$env:PORT/.test(l) && /\b3847\b/.test(l));
  assert.ok(
    derives,
    'expected a port variable derived from $env:PORT that defaults to 3847 — ' +
      'the .ps1 parallel of the .sh twin PORT="${PORT:-3847}".',
  );
});

test('every Get-NetTCPConnection poll targets the port variable, not a hardcoded 3847', () => {
  assert.ok(
    localPortLines.length >= 1,
    `expected >= 1 -LocalPort line (the readiness poll), found ${localPortLines.length}`,
  );
  for (const l of localPortLines) {
    assert.match(l, /-LocalPort\s+\$Port\b/i, `-LocalPort must use $Port: ${l.trim()}`);
  }
});

test('the resolved port is handed to the swapper explicitly (--port $Port)', () => {
  // The swapper has its own env fallback, but the caller passing its RESOLVED
  // value keeps ONE port in every sink: caller poll, swapper kill, swapper launch.
  const handoff = codeLines.find((l) => /deploy-swap\.mjs/.test(l)) ?? '';
  assert.match(
    handoff,
    /'--port',\s*\$Port\b/,
    'the hand-off must pass --port $Port so caller and swapper can never target ' +
      'different ports.',
  );
});

test('the "did NOT come up on port" failure message references the port variable, not a literal 3847', () => {
  const failLine = codeLines.find((l) => /did NOT come up on port/i.test(l)) ?? '';
  assert.ok(failLine, 'expected a "did NOT come up on port" failure message');
  assert.match(failLine, /\$Port\b/, 'the failure message must interpolate $Port.');
  assert.doesNotMatch(failLine, /port 3847\b/, 'the failure message must not name a hardcoded port.');
});

test('one SINGLE variable ($Port) is derived from $env:PORT and reused in every sink', () => {
  const usesPort = (re) => codeLines.some((l) => re.test(l));
  assert.ok(
    usesPort(/\$Port\s*=\s*if\s*\(\s*\$env:PORT/i),
    'expected `$Port = if ($env:PORT ...` derivation',
  );
  for (const l of localPortLines) {
    assert.match(l, /-LocalPort\s+\$Port\b/i, `-LocalPort must use $Port: ${l.trim()}`);
  }
  assert.ok(usesPort(/deploy-swap\.mjs.*--port.*\$Port|'--port',\s*\$Port/), 'the hand-off must use $Port');
  assert.ok(usesPort(/did NOT come up on port \$Port\b/i), 'the failure message must use $Port');
});

test('no stray hardcoded 3847 on a code line (only the $env:PORT default derivation keeps it)', () => {
  const strays = codeLines
    .filter((l) => /\b3847\b/.test(l) && !/\$env:PORT/.test(l))
    .map((l) => l.trim());
  assert.deepEqual(
    strays,
    [],
    `no 3847 literal may appear outside the $env:PORT default derivation; found: ${JSON.stringify(strays)}`,
  );
});
