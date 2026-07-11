/**
 * Tests for computeKillTargets — the port-selection helper used by
 * dev-restart.js. Pure function, no I/O, cross-platform.
 *
 * Run: node --test webui/scripts/kill-targets.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  computeKillTargets,
  parseWindowsListenerPids,
  buildLsofCommand,
} = require('./kill-targets');

test('defaults: both ports at their defaults', () => {
  const ports = computeKillTargets({}, 'linux');
  assert.deepEqual([...ports].sort((a, b) => a - b), [3847, 5173]);
});

test('PORT override only', () => {
  const ports = computeKillTargets({ PORT: '3848' }, 'linux');
  assert.deepEqual([...ports].sort((a, b) => a - b), [3848, 5173]);
});

test('VITE_PORT override only', () => {
  const ports = computeKillTargets({ VITE_PORT: '5174' }, 'linux');
  assert.deepEqual([...ports].sort((a, b) => a - b), [3847, 5174]);
});

test('both overrides — kill scope is exactly the two configured ports', () => {
  const ports = computeKillTargets(
    { PORT: '3848', VITE_PORT: '5174' },
    'linux',
  );
  assert.deepEqual([...ports].sort((a, b) => a - b), [3848, 5174]);
  // Regression for M1: explicit 5177 must NOT sneak into the kill list.
  assert.ok(!ports.includes(5177), 'kill list must not contain stale 5177');
});

test('user explicitly sets VITE_PORT=5177 — kill target honors it', () => {
  // The point: we do not suppress 5177, we just stop HARDCODING it.
  const ports = computeKillTargets({ VITE_PORT: '5177' }, 'linux');
  assert.deepEqual([...ports].sort((a, b) => a - b), [3847, 5177]);
});

test('malformed env values are filtered out', () => {
  // NaN, empty, negative, zero — defaults must fill in.
  const cases = [
    { PORT: '' },
    { PORT: 'abc' },
    { PORT: '-1' },
    { PORT: '0' },
    { VITE_PORT: 'NaN' },
    { VITE_PORT: '-5' },
    { VITE_PORT: '0' },
  ];
  for (const env of cases) {
    const ports = computeKillTargets(env, 'linux');
    assert.ok(
      ports.length === 2 || ports.length === 1,
      `expected 1-2 ports for env=${JSON.stringify(env)}, got ${ports.join(',')}`,
    );
    assert.ok(
      ports.every((p) => Number.isFinite(p) && p > 0),
      `malformed port leaked for env=${JSON.stringify(env)}: ${ports.join(',')}`,
    );
  }
});

test('windows and posix produce the same kill-target list', () => {
  const envA = { PORT: '3848', VITE_PORT: '5174' };
  assert.deepEqual(
    computeKillTargets(envA, 'win32'),
    computeKillTargets(envA, 'linux'),
  );
  assert.deepEqual(
    computeKillTargets(envA, 'win32'),
    computeKillTargets(envA, 'darwin'),
  );
});

test('deduplicates when PORT equals VITE_PORT', () => {
  // Pathological but possible — user mis-configures both to the same port.
  const ports = computeKillTargets({ PORT: '5555', VITE_PORT: '5555' }, 'linux');
  assert.deepEqual(ports, [5555]);
});

test('no hardcoded 5177 appears for any default-or-custom env', () => {
  // The whole point of M1: 5177 is never in the kill list unless the
  // user explicitly sets PORT or VITE_PORT to 5177.
  const scenarios = [
    {},
    { PORT: '3847' },
    { VITE_PORT: '5173' },
    { PORT: '3848', VITE_PORT: '5174' },
    { PORT: '9000', VITE_PORT: '9001' },
  ];
  for (const env of scenarios) {
    const ports = computeKillTargets(env, 'linux');
    assert.ok(
      !ports.includes(5177),
      `5177 leaked into kill list for env=${JSON.stringify(env)}`,
    );
  }
});

// ---------------------------------------------------------------------------
// F16 (D11): dev-restart kill scope over-matches on Windows netstat output.
//
// The pre-fix findPidsOnPorts ran `netstat -ano -p TCP | findstr :<port>` and
// grabbed the trailing PID off every matching line. findstr does plain
// substring matching over the WHOLE line with NO state filter, so it caught:
//   1. ESTABLISHED browser sockets whose FOREIGN address ends :<port>
//      (the user's browser tab connected to Vite) -> taskkill killed the
//      browser tree.
//   2. Port-prefix collisions: ":5173" is a substring of ":51730", so an
//      unrelated listener on :51730 was killed too.
//
// The structural parser below requires state === LISTENING and an EXACT
// local-address port match. This is a producer(netstat)->consumer(parser)
// round-trip probe over a realistic fixture dump.
// ---------------------------------------------------------------------------

// A realistic `netstat -ano -p TCP` dump. Two real listeners we DO want to
// kill (Hono 3847 -> 4200, Vite 5173 -> 4300), plus three decoy rows that the
// old substring match wrongly caught.
const WINDOWS_NETSTAT_FIXTURE = [
  '',
  'Active Connections',
  '',
  '  Proto  Local Address          Foreign Address        State           PID',
  '  TCP    0.0.0.0:3847           0.0.0.0:0              LISTENING       4200',
  '  TCP    0.0.0.0:5173           0.0.0.0:0              LISTENING       4300',
  // Server-side ESTABLISHED socket on the real Vite port — same PID 4300,
  // harmless if picked up (it is the dev server itself).
  '  TCP    127.0.0.1:5173         127.0.0.1:52014        ESTABLISHED     4300',
  // DECOY 1 — the user's BROWSER tab connected to Vite. Local port is the
  // ephemeral 52014; :5173 only appears in the FOREIGN column. PID 9100 is
  // the browser. Must NOT be returned.
  '  TCP    127.0.0.1:52014        127.0.0.1:5173         ESTABLISHED     9100',
  // DECOY 2 — port-prefix collision: an unrelated listener on :51730 whose
  // text contains the substring ":5173". PID 7777. Must NOT be returned.
  '  TCP    127.0.0.1:51730        0.0.0.0:0              LISTENING       7777',
  // DECOY 3 — port-prefix collision on the Hono port: :38470 contains the
  // substring ":3847". PID 8888. Must NOT be returned.
  '  TCP    127.0.0.1:38470        0.0.0.0:0              LISTENING       8888',
  // DECOY 4 — a UDP listener on the exact Vite port. UDP rows have `*:*` for
  // the foreign address and NO state column (4 tokens). PID 6000. Must NOT be
  // returned (dev-restart kills TCP listeners only).
  '  UDP    0.0.0.0:5173           *:*                                   6000',
  // IPv6 form of the real Vite listener. Empirically, plain `netstat -ano`
  // labels IPv6 rows proto `TCP` (the `[::]` address is the only tell) — same
  // PID 4300, must parse cleanly and dedup.
  '  TCP    [::]:5173              [::]:0                 LISTENING       4300',
  // IPv6 real Hono listener under the `TCPv6` proto label some Windows builds
  // emit. Locks the startsWith('TCP') robustness — PID 4200, dedups.
  '  TCPv6  [::]:3847              [::]:0                 LISTENING       4200',
  '',
].join('\r\n');

test('parseWindowsListenerPids returns ONLY exact-match LISTENING PIDs', () => {
  const pids = parseWindowsListenerPids(WINDOWS_NETSTAT_FIXTURE, [3847, 5173]);
  const sorted = [...pids].map(String).sort();
  // Exactly the two real listeners. 4200 + 4300 each appear on multiple rows
  // (IPv4 + IPv6) but dedup.
  assert.deepEqual(sorted, ['4200', '4300']);
});

test('parseWindowsListenerPids catches IPv6 listeners (TCP + TCPv6 proto)', () => {
  // Regression for the -p TCP gap: IPv6 rows (`[::]`) must be discovered. The
  // proto label is `TCP` in plain `netstat -ano` but `startsWith('TCP')` also
  // covers the `TCPv6` label. Both IPv6 rows resolve to the real listener PIDs.
  const pids = parseWindowsListenerPids(WINDOWS_NETSTAT_FIXTURE, [3847, 5173]);
  const asStr = pids.map(String);
  assert.ok(asStr.includes('4200'), 'IPv6 [::]:3847 (TCPv6) listener PID missed');
  assert.ok(asStr.includes('4300'), 'IPv6 [::]:5173 (TCP) listener PID missed');
});

test('parseWindowsListenerPids ignores a UDP listener on the target port', () => {
  const pids = parseWindowsListenerPids(WINDOWS_NETSTAT_FIXTURE, [3847, 5173]);
  assert.ok(
    !pids.map(String).includes('6000'),
    'a UDP listener on the port must not be a TCP kill target',
  );
});

test('parseWindowsListenerPids ignores ESTABLISHED browser sockets', () => {
  // Regression for F16 bug class 1: the browser's PID (9100) reaches the
  // list only via the FOREIGN :5173 on an ESTABLISHED row.
  const pids = parseWindowsListenerPids(WINDOWS_NETSTAT_FIXTURE, [3847, 5173]);
  assert.ok(
    !pids.map(String).includes('9100'),
    'browser ESTABLISHED-socket PID must never be a kill target',
  );
});

test('parseWindowsListenerPids ignores port-prefix collisions (:51730, :38470)', () => {
  // Regression for F16 bug class 2: substring ":5173" ⊂ ":51730" and
  // ":3847" ⊂ ":38470". Exact port match must reject both.
  const pids = parseWindowsListenerPids(WINDOWS_NETSTAT_FIXTURE, [3847, 5173]);
  const asStr = pids.map(String);
  assert.ok(!asStr.includes('7777'), ':51730 listener must not be killed');
  assert.ok(!asStr.includes('8888'), ':38470 listener must not be killed');
});

test('parseWindowsListenerPids returns empty for a port with no listener', () => {
  const pids = parseWindowsListenerPids(WINDOWS_NETSTAT_FIXTURE, [9999]);
  assert.deepEqual([...pids], []);
});

test('parseWindowsListenerPids tolerates empty / malformed input', () => {
  assert.deepEqual([...parseWindowsListenerPids('', [5173])], []);
  assert.deepEqual([...parseWindowsListenerPids('garbage\nlines\n', [5173])], []);
  assert.deepEqual([...parseWindowsListenerPids(undefined, [5173])], []);
});

test('buildLsofCommand pins -sTCP:LISTEN and the exact port list', () => {
  const cmd = buildLsofCommand([5173, 3847]);
  // POSIX fix: without -sTCP:LISTEN, `lsof -ti tcp:5173,3847` returns every
  // socket (incl. ESTABLISHED browser connections) on those ports.
  assert.match(cmd, /-sTCP:LISTEN/);
  assert.match(cmd, /tcp:5173,3847/);
});

test('buildLsofCommand handles a single port', () => {
  const cmd = buildLsofCommand([3847]);
  assert.match(cmd, /-sTCP:LISTEN/);
  assert.match(cmd, /tcp:3847/);
});

test('buildLsofCommand coerces + drops non-integer ports (injection-proof)', () => {
  // Defense in depth: the command is run via a shell, so a hypothetical bad
  // value must never reach the command string. Only clean integers survive.
  const cmd = buildLsofCommand(['5173; rm -rf ~', 3847, NaN, -1, 0]);
  assert.equal(cmd, 'lsof -ti -sTCP:LISTEN tcp:3847');
  assert.doesNotMatch(cmd, /rm -rf/);
});

// ---------------------------------------------------------------------------
// dev-restart.js wiring guard. The parser + lsof builder are only useful if
// findPidsOnPorts actually calls them. findPidsOnPorts shells out to execSync
// (no clean unit seam), so — same convention as start-server-production.test.mjs
// / repair-claude-json.test.mjs — we assert the WIRING by reading the script
// text: the fixed helpers are imported and invoked, and the over-matching
// pre-fix invocations are gone.
// ---------------------------------------------------------------------------
const devRestartSrc = require('node:fs').readFileSync(
  require('node:path').join(__dirname, 'dev-restart.js'),
  'utf8',
);

test('dev-restart.js imports and uses the fixed kill helpers', () => {
  assert.match(devRestartSrc, /parseWindowsListenerPids/, 'must import the parser');
  assert.match(devRestartSrc, /buildLsofCommand/, 'must import the lsof builder');
  assert.match(
    devRestartSrc,
    /parseWindowsListenerPids\(out, ports\)/,
    'findPidsOnPorts must feed netstat output through the structural parser',
  );
  assert.match(
    devRestartSrc,
    /execSync\(buildLsofCommand\(ports\)/,
    'POSIX branch must run the state-filtered lsof command',
  );
});

test('dev-restart.js drops the pre-fix over-matching invocations', () => {
  // No `findstr` substring pre-filter (bug class 1+2) and no `-p TCP` (drops
  // IPv6 listeners) and no un-filtered `lsof -ti tcp:` (misses -sTCP:LISTEN).
  assert.doesNotMatch(devRestartSrc, /findstr/, 'findstr substring match must be gone');
  assert.doesNotMatch(devRestartSrc, /netstat -ano -p TCP/, '-p TCP drops IPv6 listeners');
  assert.doesNotMatch(
    devRestartSrc,
    /lsof -ti tcp:/,
    'un-state-filtered lsof (no -sTCP:LISTEN) must be gone',
  );
  assert.match(devRestartSrc, /netstat -ano/, 'must use plain netstat -ano');
});
