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
 *      hand-off, so a failed install/build leaves the currently running server
 *      untouched (nothing is killed until the swapper is spawned; you can never
 *      end up with no server).
 *   2. THE CALLER NEVER KILLS — kill + start + readiness + post-restart heal live
 *      in the detached scripts/deploy-swap.mjs. Run from an embedded terminal the
 *      caller is a descendant of the Hono server, so its own kill used to take it
 *      down before it could start the new build: fresh build, no server, no error
 *      (iterate-2026-07-14-deploy-self-kill). `nohup`/`setsid` make the swapper
 *      ignore the SIGHUP the dying pty sends, so it survives and finishes alone.
 *   3. ~/.claude.json self-heal still runs TWICE across the deploy — Step 0 in the
 *      caller (heals a PREVIOUS deploy's corruption) and once AFTER the restart,
 *      now inside deploy-swap.mjs. The corruption THIS deploy causes comes from
 *      the server-kill racing the embedded `claude` writers — the caller is dead
 *      by then, so a heal parked there could never run.
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
const swapSrc = fs.readFileSync(path.join(here, 'deploy-swap.mjs'), 'utf8');
const lines = src.split(/\r?\n/);

// A shell line comment starts with `#` (after optional leading whitespace).
// The `#!` shebang is a comment for our purposes too — it invokes nothing.
const isComment = (l) => l.trimStart().startsWith('#');
const codeLines = lines.filter((l) => !isComment(l));

// Lines that actually INVOKE the repair helper — `node ... repair-claude-json.mjs`
// on a non-comment line. Prose mentions in the header comment are excluded so
// the count reflects real invocations only.
const invokeLineNumbers = lines
  .map((l, i) => [l, i])
  .filter(([l]) => !isComment(l) && /node\b.*repair-claude-json\.mjs/.test(l))
  .map(([, i]) => i);

const firstLineMatching = (re) => lines.findIndex((l) => !isComment(l) && re.test(l));
const buildLine = firstLineMatching(/npm run build/); // first build (server)
const handoffLine = firstLineMatching(/deploy-swap\.mjs/); // the detached hand-off
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
  assert.ok(buildLine >= 0, 'expected an `npm run build` step');
  assert.ok(handoffLine >= 0, 'expected a deploy-swap.mjs hand-off');
  assert.ok(upConfirmLine >= 0, 'expected a server-up confirmation line');
});

test('starts with a bash shebang (invoked as a POSIX shell script)', () => {
  assert.match(
    lines[0] ?? '',
    /^#!.*\b(bash|sh)\b/,
    'the .sh twin must carry a shebang so `./scripts/start-server-production.sh` works',
  );
});

test('the caller runs the Step-0 repair BEFORE the build (heals a prior deploy)', () => {
  assert.ok(invokeLineNumbers.length >= 1, 'expected a Step-0 repair invocation');
  assert.ok(
    invokeLineNumbers[0] < buildLine,
    'the first repair invocation must precede the build step',
  );
});

test('the POST-RESTART repair lives in deploy-swap.mjs (the caller is dead by then)', () => {
  assert.match(
    swapSrc,
    /repair-claude-json\.mjs/,
    'deploy-swap.mjs must run the post-restart ~/.claude.json heal — the caller ' +
      'cannot: the kill that causes the corruption is the same kill that kills it.',
  );
});

test('the caller does not attempt a post-restart repair of its own (unreachable code)', () => {
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
    `expected >= 2 \`npm install\` invocations (server + client), found ${installLineNumbers.length}`,
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
    'all npm install steps must run before the swapper is spawned (ORDER MATTERS)',
  );
});

test('every npm run build runs BEFORE the hand-off (a failed build leaves the running server untouched)', () => {
  const lastBuild = buildLineNumbers[buildLineNumbers.length - 1];
  assert.ok(
    lastBuild >= 0 && lastBuild < handoffLine,
    'all builds must complete before the swapper is spawned — the swapper kills ' +
      'the old server unconditionally',
  );
});

test('the hand-off is detached via nohup/setsid (it must ignore the dying pty SIGHUP)', () => {
  const handoff = codeLines.filter((l) => /deploy-swap\.mjs/.test(l)).join('\n');
  assert.match(
    handoff,
    /nohup|setsid/,
    'without nohup/setsid the swapper dies with the pty it was spawned from — ' +
      'exactly the failure this split exists to prevent',
  );
});

test('the resolved PORT is handed to the swapper explicitly (--port "$PORT")', () => {
  const handoff = codeLines.filter((l) => /deploy-swap\.mjs/.test(l)).join('\n');
  assert.match(
    handoff,
    /--port\s+"?\$PORT"?/,
    'caller and swapper must target the same port — pass the resolved value',
  );
});

test('derives PORT once with the ${PORT:-3847} default (parity with the .ps1 $env:PORT guard)', () => {
  assert.ok(
    codeLines.some((l) => /PORT="\$\{PORT:-3847\}"/.test(l)),
    'expected PORT="${PORT:-3847}" — the .sh parallel of the .ps1 $env:PORT derivation',
  );
});
