/**
 * Structural tests for start-server-production.ps1 — the production deploy
 * script. PowerShell is not executable cross-platform under `node --test`, so
 * we assert the deploy's *structure* by reading the script text (same
 * file-reading convention as repair-claude-json.test.mjs / kill-targets.test.js).
 *
 * What we pin (the bug this iterate fixes): the ~/.claude.json self-heal guard
 * (repair-claude-json.mjs) must run TWICE — once up-front (Step 0, before the
 * build) to heal corruption left by a PREVIOUS deploy, and once AGAIN after the
 * server-kill + server-up confirmation, because THIS deploy's server-kill is
 * what races the embedded `claude` writers and corrupts the file ~13s after
 * Step 0. A single Step-0 run can never heal the corruption the same deploy
 * causes (the damage happens strictly after it). See the iterate planning doc
 * 2026-06-14-repair-claude-json-end-heal.md.
 *
 * Run: node --test scripts/start-server-production.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ps1Path = path.join(here, 'start-server-production.ps1');
const src = fs.readFileSync(ps1Path, 'utf8');
const lines = src.split(/\r?\n/);

// A PowerShell line comment starts with `#` (after optional leading whitespace).
const isComment = (l) => l.trimStart().startsWith('#');

// Lines that actually INVOKE the repair helper — `node ... repair-claude-json.mjs`
// on a non-comment line. Prose mentions of the script (in the header comment)
// are intentionally excluded so the count reflects real invocations only.
const invokeLineNumbers = lines
  .map((l, i) => [l, i])
  .filter(([l]) => !isComment(l) && /node\b.*repair-claude-json\.mjs/.test(l))
  .map(([, i]) => i);

const firstLineMatching = (re) => lines.findIndex((l) => re.test(l));
const buildLine = firstLineMatching(/npm run build/); // first build (server)
const killLine = firstLineMatching(/Stopping the old server/); // the server-kill
const upConfirmLine = firstLineMatching(/Hono runs in the background/); // server-up OK

// Lines that run `npm install` / `npm run build` (non-comment). The deploy MUST
// sync node_modules with package-lock.json BEFORE building: a dependency added
// by a merged PR lands in the lockfile on `git pull` but is absent from
// node_modules until `npm install` runs, so the build otherwise fails with
// "cannot find module" (e.g. @dnd-kit/core). See iterate-2026-06-19-deploy-npm-install.
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

test('repair-claude-json.mjs is invoked at least TWICE (start + end)', () => {
  assert.ok(
    invokeLineNumbers.length >= 2,
    `expected >= 2 repair invocations, found ${invokeLineNumbers.length}. ` +
      'A single Step-0 run cannot heal the corruption THIS deploy causes — the ' +
      'server-kill races the embedded `claude` writers ~13s after Step 0.',
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

// --- $PORT / .sh parity (campaign webui-deep-audit D14, F35) ---------------
// The .sh twin (start-server-production.sh) derives PORT once with
// PORT="${PORT:-3847}" and uses it for the kill sweep, the launch env, the
// readiness poll, and every operator message. The .ps1 hardcoded 3847 for the
// kill sweep + readiness poll, so a Windows operator on a custom PORT (a
// documented env override; repo-root .env.local can carry it) left the OLD
// server on the custom port alive, hit EADDRINUSE on the new one, and got a
// wrong "did NOT come up on port 3847" diagnosis. Pin the parity.
const codeLines = lines.filter((l) => !isComment(l));
const localPortLines = codeLines.filter((l) =>
  /Get-NetTCPConnection\s+-LocalPort/i.test(l),
);

test('derives the port from $env:PORT with a 3847 default (parity with the .sh PORT="${PORT:-3847}")', () => {
  const derives = codeLines.some(
    (l) => /\$env:PORT/.test(l) && /\b3847\b/.test(l),
  );
  assert.ok(
    derives,
    'expected a port variable derived from $env:PORT that defaults to 3847 — ' +
      'the .ps1 parallel of the .sh twin PORT="${PORT:-3847}".',
  );
});

test('every Get-NetTCPConnection kill/poll targets the port variable, not a hardcoded 3847 (RED on pre-fix main)', () => {
  assert.ok(
    localPortLines.length >= 2,
    `expected >= 2 -LocalPort lines (the kill sweep + the readiness poll), found ${localPortLines.length}`,
  );
  for (const l of localPortLines) {
    assert.match(
      l,
      /-LocalPort\s+\$\w+/i,
      `-LocalPort must reference the derived port variable: ${l.trim()}`,
    );
    assert.doesNotMatch(
      l,
      /-LocalPort\s+3847\b/,
      `-LocalPort must not hardcode 3847: ${l.trim()}`,
    );
  }
});

test('the launched server env carries the resolved PORT (parity with the .sh PORT="$PORT" node prefix)', () => {
  // The inner cmd must scope PORT to the CHILD (`set "PORT=$Port"&& node ...`),
  // not mutate the script's own $env:PORT — mirrors the .sh PORT="$PORT" prefix
  // and avoids leaking into a dot-sourcing operator's shell.
  const setsEnv = codeLines.some((l) => /PORT=\$Port\b/.test(l));
  assert.ok(
    setsEnv,
    'expected the resolved port passed to the launched node child (e.g. ' +
      '`set "PORT=$Port"&& node ...`) so it reaches node — mirrors the .sh ' +
      'PORT="$PORT" prefix.',
  );
});

test('the "did NOT come up on port" failure message references the port variable, not a literal 3847 (RED on pre-fix main)', () => {
  // AC1 requires the SAME resolved port in EVERY operator message, not just the
  // kill/poll. A hardcoded "port 3847" here misdiagnoses a custom-PORT run.
  const failLine =
    codeLines.find((l) => /did NOT come up on port/i.test(l)) ?? '';
  assert.ok(failLine, 'expected a "did NOT come up on port" failure message');
  assert.match(
    failLine,
    /\$Port\b/,
    'the failure message must interpolate the derived $Port variable.',
  );
  assert.doesNotMatch(
    failLine,
    /port 3847\b/,
    'the failure message must not name a hardcoded port 3847.',
  );
});

test('one SINGLE variable ($Port) is derived from $env:PORT and reused in every sink (kill/launch/poll/message)', () => {
  // Guards the openai code-review concern: structural checks could pass if the
  // script derived $Port but then used a DIFFERENT variable in one sink. Pin the
  // exact name — derivation + both -LocalPort lines + the launch child env + the
  // failure message must all reference $Port.
  const usesPort = (re) => codeLines.some((l) => re.test(l));
  assert.ok(
    usesPort(/\$Port\s*=\s*if\s*\(\s*\$env:PORT/i),
    'expected `$Port = if ($env:PORT ...` derivation',
  );
  for (const l of localPortLines) {
    assert.match(l, /-LocalPort\s+\$Port\b/i, `-LocalPort must use $Port: ${l.trim()}`);
  }
  assert.ok(
    usesPort(/set\b[^\n]*PORT=\$Port\b/i),
    'launch child env (`set "PORT=$Port"&& node ...`) must use $Port',
  );
  assert.ok(
    usesPort(/did NOT come up on port \$Port\b/i),
    'the failure message must use $Port',
  );
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
