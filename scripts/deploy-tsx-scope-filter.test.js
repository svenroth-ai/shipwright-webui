/**
 * Tests for filterTsxEntriesByRepo() — the repo-SCOPING half of the
 * tsx-watch kill-sweep fix (iterate-2026-09-09-deploy-tsx-kill-scope).
 *
 * Split out of deploy-tsx-scope.test.js (which covers the parse-only
 * helpers, parseWindowsTsxEntries()/parsePosixTsxEntries()) to keep both
 * files under the 300-line convention.
 *
 * The fix: a tsx-watch process's command line always embeds the ABSOLUTE,
 * checkout-specific `node_modules/.../tsx/...` resolution path — npm never
 * invokes a bare relative `tsx`, it resolves through the repo-local
 * node_modules/.bin — so scoping the match to that path correctly narrows it
 * to THIS repo/worktree's own server, and no other. Verified empirically
 * against two live worktree dev servers before writing this fixture. See
 * filterTsxEntriesByRepo()'s own doc block in deploy-tsx-scope.js for the
 * full history of what each external-review round narrowed and why, plus
 * the documented, standing-rebutted residual limitations.
 *
 * Run: node --test scripts/deploy-tsx-scope-filter.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseWindowsTsxEntries, filterTsxEntriesByRepo } = require('./deploy-tsx-scope');

const REPO_A = 'C:\\01_Development\\shipwright-webui\\.worktrees\\repo-a\\server';
const REPO_B = 'C:\\01_Development\\shipwright-webui\\.worktrees\\repo-b\\server';

const WIN_TSX_JSON_TWO_WORKTREES = JSON.stringify([
  {
    ProcessId: 39264,
    ParentProcessId: 1000, // repo-a CLI supervisor — parented by the shell, not by another matched entry
    CommandLine:
      '"node"   "C:\\01_Development\\shipwright-webui\\.worktrees\\repo-a\\server\\node_modules\\.bin\\..\\tsx\\dist\\cli.mjs" watch --env-file-if-exists=../.env.local src/index.ts',
  },
  {
    ProcessId: 39236,
    ParentProcessId: 39264, // repo-a loader child — spawned BY the CLI supervisor above
    CommandLine:
      'C:\\node\\node.exe --require C:\\01_Development\\shipwright-webui\\.worktrees\\repo-a\\server\\node_modules\\tsx\\dist\\preflight.cjs --import file:///C:/01_Development/shipwright-webui/.worktrees/repo-a/server/node_modules/tsx/dist/loader.mjs --env-file-if-exists=../.env.local src/index.ts',
  },
  {
    ProcessId: 1268,
    ParentProcessId: 1000, // repo-b CLI supervisor
    CommandLine:
      '"node"   "C:\\01_Development\\shipwright-webui\\.worktrees\\repo-b\\server\\node_modules\\.bin\\..\\tsx\\dist\\cli.mjs" watch --env-file-if-exists=../.env.local src/index.ts',
  },
]);

test('filterTsxEntriesByRepo: keeps only PIDs whose command line resolves inside repoRoot (Windows)', () => {
  const entries = parseWindowsTsxEntries(WIN_TSX_JSON_TWO_WORKTREES);
  const pids = filterTsxEntriesByRepo(entries, REPO_A);
  assert.deepEqual(pids.sort(), ['39236', '39264']);
  assert.ok(!pids.includes('1268'), "a sibling worktree's tsx watch must never be a kill target");
});

test('filterTsxEntriesByRepo: orders the tsx CLI supervisor BEFORE its own loader child, regardless of raw discovery order', () => {
  // External review round 5 (openai): findTsxServerPids() can match BOTH
  // the CLI supervisor (39264) and its loader child (39236, ParentProcessId
  // 39264) — raw discovery order is not guaranteed to put the supervisor
  // first, and stopOldServer() relies on parent-before-child to prevent a
  // respawn race. Feed the fixture in CHILD-then-PARENT order to prove the
  // function itself corrects it, not merely preserves an already-sorted input.
  const entries = parseWindowsTsxEntries(WIN_TSX_JSON_TWO_WORKTREES);
  const childFirst = [...entries].reverse();
  assert.deepEqual(
    filterTsxEntriesByRepo(childFirst, REPO_A),
    ['39264', '39236'],
    'the supervisor (no matched parent) must be killed before its loader child (matched parent 39264)',
  );
});

test('filterTsxEntriesByRepo: a different repoRoot selects the OTHER worktree only', () => {
  const entries = parseWindowsTsxEntries(WIN_TSX_JSON_TWO_WORKTREES);
  const pids = filterTsxEntriesByRepo(entries, REPO_B);
  assert.deepEqual(pids, ['1268']);
});

test('filterTsxEntriesByRepo: is separator-insensitive (mixed \\ vs /) on every platform', () => {
  const entries = [
    {
      pid: '1',
      commandLine:
        'node C:/01_Development/shipwright-webui/.worktrees/repo-a/server/node_modules/tsx/dist/cli.mjs watch src/index.ts',
    },
  ];
  assert.deepEqual(filterTsxEntriesByRepo(entries, REPO_A), ['1']);
});

test('filterTsxEntriesByRepo: is drive-letter-case-insensitive on Windows only (external review: unconditional folding would cross-match differently-cased POSIX checkouts)', { skip: process.platform !== 'win32' }, () => {
  const entries = [
    {
      pid: '1',
      commandLine:
        'node c:/01_development/shipwright-webui/.worktrees/repo-a/server/node_modules/tsx/dist/cli.mjs watch src/index.ts',
    },
  ];
  assert.deepEqual(filterTsxEntriesByRepo(entries, REPO_A), ['1']);
});

test('filterTsxEntriesByRepo: FOLDS case on win32, on every host (override-based, mirrors the POSIX override test)', () => {
  // GLM external review (round 6): the only win32 case-fold coverage was
  // gated `{ skip: process.platform !== 'win32' }`, so a regression to the
  // fold path itself would pass on a POSIX CI runner. Override
  // process.platform the same way the POSIX test does, so this runs (and
  // can actually fail) on every host, not just Windows.
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  try {
    const entries = [
      {
        pid: '1',
        commandLine:
          'node c:/01_development/shipwright-webui/.worktrees/repo-a/server/node_modules/tsx/dist/cli.mjs watch src/index.ts',
      },
    ];
    assert.deepEqual(filterTsxEntriesByRepo(entries, REPO_A), ['1']);
  } finally {
    Object.defineProperty(process, 'platform', original);
  }
});

test('filterTsxEntriesByRepo: PRESERVES case on POSIX — two differently-cased checkouts never cross-match', () => {
  // GLM external review (round 4): the win32-only case-fold path was only
  // ever exercised ON Windows, so a regression reintroducing unconditional
  // folding would pass CI on a POSIX runner — the one platform where it
  // matters (real case-sensitive filesystems). process.platform is
  // overridden directly rather than gated by the CURRENT host, so this
  // assertion actually runs and actually fails on a regression, on every host.
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  try {
    const repoUpper = '/home/dev/Worktrees/App/server';
    const repoLower = '/home/dev/Worktrees/app/server';
    const entries = [
      {
        pid: '1',
        commandLine: `node ${repoLower}/node_modules/tsx/dist/cli.mjs watch src/index.ts`,
      },
    ];
    assert.deepEqual(
      filterTsxEntriesByRepo(entries, repoUpper),
      [],
      'a different-case sibling checkout must never be treated as the same repo on POSIX',
    );
    assert.deepEqual(filterTsxEntriesByRepo(entries, repoLower), ['1'], 'the exact-case match still works');
  } finally {
    Object.defineProperty(process, 'platform', original);
  }
});

test('filterTsxEntriesByRepo: a sibling checkout whose name EXTENDS repoRoot is never matched (path-boundary anchor)', () => {
  // code-reviewer finding (medium): an unanchored substring match on
  // repoRoot='C:\...\server' would also match 'C:\...\server-old\...' — a
  // DIFFERENT checkout, e.g. a manual backup directory. This is the exact
  // over-broad-kill class the fix exists to close, so the needle is anchored
  // at a path boundary (a trailing separator) instead of a bare substring.
  const entries = [
    {
      pid: '555',
      commandLine: 'node C:\\...\\repo-a\\server-old\\node_modules\\tsx\\dist\\cli.mjs watch src/index.ts',
    },
  ];
  assert.deepEqual(filterTsxEntriesByRepo(entries, REPO_A), []);
});

test('filterTsxEntriesByRepo: an unrelated project on the same machine is never matched', () => {
  const entries = [
    {
      pid: '999',
      commandLine: 'node C:\\Projects\\some-other-app\\node_modules\\tsx\\dist\\cli.mjs watch src/index.ts',
    },
  ];
  assert.deepEqual(filterTsxEntriesByRepo(entries, REPO_A), []);
});

test('filterTsxEntriesByRepo: an unrelated repo whose OWN tsx merely REFERENCES repoRoot via an incidental argument is never matched', () => {
  // External review round 2 (openai/glm): a bare `<repoRoot>/node_modules/`
  // needle still matched an unrelated tsx watch process that merely takes a
  // --require/--tsconfig argument pointing INTO this repo's node_modules,
  // without that process's own tsx resolving from here at all. Requiring a
  // literal `tsx/` path segment after `node_modules/` closes this: this
  // process's OWN tsx resolves from repo-b, and the repoRoot-referencing
  // argument never reaches a `tsx/` segment.
  const entries = [
    {
      pid: '4242',
      commandLine:
        'node C:\\01_Development\\shipwright-webui\\.worktrees\\repo-b\\server\\node_modules\\tsx\\dist\\cli.mjs ' +
        '--require C:\\01_Development\\shipwright-webui\\.worktrees\\repo-a\\server\\node_modules\\dotenv\\config ' +
        'watch src/index.ts',
    },
  ];
  assert.deepEqual(filterTsxEntriesByRepo(entries, REPO_A), []);
  assert.deepEqual(filterTsxEntriesByRepo(entries, REPO_B), ['4242']);
});

test('filterTsxEntriesByRepo: dedupes repeated PIDs (watch parent + loader child, same repo)', () => {
  const cmd = 'node C:\\...\\repo-a\\server\\node_modules\\.bin\\..\\tsx\\dist\\cli.mjs watch src/index.ts';
  const entries = [
    { pid: '39264', commandLine: cmd },
    { pid: '39264', commandLine: cmd },
  ];
  assert.deepEqual(filterTsxEntriesByRepo(entries, 'C:\\...\\repo-a\\server'), ['39264']);
});

test('filterTsxEntriesByRepo: an empty/missing repoRoot matches nothing (fail closed, never machine-wide)', () => {
  const entries = parseWindowsTsxEntries(WIN_TSX_JSON_TWO_WORKTREES);
  assert.deepEqual(filterTsxEntriesByRepo(entries, ''), []);
  assert.deepEqual(filterTsxEntriesByRepo(entries, undefined), []);
});
