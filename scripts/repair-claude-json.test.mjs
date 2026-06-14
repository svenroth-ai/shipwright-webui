/**
 * Tests for repair-claude-json.mjs — pure brace-scan/repair functions + the
 * file-side repairFile path (temp dir, never the real homedir). Standalone
 * node:test convention (cf. kill-targets.test.js).
 * Run: node --test scripts/repair-claude-json.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  findFirstBalancedObject,
  isPlausibleClaudeConfig,
  repairJsonText,
  repairFile,
  pruneBackups,
  backupTimestamp,
  main,
} from './repair-claude-json.mjs';

// --- fixtures --------------------------------------------------------------

const validShort = JSON.stringify({
  numStartups: 42,
  installMethod: 'unknown',
  autoUpdates: true,
  projects: { '/home/u/proj': { allowedTools: [], history: [] } },
});

// Real signature: a valid SHORTER object, then the leftover tail of an older,
// LONGER version (bytes beyond the new write length were never truncated). The
// tail is a FRAGMENT (begins mid-value), never a second complete object.
const truncationTail =
  '   "lastUsedNumStartups": 98, "staleKey": "leftover-from-older-longer-version" }';
const corrupt = validShort + truncationTail;

// --- pure: repairJsonText --------------------------------------------------

test('repairJsonText: valid JSON → no-op (status valid)', () => {
  const r = repairJsonText(validShort);
  assert.equal(r.status, 'valid');
});

test('repairJsonText: truncation-tail → repaired, only the tail discarded', () => {
  const r = repairJsonText(corrupt);
  assert.equal(r.status, 'repaired');
  // prefix is byte-identical to the valid short object — nothing reformatted.
  assert.equal(r.repaired, validShort);
  assert.equal(r.discardedTail, truncationTail);
  // the repaired candidate re-parses clean.
  assert.doesNotThrow(() => JSON.parse(r.repaired));
});

test('repairJsonText: garbage with no brace → unrepairable', () => {
  const r = repairJsonText('not json at all, no braces here');
  assert.equal(r.status, 'unrepairable');
});

test('repairJsonText: unbalanced (never closes) → unrepairable', () => {
  const r = repairJsonText('{"unclosed": "value", "projects": {');
  assert.equal(r.status, 'unrepairable');
});

test('repairJsonText: empty / whitespace-only → empty (no overwrite)', () => {
  assert.equal(repairJsonText('').status, 'empty');
  assert.equal(repairJsonText('   \n\t  ').status, 'empty');
});

test('repairJsonText: implausible structure (parses, <3 keys, no projects) → unrepairable', () => {
  // whole string invalid; first balanced object parses but is not a plausible
  // claude config → MUST NOT overwrite.
  const r = repairJsonText('{"a":1} trailing-junk');
  assert.equal(r.status, 'unrepairable');
});

test('repairJsonText: 3+ keys but no "projects" → unrepairable', () => {
  const r = repairJsonText('{"a":1,"b":2,"c":3} junk');
  assert.equal(r.status, 'unrepairable');
});

test('repairJsonText: TWO complete plausible configs → unrepairable (multiple_candidates)', () => {
  // Data-loss vector: never silently pick the first of two plausible configs.
  const small = JSON.stringify({ projects: {}, x: 1, y: 2 });
  const big = JSON.stringify({ projects: { '/a': 1, '/b': 2 }, x: 1, y: 2, z: 3 });
  const r = repairJsonText(small + big);
  assert.equal(r.status, 'unrepairable');
  assert.equal(r.reason, 'multiple_candidates');
});

test('repairJsonText: truncation tail with inner balanced braces (not a config) → still repaired', () => {
  // Tail fragments routinely contain non-config balanced sub-objects (no
  // "projects") — the ambiguity guard must NOT refuse these.
  const tail = '   "lastUsedNumStartups": 98, "tipsHistory": {"a":1,"b":2,"c":3} }';
  const r = repairJsonText(validShort + tail);
  assert.equal(r.status, 'repaired');
  assert.equal(r.repaired, validShort);
});

test('repairJsonText: unterminated string at EOF → unrepairable', () => {
  const r = repairJsonText('{"a":1,"b":2,"projects":{"p":"unterminated value...');
  assert.equal(r.status, 'unrepairable');
});

// --- pure: findFirstBalancedObject (string/escape awareness) ---------------

test('findFirstBalancedObject: braces inside a string value are ignored', () => {
  const valid = '{"a":1,"b":2,"projects":{"p":"text with } and { braces"}}';
  const found = findFirstBalancedObject(valid + ' EXTRA');
  assert.equal(found.prefix, valid);
  assert.equal(found.tail, ' EXTRA');
});

test('findFirstBalancedObject: escaped quote before a brace does not end the string', () => {
  // JSON value contains a literal `"}"` — JSON.stringify escapes the quotes.
  const valid = JSON.stringify({ a: 1, b: 2, projects: { msg: 'he said "}" ok' } });
  const found = findFirstBalancedObject(valid + ' TAIL');
  assert.equal(found.prefix, valid);
  assert.doesNotThrow(() => JSON.parse(found.prefix));
});

test('findFirstBalancedObject: no opening brace → null', () => {
  assert.equal(findFirstBalancedObject('no braces'), null);
});

// --- pure: isPlausibleClaudeConfig -----------------------------------------

test('isPlausibleClaudeConfig: only ≥3 keys AND a "projects" key (object) passes', () => {
  assert.equal(isPlausibleClaudeConfig({ a: 1, b: 2, projects: {} }), true);
  assert.equal(isPlausibleClaudeConfig({ projects: {}, a: 1 }), false); // <3 keys
  assert.equal(isPlausibleClaudeConfig({ a: 1, b: 2, c: 3 }), false); // no projects
  assert.equal(isPlausibleClaudeConfig([1, 2, 3]), false);
  assert.equal(isPlausibleClaudeConfig(null), false);
});

// --- file side: repairFile (temp dir) --------------------------------------

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-claude-json-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function listBackups(dir) {
  return fs
    .readdirSync(dir)
    .filter((n) => n.startsWith('.claude.json.corrupt-') && n.endsWith('.bak'));
}

test('repairFile: absent file → noop, nothing created', () => {
  withTempDir((dir) => {
    const target = path.join(dir, '.claude.json');
    const res = repairFile(target);
    assert.equal(res.status, 'absent');
    assert.equal(fs.existsSync(target), false);
    assert.equal(listBackups(dir).length, 0);
  });
});

test('repairFile: valid file → noop, no backup, unchanged', () => {
  withTempDir((dir) => {
    const target = path.join(dir, '.claude.json');
    fs.writeFileSync(target, validShort);
    const res = repairFile(target);
    assert.equal(res.status, 'valid');
    assert.equal(fs.readFileSync(target, 'utf8'), validShort);
    assert.equal(listBackups(dir).length, 0);
  });
});

test('repairFile: truncation-tail file → repaired, round-trips, backup keeps original', () => {
  withTempDir((dir) => {
    const target = path.join(dir, '.claude.json');
    fs.writeFileSync(target, corrupt);
    const res = repairFile(target);
    assert.equal(res.status, 'repaired');
    // target now holds the valid short object and re-parses clean.
    const after = fs.readFileSync(target, 'utf8');
    assert.equal(after, validShort);
    assert.doesNotThrow(() => JSON.parse(after));
    // exactly one backup, holding the ORIGINAL corrupt bytes.
    const baks = listBackups(dir);
    assert.equal(baks.length, 1);
    assert.equal(fs.readFileSync(path.join(dir, baks[0]), 'utf8'), corrupt);
    // no temp file left behind.
    assert.equal(fs.readdirSync(dir).some((n) => n.includes('.tmp-')), false);
  });
});

test('repairFile: unrepairable garbage → file unchanged, no backup', () => {
  withTempDir((dir) => {
    const target = path.join(dir, '.claude.json');
    const junk = 'totally broken, no object here';
    fs.writeFileSync(target, junk);
    const res = repairFile(target);
    assert.equal(res.status, 'unrepairable');
    assert.equal(fs.readFileSync(target, 'utf8'), junk);
    assert.equal(listBackups(dir).length, 0);
  });
});

test('repairFile: implausible balanced object → not overwritten, no backup', () => {
  withTempDir((dir) => {
    const target = path.join(dir, '.claude.json');
    const content = '{"a":1} leftover';
    fs.writeFileSync(target, content);
    const res = repairFile(target);
    assert.equal(res.status, 'unrepairable');
    assert.equal(fs.readFileSync(target, 'utf8'), content);
    assert.equal(listBackups(dir).length, 0);
  });
});

test('repairFile: empty file → noop, unchanged, no backup', () => {
  withTempDir((dir) => {
    const target = path.join(dir, '.claude.json');
    fs.writeFileSync(target, '');
    const res = repairFile(target);
    assert.equal(res.status, 'empty');
    assert.equal(fs.readFileSync(target, 'utf8'), '');
    assert.equal(listBackups(dir).length, 0);
  });
});

// --- file side: pruneBackups -----------------------------------------------

test('pruneBackups: keeps the newest 10, deletes older', () => {
  withTempDir((dir) => {
    const base = '.claude.json';
    // 13 backups, lexicographically ordered timestamps (ISO → chronological).
    for (let i = 0; i < 13; i++) {
      const ts = `2026-06-14T00-00-${String(i).padStart(2, '0')}-000Z`;
      fs.writeFileSync(path.join(dir, `${base}.corrupt-${ts}.bak`), `b${i}`);
    }
    pruneBackups(dir, base, 10);
    const remaining = listBackups(dir).sort();
    assert.equal(remaining.length, 10);
    // the three oldest (i=0,1,2) are gone; newest (i=12) survives.
    assert.equal(remaining.some((n) => n.includes('00-00-00')), false);
    assert.equal(remaining.some((n) => n.includes('00-00-02')), false);
    assert.equal(remaining.some((n) => n.includes('00-00-03')), true);
    assert.equal(remaining.some((n) => n.includes('00-00-12')), true);
  });
});

test('pruneBackups: never deletes the excepted (just-made) backup', () => {
  withTempDir((dir) => {
    const base = '.claude.json';
    for (let i = 0; i < 12; i++) {
      const ts = `2026-06-14T00-00-${String(i).padStart(2, '0')}-000Z`;
      fs.writeFileSync(path.join(dir, `${base}.corrupt-${ts}.bak`), `b${i}`);
    }
    // the OLDEST (i=0) is the one we "just made" — it must survive even though
    // it would otherwise be pruned (12 > keep=10).
    const mine = `${base}.corrupt-2026-06-14T00-00-00-000Z.bak`;
    pruneBackups(dir, base, 10, mine);
    assert.equal(fs.existsSync(path.join(dir, mine)), true);
  });
});

// --- backupTimestamp: fixed-width (load-bearing for prune sort) ------------

test('backupTimestamp: fixed-width, filename-safe (no : or .)', () => {
  const ts = backupTimestamp();
  assert.match(ts, /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/);
  assert.equal(ts.includes(':'), false);
  assert.equal(ts.includes('.'), false);
});

// --- main(): the AC-4 exit-code contract -----------------------------------

test('main: exit-code contract (0 healthy/healed/benign, 1 unrepairable)', () => {
  withTempDir((dir) => {
    const saved = { U: process.env.USERPROFILE, H: process.env.HOME };
    process.env.USERPROFILE = dir; // os.homedir() reads USERPROFILE on win32,
    process.env.HOME = dir; //        HOME on posix — set both for portability.
    try {
      const target = path.join(dir, '.claude.json');
      assert.equal(main(), 0, 'absent → 0');
      fs.writeFileSync(target, validShort);
      assert.equal(main(), 0, 'valid → 0');
      fs.writeFileSync(target, corrupt);
      assert.equal(main(), 0, 'repaired → 0');
      fs.writeFileSync(target, 'broken, no object');
      assert.equal(main(), 1, 'unrepairable → 1');
    } finally {
      if (saved.U === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = saved.U;
      if (saved.H === undefined) delete process.env.HOME;
      else process.env.HOME = saved.H;
    }
  });
});
