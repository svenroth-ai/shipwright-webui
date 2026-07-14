/**
 * Unit tests for deploy-swap.mjs — the detached kill+start swapper.
 *
 * Why this helper exists (iterate-2026-07-14-deploy-self-kill): the deploy
 * script used to kill the old server and start the new one ITSELF. Run from the
 * Command Center's embedded terminal, the script is a descendant of the very
 * server it kills — the kill tore down the ConPTY, which killed the pty shell
 * and the script with it, so the "start the new server" step NEVER ran. Result:
 * a fresh build on disk and no server at all, with no error output (the process
 * that would have reported it was dead). Empirically verified: a pty shell dies
 * with the server; a `Start-Process` child survives it.
 *
 * The fix moves kill+start+readiness+heal into THIS helper, which the caller
 * spawns DETACHED *before* the kill happens — so it outlives the cascade.
 *
 * Only the pure, side-effect-free exports are unit-tested here. The behavior
 * under a real pty kill is verified end-to-end at F0.5.
 *
 * Run: node --test scripts/deploy-swap.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePort, parseArgs, buildStatus } from './deploy-swap.mjs';
import { killPortsFor } from './deploy-procs.mjs';

// --- resolvePort: parity with the callers' PORT guards -----------------------
// .ps1: $Port = if ($env:PORT -match '^\d{1,5}$') { [int]$env:PORT } else { 3847 }
// .sh : PORT="${PORT:-3847}"
// The swapper is the single sink both callers hand their resolved port to, so
// its own fallback must not disagree with theirs.

test('resolvePort: a valid PORT env wins', () => {
  assert.equal(resolvePort({ PORT: '3947' }), 3947);
});

test('resolvePort: unset / blank / non-numeric PORT degrades to 3847 (never throws)', () => {
  assert.equal(resolvePort({}), 3847);
  assert.equal(resolvePort({ PORT: '' }), 3847);
  assert.equal(resolvePort({ PORT: 'abc' }), 3847);
  assert.equal(resolvePort({ PORT: '-1' }), 3847);
});

test('resolvePort: a >5-digit PORT degrades to 3847 (matches the .ps1 Int32 cap)', () => {
  assert.equal(resolvePort({ PORT: '999999' }), 3847);
});

// --- parseArgs: the caller passes its RESOLVED port explicitly ---------------
// Both callers already derive $Port / $PORT for their own kill-less readiness
// poll and operator messages. Passing it through (rather than re-deriving from
// env inside the swapper) keeps ONE resolved value in every sink — caller and
// swapper can never target different ports.

test('parseArgs: --port overrides the environment', () => {
  assert.equal(parseArgs(['--port', '3947'], { PORT: '3847' }).port, 3947);
});

test('parseArgs: without --port it falls back to the environment', () => {
  assert.equal(parseArgs([], { PORT: '3947' }).port, 3947);
});

test('parseArgs: a malformed --port falls back rather than throwing', () => {
  assert.equal(parseArgs(['--port', 'abc'], {}).port, 3847);
});

// --- killPortsFor: kill scope is EXACTLY the Hono port -----------------------
// Regression guard against reusing kill-targets.computeKillTargets(), which
// returns [PORT, VITE_PORT]: the production deploy must never kill the operator's
// Vite dev server as a side effect. The old inline kill swept the Hono port only.

test('killPortsFor: returns exactly the one Hono port (never Vite)', () => {
  assert.deepEqual(killPortsFor(3847), [3847]);
  assert.deepEqual(killPortsFor(3947), [3947]);
});

test('killPortsFor: does not include the Vite default 5173', () => {
  assert.ok(!killPortsFor(3847).includes(5173));
});

// --- buildStatus: the durable record of the deploy outcome -------------------
// AC4: the caller may be killed mid-deploy by the swapper's own server-kill, so
// it cannot be the one to report success or failure. The swapper writes a
// machine-readable status file instead — otherwise a failed deploy leaves no
// trace at all (exactly what made the 2026-07-14 outage invisible for hours).

test('buildStatus: success carries ok, port, pid and a timestamp', () => {
  const s = buildStatus({ ok: true, port: 3847, pid: 1234, ts: 1700000000000 });
  assert.equal(s.ok, true);
  assert.equal(s.port, 3847);
  assert.equal(s.pid, 1234);
  assert.equal(s.ts, 1700000000000);
  assert.equal(s.error, null);
});

test('buildStatus: failure carries ok=false and the reason', () => {
  const s = buildStatus({ ok: false, port: 3847, ts: 1, error: 'did not bind' });
  assert.equal(s.ok, false);
  assert.equal(s.error, 'did not bind');
  assert.equal(s.pid, null);
});

test('buildStatus: records HOW readiness was established (listener vs process-alive)', () => {
  // 'listener' is the strong claim (the NEW child owns the port). 'process-alive'
  // is the degraded one used where listeners are not observable (no lsof). The
  // caller prints the verdict, so it must be able to tell them apart — and a
  // reader of the status file must not mistake the weak claim for the strong one.
  assert.equal(buildStatus({ ok: true, port: 3847, pid: 1, ts: 1 }).readiness, 'listener');
  assert.equal(
    buildStatus({ ok: true, port: 3847, pid: 1, ts: 1, readiness: 'process-alive' }).readiness,
    'process-alive',
  );
});

// --- PORT contract parity across BOTH callers and the swapper ----------------
// The callers pass their RESOLVED port to the swapper via --port. If a caller
// accepts a value the swapper rejects, the caller polls/reports one port while
// the swapper kills, starts and records another. External review caught exactly
// this: the .sh took `PORT="${PORT:-3847}"` verbatim (so `PORT=abc` or
// `PORT=999999` survived), while the swapper silently fell back to 3847.
// The rule, identical in all three: 1-5 digits AND > 0, else 3847.

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const shSrc = fs.readFileSync(path.join(scriptsDir, 'start-server-production.sh'), 'utf8');
const ps1Src = fs.readFileSync(path.join(scriptsDir, 'start-server-production.ps1'), 'utf8');

test('the .sh caller rejects non-numeric PORT (parity with resolvePort)', () => {
  assert.match(
    shSrc,
    /case "\$PORT" in[\s\S]*\*\[!0-9\]\*\)\s*PORT=3847/,
    'the .sh must degrade a non-numeric PORT to 3847 — otherwise it hands "abc" ' +
      'to the swapper, which resolves it to 3847 and deploys on a different port ' +
      'than the caller polls.',
  );
});

test('the .sh caller rejects >5-digit and zero PORT (parity with resolvePort)', () => {
  assert.match(
    shSrc,
    /\$\{#PORT\}"?\s*-gt 5[\s\S]*-le 0[\s\S]*PORT=3847/,
    'the .sh must degrade PORT=999999 and PORT=0 to 3847, exactly like the swapper',
  );
});

test('the .ps1 caller rejects PORT=0 (its regex alone would accept it)', () => {
  assert.match(
    ps1Src,
    /\$env:PORT -match '\^\\d\{1,5\}\$' -and \[int\]\$env:PORT -gt 0/,
    'the ^\\d{1,5}$ regex matches "0"; without the -gt 0 check the caller would ' +
      'poll port 0 while the swapper deploys on 3847',
  );
});
