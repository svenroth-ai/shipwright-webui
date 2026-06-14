/**
 * repair-claude-json.mjs — deploy-time self-heal for a corrupt ~/.claude.json.
 *
 * WHY: the production deploy (start-server-production.ps1) force-kills the webui
 * server, which kills every embedded-terminal `claude` process at once. On
 * reload many `claude` CLIs start simultaneously and race on ~/.claude.json,
 * which the CLI writes NON-atomically and WITHOUT a lock. The losing write can
 * leave a valid, SHORTER object followed by the leftover tail of an older,
 * LONGER version (a "truncation tail") — every running `claude` then fails with
 *   JSON.parse: "Unexpected non-whitespace character after JSON at position N".
 *
 * webui is a read-only observer of ~/.claude/ and never writes this file (that
 * is the upstream CLI's bug to fix). But the deploy can heal the file once,
 * up-front, before the embedded sessions restart — that is all this script does.
 *
 * Best effort: the deploy NEVER gates on this script's exit code. Server/build
 * do not depend on ~/.claude.json.
 *
 * Run (CLI): node scripts/repair-claude-json.mjs · Test: node --test <this>.test.mjs
 * Scan delimiters use char codes (not \u escapes) on purpose — literal
 * backslash/brace escapes in source have bitten this repo before.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CH_OPEN = 0x7b; // {
const CH_CLOSE = 0x7d; // }
const CH_QUOTE = 0x22; // "
const CH_BACKSLASH = 0x5c; // (reverse solidus)

const MIN_TOP_LEVEL_KEYS = 3;
const DEFAULT_BACKUPS_KEPT = 10;

const PREFIX = '[repair-claude-json]';
const log = (msg) => process.stdout.write(`${PREFIX} ${msg}\n`);
const warn = (msg) => process.stderr.write(`${PREFIX} WARN: ${msg}\n`);

/**
 * String/escape-aware scan for the first balanced top-level `{...}` object.
 * Braces and quotes inside JSON string values (incl. escaped quotes) are
 * ignored. Returns `{ prefix, tail }` or `null` when no balanced object exists.
 *
 * @param {string} text
 * @returns {{ prefix: string, tail: string } | null}
 */
export function findFirstBalancedObject(text) {
  if (typeof text !== 'string') return null;
  const start = text.indexOf(String.fromCharCode(CH_OPEN));
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (escaped) escaped = false;
      else if (c === CH_BACKSLASH) escaped = true;
      else if (c === CH_QUOTE) inString = false;
      continue;
    }
    if (c === CH_QUOTE) {
      inString = true;
    } else if (c === CH_OPEN) {
      depth++;
    } else if (c === CH_CLOSE) {
      depth--;
      if (depth === 0) {
        return { prefix: text.slice(start, i + 1), tail: text.slice(i + 1) };
      }
    }
  }
  return null; // never returned to depth 0 — unbalanced
}

/**
 * Sanity guard: a repaired candidate is only trusted to overwrite the live file
 * when it parses AND looks like a real claude config (object, >= 3 top-level
 * keys, and carries "projects"). Stops us from clobbering the file with a tiny
 * coincidental `{...}` that happened to be balanced.
 *
 * @param {unknown} obj
 * @returns {boolean}
 */
export function isPlausibleClaudeConfig(obj) {
  return (
    obj != null &&
    typeof obj === 'object' &&
    !Array.isArray(obj) &&
    Object.keys(obj).length >= MIN_TOP_LEVEL_KEYS &&
    Object.prototype.hasOwnProperty.call(obj, 'projects')
  );
}

/**
 * Classify + (logically) repair raw text. Pure: no I/O.
 *
 * @param {string|null|undefined} text
 * @returns {{ status: 'valid'|'empty'|'repaired'|'unrepairable',
 *             repaired?: string, discardedTail?: string, reason?: string }}
 */
export function repairJsonText(text) {
  if (text == null || text.trim().length === 0) return { status: 'empty' };
  try {
    JSON.parse(text);
    return { status: 'valid' };
  } catch {
    /* fall through to repair */
  }
  const found = findFirstBalancedObject(text);
  if (!found) return { status: 'unrepairable', reason: 'no_balanced_object' };

  let candidate;
  try {
    candidate = JSON.parse(found.prefix);
  } catch {
    return { status: 'unrepairable', reason: 'prefix_not_valid_json' };
  }
  if (!isPlausibleClaudeConfig(candidate)) {
    return { status: 'unrepairable', reason: 'implausible_structure' };
  }
  // Fail-safe ambiguity guard. A real truncation tail is a FRAGMENT (begins
  // mid-value) — it never starts a second complete config, and inner braces in
  // a fragment (`"tipsHistory":{...}`) are not plausible configs (no top-level
  // "projects"). But IF the tail itself begins another plausible config we have
  // two candidates and cannot know which is live — refuse rather than risk
  // overwriting the good config with the wrong one. (Overwriting a global
  // config must fail safe even though the diagnosed corruption never does this.)
  const tailObj = findFirstBalancedObject(found.tail);
  if (tailObj) {
    let tailCandidate;
    try {
      tailCandidate = JSON.parse(tailObj.prefix);
    } catch {
      tailCandidate = undefined;
    }
    if (isPlausibleClaudeConfig(tailCandidate)) {
      return { status: 'unrepairable', reason: 'multiple_candidates' };
    }
  }
  return { status: 'repaired', repaired: found.prefix, discardedTail: found.tail };
}

/**
 * Windows-safe filename timestamp (no `:` / `.`). FIXED-WIDTH by construction
 * (`toISOString()` is always `YYYY-MM-DDTHH-MM-SS-sssZ`), so lexicographic sort
 * === chronological — load-bearing for pruneBackups. A format-pinning test
 * guards against a future variable-width change (e.g. epoch millis) that would
 * silently mis-sort and prune the WRONG backups.
 */
export function backupTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * Delete all but the newest `keep` `<base>.corrupt-<ts>.bak` files in `dir`.
 * Best effort — unlink failures are swallowed. Returns the deleted names.
 *
 * @param {string} dir
 * @param {string} base       // e.g. ".claude.json"
 * @param {number} keep
 * @param {string} [exceptName] // a backup name to always keep (e.g. the one
 *                              // just created this run — protects it from a
 *                              // CONCURRENT run's prune deleting it).
 * @returns {string[]}
 */
export function pruneBackups(dir, base, keep = DEFAULT_BACKUPS_KEPT, exceptName) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const head = `${base}.corrupt-`;
  const baks = entries
    .filter((n) => n.startsWith(head) && n.endsWith('.bak') && n !== exceptName)
    .sort(); // ISO timestamp → lexicographic === chronological
  const excess = baks.slice(0, Math.max(0, baks.length - keep));
  for (const name of excess) {
    try {
      fs.unlinkSync(path.join(dir, name));
    } catch {
      /* best effort */
    }
  }
  return excess;
}

/**
 * Repair the file at `targetPath` in place (with backup + atomic write).
 * The target path is the SOLE I/O boundary — pass a temp path to test it.
 *
 * @param {string} targetPath
 * @param {{ keep?: number }} [options]
 * @returns {{ action: string, status: string, reason?: string,
 *             backupPath?: string, discardedBytes?: number, message?: string }}
 */
export function repairFile(targetPath, options = {}) {
  const keep = options.keep ?? DEFAULT_BACKUPS_KEPT;
  if (!fs.existsSync(targetPath)) {
    return { action: 'noop', status: 'absent' };
  }

  let raw;
  try {
    raw = fs.readFileSync(targetPath, 'utf8');
  } catch (err) {
    return { action: 'error', status: 'read_failed', message: String(err && err.message) };
  }

  const result = repairJsonText(raw);
  if (result.status === 'valid') return { action: 'noop', status: 'valid' };
  if (result.status === 'empty') return { action: 'noop', status: 'empty' };
  if (result.status === 'unrepairable') {
    return { action: 'skip', status: 'unrepairable', reason: result.reason };
  }

  const dir = path.dirname(targetPath);
  const base = path.basename(targetPath);
  const backupPath = path.join(dir, `${base}.corrupt-${backupTimestamp()}.bak`);
  const tmpPath = path.join(dir, `${base}.tmp-${process.pid}`);
  try {
    fs.copyFileSync(targetPath, backupPath); // preserve the corrupt original bytes
    fs.writeFileSync(tmpPath, result.repaired);
    fs.renameSync(tmpPath, targetPath); // atomic on same volume
  } catch (err) {
    // The original file is untouched, so the backup we just made is a redundant
    // copy of the still-corrupt file — clean both up so a failed repair (e.g. a
    // reader holding the file open on Windows) never litters the homedir with
    // an orphan temp + un-pruned backup.
    for (const p of [tmpPath, backupPath]) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* best effort */
      }
    }
    return { action: 'error', status: 'write_failed', message: String(err && err.message) };
  }
  pruneBackups(dir, base, keep, path.basename(backupPath));
  return {
    action: 'repaired',
    status: 'repaired',
    backupPath,
    discardedBytes: Buffer.byteLength(result.discardedTail, 'utf8'),
  };
}

/**
 * CLI entry point. Returns a process exit code (0 = healthy/healed/benign,
 * 1 = corrupt-but-not-safely-repairable or an I/O error). The deploy must NOT
 * gate on this code.
 *
 * @returns {number}
 */
export function main() {
  const targetPath = path.join(os.homedir(), '.claude.json');
  const res = repairFile(targetPath);
  switch (res.status) {
    case 'absent':
      log('~/.claude.json not found — nothing to repair.');
      return 0;
    case 'valid':
      log('~/.claude.json is valid — no repair needed.');
      return 0;
    case 'empty':
      log('~/.claude.json is empty — leaving it for the CLI to recreate.');
      return 0;
    case 'repaired':
      log(
        `Repaired ~/.claude.json (discarded ${res.discardedBytes} trailing byte(s)). ` +
          `Backup: ${path.basename(res.backupPath)}`,
      );
      return 0;
    case 'unrepairable':
      warn(
        `~/.claude.json is corrupt and could NOT be safely repaired (${res.reason}). ` +
          'Left untouched — the Claude CLI may recreate it, or restore a backup manually.',
      );
      return 1;
    default:
      warn(`${res.status}: ${res.message ?? 'unknown error'}. ~/.claude.json left untouched.`);
      return 1;
  }
}

// Run only when invoked directly (not when imported by the test).
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
