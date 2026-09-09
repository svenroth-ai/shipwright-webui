/**
 * Tests for the pure tsx-watch process-DISCOVERY helpers used by
 * deploy-procs.mjs's findTsxServerPids() (the production-deploy kill sweep).
 *
 * Bug (iterate-2026-09-09-deploy-tsx-kill-scope): findTsxServerPids() used to
 * match ANY `tsx watch ... src/index.ts` process machine-wide, because it
 * matched only generic markers with no repo-identifying input at all. A
 * production deploy from one worktree therefore also killed an UNRELATED
 * project's tsx dev server, and a PARALLEL webui worktree's dev server, even
 * though it listens on a different PORT. Not a regression — inherited
 * verbatim from the pre-fix inline sweep in #249 and flagged independently by
 * both the external LLM review and the internal code review at the time.
 *
 * This file covers parseWindowsTsxEntries()/parsePosixTsxEntries() — turning
 * raw OS process-listing output into {pid, ppid, commandLine} entries. The
 * REPO-SCOPING half (filterTsxEntriesByRepo(), including WHY the fix works
 * and its documented residual limitations) is covered in the sibling
 * deploy-tsx-scope-filter.test.js — split out to keep both files under the
 * 300-line convention.
 *
 * Run: node --test scripts/deploy-tsx-scope.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseWindowsTsxEntries, parsePosixTsxEntries } = require('./deploy-tsx-scope');

test('parseWindowsTsxEntries: parses a multi-row ConvertTo-Json array', () => {
  const rows = JSON.stringify([
    { ProcessId: 39264, ParentProcessId: 1000, CommandLine: 'node tsx watch src/index.ts' },
    { ProcessId: 39236, ParentProcessId: 39264, CommandLine: 'node tsx --import loader.mjs src/index.ts' },
    { ProcessId: 1268, ParentProcessId: 1000, CommandLine: 'node tsx watch src/index.ts' },
  ]);
  const entries = parseWindowsTsxEntries(rows);
  assert.deepEqual(
    entries.map((e) => e.pid).sort(),
    ['1268', '39236', '39264'],
  );
  assert.ok(entries.every((e) => typeof e.commandLine === 'string' && e.commandLine.length > 0));
});

test('parseWindowsTsxEntries: strips a leading UTF-8 BOM before parsing (PowerShell 5.1 redirected UTF-8 output)', () => {
  const bom = String.fromCharCode(0xfeff);
  const single = bom + JSON.stringify({ ProcessId: 42, CommandLine: 'node tsx watch src/index.ts' });
  assert.deepEqual(parseWindowsTsxEntries(single), [{ pid: '42', ppid: '', commandLine: 'node tsx watch src/index.ts' }]);
});

test('parseWindowsTsxEntries: ConvertTo-Json collapses a single match to a bare object, not an array', () => {
  const single = JSON.stringify({ ProcessId: 42, CommandLine: 'node tsx watch src/index.ts' });
  const entries = parseWindowsTsxEntries(single);
  assert.deepEqual(entries, [{ pid: '42', ppid: '', commandLine: 'node tsx watch src/index.ts' }]);
});

test('parseWindowsTsxEntries: applies the tsx + src/index.ts marker filter itself (a non-matching row is dropped)', () => {
  const rows = JSON.stringify([
    { ProcessId: 1, CommandLine: 'node tsx watch src/index.ts' },
    { ProcessId: 2, CommandLine: 'node some-other-tool.js' },
  ]);
  assert.deepEqual(parseWindowsTsxEntries(rows), [{ pid: '1', ppid: '', commandLine: 'node tsx watch src/index.ts' }]);
});

test('parseWindowsTsxEntries: a null CommandLine (Get-CimInstance returns it for an inaccessible command line) is handled, not thrown', () => {
  const rows = JSON.stringify([{ ProcessId: 3, CommandLine: null }]);
  assert.deepEqual(parseWindowsTsxEntries(rows), []);
});

test('parseWindowsTsxEntries: tolerates empty / malformed JSON', () => {
  assert.deepEqual(parseWindowsTsxEntries(''), []);
  assert.deepEqual(parseWindowsTsxEntries('   '), []);
  assert.deepEqual(parseWindowsTsxEntries(undefined), []);
  assert.deepEqual(parseWindowsTsxEntries('not json'), []);
});

// Realistic `ps -A -o pid=,ppid=,args=` dump: UNFILTERED (every process on
// the machine), unlike the pre-fix `pgrep -f` which pre-filtered server-side.
// Includes two real tsx-watch candidates (one per worktree) plus decoys that
// must never survive parsePosixTsxEntries' own tsx + src/index.ts match.
const POSIX_PS_ALL_PROCESSES = [
  '    1    0 /sbin/init',
  '  555    1 /usr/bin/some-other-daemon --flag',
  '39264 1000 node /home/dev/shipwright-webui/.worktrees/repo-a/server/node_modules/tsx/dist/cli.mjs watch --env-file-if-exists=../.env.local src/index.ts',
  ' 1268 1000 node /home/dev/shipwright-webui/.worktrees/repo-b/server/node_modules/tsx/dist/cli.mjs watch --env-file-if-exists=../.env.local src/index.ts',
  // DECOY — a vite dev server. Contains neither marker; must not survive.
  ' 7777 1000 node /home/dev/shipwright-webui/.worktrees/repo-a/client/node_modules/.bin/vite',
  // DECOY — some unrelated tsx-adjacent tool that isn't the watch server
  // (has 'tsx' but not the entry path); must not survive.
  ' 8888 1000 node /usr/local/bin/tsx-something-else --version',
].join('\n');

test('parsePosixTsxEntries: parses "<pid> <ppid> <full command line>" rows from unfiltered ps -A output', () => {
  const entries = parsePosixTsxEntries(POSIX_PS_ALL_PROCESSES);
  assert.deepEqual(entries.map((e) => e.pid).sort(), ['1268', '39264']);
  assert.ok(entries[0].commandLine.includes('tsx/dist/cli.mjs'));
  assert.ok(entries.every((e) => e.ppid === '1000'));
});

test('parsePosixTsxEntries: filters out non-tsx-watch-server processes itself (ps -A is unfiltered)', () => {
  // Portability regression guard: this repo used to shell out to
  // `pgrep -af 'tsx.*src/index\.ts'`, which pre-filtered server-side on
  // Linux — but pgrep's `-a` flag means "include ancestors" on macOS/BSD,
  // not "print the full command line", so every entry's commandLine came
  // back empty there and the whole sweep silently matched nothing. Now that
  // discovery is the unfiltered, portable `ps -A -o pid=,ppid=,args=`, the
  // tsx + src/index.ts match has to happen here in JS instead — this pins that.
  const entries = parsePosixTsxEntries(POSIX_PS_ALL_PROCESSES);
  const pids = entries.map((e) => e.pid);
  assert.ok(!pids.includes('1'), 'init must not survive the tsx match');
  assert.ok(!pids.includes('555'), 'an unrelated daemon must not survive the tsx match');
  assert.ok(!pids.includes('7777'), 'a vite dev server must not survive the tsx match');
  assert.ok(!pids.includes('8888'), 'a tsx-named-but-not-watch-server process must not survive');
});

test('parsePosixTsxEntries: tolerates empty / malformed output', () => {
  assert.deepEqual(parsePosixTsxEntries(''), []);
  assert.deepEqual(parsePosixTsxEntries('   \n  \n'), []);
  assert.deepEqual(parsePosixTsxEntries(undefined), []);
});
