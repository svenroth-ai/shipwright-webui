/*
 * external/org/decisions-lock.ts — the FR-04.28 cross-process lock contract
 * + the decision-log transfer format (opaque, header-delimited blocks — see
 * the iterate spec's "Design decisions I own", point 3).
 *
 * Lock target is `decisions-proposed.md` ONLY (`<path>.lock`, proper-lockfile's
 * OWN default — neither side sets `lockfilePath`). It is the file both
 * processes (this route, leadwright's daemon) actually contend on;
 * `decision_log.md` has exactly one writer (this action), so serializing on
 * the proposed-side file makes the whole two-file read-modify-write atomic
 * with respect to the daemon (lead-model-spec.md §4.1a: "keine getrennten
 * Arbeitsbäume, deshalb genügt ein Dateilock" — one lock, singular, is
 * enough).
 *
 * Plan-review fix (both external reviewers, HIGH): this module resolves
 * BOTH file paths through the same allowlist + symlink defense as the
 * generic `/file` route rather than touching the filesystem directly —
 * `decisions-lock.ts` is a second, independent write path onto exactly the
 * files the allowlist protects, so it needs the same guard, not a weaker
 * one.
 */

import * as lockfile from "proper-lockfile";
import { existsSync, mkdirSync, writeFileSync, readFileSync, lstatSync } from "node:fs";
import { dirname } from "node:path";

import { resolveOrgAllowlistedTarget } from "./_helpers.js";

// ---------------------------------------------------------------------------
// Entry format — strict, anchored, full-line header shapes (plan-review
// fix, deepseek LOW: a loose "line starts with ##" match could misclassify
// an opaque body line as a boundary).
//
// Doubt-review fix (HIGH): `raw.split("\n")` leaves a trailing "\r" on each
// line when the source is CRLF-terminated, and `.` never matches "\r" (JS
// LineTerminator exclusion) — so a bare `(.+)$` could never reach `$` on a
// CRLF file and every header silently failed to match, making
// `nextLoggedNumber` always return 1 (duplicate ADR numbers). The trailing
// `\r?` tolerates that without touching `splitBlocks`' byte offsets (which
// must stay keyed to the ORIGINAL raw string — `toLoggedBlock`/countersign.ts
// splice on those offsets directly).
// ---------------------------------------------------------------------------

const PROPOSED_HEADER_RE = /^## \[([^\]]+)\] (.+?)\r?$/;
const LOGGED_HEADER_RE = /^## ADR-(\d{4}) \[([^\]]+)\] (.+?)\r?$/;

export interface ProposedEntry {
  timestamp: string;
  leadId: string;
  /** Full block text (header line + body), from this header up to the next
   *  header or EOF. Opaque — never parsed beyond the header line. */
  block: string;
  startIndex: number;
  endIndex: number;
}

export interface LoggedEntry {
  number: number;
  timestamp: string;
  leadId: string;
  block: string;
}

function splitBlocks(
  raw: string,
  headerRe: RegExp,
): Array<{ match: RegExpMatchArray; startIndex: number; endIndex: number; block: string }> {
  const lines = raw.split("\n");
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }

  const headerLineIdx: number[] = [];
  const matches: RegExpMatchArray[] = [];
  lines.forEach((line, idx) => {
    const m = headerRe.exec(line);
    if (m) {
      headerLineIdx.push(idx);
      matches.push(m);
    }
  });

  return headerLineIdx.map((lineIdx, i) => {
    const startIndex = lineStarts[lineIdx];
    const nextHeaderLineIdx = headerLineIdx[i + 1];
    const endIndex =
      nextHeaderLineIdx !== undefined ? lineStarts[nextHeaderLineIdx] : raw.length;
    return { match: matches[i], startIndex, endIndex, block: raw.slice(startIndex, endIndex) };
  });
}

/** Parse `decisions-proposed.md` into its opaque, header-delimited entries. */
export function parseProposedEntries(raw: string): ProposedEntry[] {
  return splitBlocks(raw, PROPOSED_HEADER_RE).map(({ match, startIndex, endIndex, block }) => ({
    timestamp: match[1],
    leadId: match[2],
    block,
    startIndex,
    endIndex,
  }));
}

/** Parse `decision_log.md` into its numbered, header-delimited entries. */
export function parseLoggedEntries(raw: string): LoggedEntry[] {
  return splitBlocks(raw, LOGGED_HEADER_RE).map(({ match, block }) => ({
    number: Number(match[1]),
    timestamp: match[2],
    leadId: match[3],
    block,
  }));
}

export function findLoggedEntry(
  entries: LoggedEntry[],
  timestamp: string,
  leadId: string,
): LoggedEntry | undefined {
  return entries.find((e) => e.timestamp === timestamp && e.leadId === leadId);
}

export function nextLoggedNumber(entries: LoggedEntry[]): number {
  if (entries.length === 0) return 1;
  return Math.max(...entries.map((e) => e.number)) + 1;
}

/**
 * Rewrite a proposed entry's block into logged form: same body, header line
 * becomes `## ADR-<NNNN> [<timestamp>] <leadId>`. Byte-preserving beyond the
 * header line — this route never parses or understands the body prose.
 */
export function toLoggedBlock(proposedBlock: string, number: number): string {
  const newlineIdx = proposedBlock.indexOf("\n");
  const headerLine = newlineIdx === -1 ? proposedBlock : proposedBlock.slice(0, newlineIdx);
  const rest = newlineIdx === -1 ? "" : proposedBlock.slice(newlineIdx);
  const m = PROPOSED_HEADER_RE.exec(headerLine);
  if (!m) {
    throw new Error(
      `toLoggedBlock: block does not start with a proposed-entry header: ${headerLine.slice(0, 80)}`,
    );
  }
  const adr = `ADR-${String(number).padStart(4, "0")}`;
  return `## ${adr} [${m[1]}] ${m[2]}${rest}`;
}

// ---------------------------------------------------------------------------
// Lock contract.
// ---------------------------------------------------------------------------

export class OrgSymlinkEscapeError extends Error {
  constructor(public readonly path: string) {
    super(`refusing to lock/write through a symlink: ${path}`);
  }
}

export interface DecisionsLockDeps {
  leadsRoot: string;
  lstatSync?: (path: string) => { isSymbolicLink(): boolean };
}

function assertNotSymlink(
  absolutePath: string,
  lstat: (p: string) => { isSymbolicLink(): boolean },
): void {
  let lst;
  try {
    lst = lstat(absolutePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return;
    throw err;
  }
  if (lst.isSymbolicLink()) {
    throw new OrgSymlinkEscapeError(absolutePath);
  }
}

/**
 * Create `absolutePath` empty ONLY if it does not already exist — via the
 * `wx` flag (O_CREAT|O_EXCL), not existsSync+writeFileSync. Code-review fix:
 * O_EXCL fails EEXIST against ANY pre-existing path, including a dangling
 * symlink, WITHOUT following it — existsSync (which follows symlinks) would
 * report a dangling symlink as absent and let writeFileSync create/write
 * through it to whatever it points at, outside `leadsRoot`. The caller still
 * runs `assertNotSymlink` right after this, which is what actually rejects
 * an existing (non-dangling) symlink; this function's only job is to not be
 * the thing that writes through one first.
 */
function ensureFile(absolutePath: string): void {
  const dir = dirname(absolutePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(absolutePath, "", { flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "EEXIST") throw err;
  }
}

/** Resolve `decisions-proposed.md` / `decision_log.md` under `leadsRoot`
 *  through the SAME allowlist + path-guard as the generic `/file` route. */
export function resolveDecisionsPaths(leadsRoot: string): {
  proposedPath: string;
  loggedPath: string;
} {
  const proposed = resolveOrgAllowlistedTarget(leadsRoot, "decisions-proposed.md");
  const logged = resolveOrgAllowlistedTarget(leadsRoot, "decision_log.md");
  if (!proposed.ok || !logged.ok) {
    throw new Error(
      "internal invariant violated: decisions-proposed.md / decision_log.md failed to resolve under leadsRoot",
    );
  }
  return { proposedPath: proposed.absolute, loggedPath: logged.absolute };
}

export interface DecisionsLockContext {
  proposedPath: string;
  loggedPath: string;
  readProposed(): string;
  readLogged(): string;
}

/**
 * Acquire the FR-04.28 lock on `decisions-proposed.md`
 * (`stale: 10_000`, `realpath: true` — both explicit, per the contract;
 * neither side sets `lockfilePath`, so proper-lockfile's own default
 * `<path>.lock` is what leadwright's daemon must also target), run `fn`
 * inside the critical section, then release. The target file is created
 * (empty) before acquisition if missing. Both files are symlink-checked
 * before the lock is taken, AND re-checked immediately after it is held
 * (doubt-review fix, MEDIUM-HIGH): `lockfile.lock()` retries for up to
 * ~2.75s under contention (8 retries, 50ms→500ms backoff) — a co-resident
 * writer could swap either path for a symlink in that window, after the
 * first check ran but before the lock was actually ours. Re-checking right
 * after acquisition closes that specific gap. It does not extend to
 * arbitrary time spent inside `fn` itself — that would mean re-lstat'ing on
 * every read, which is unwarranted for a route whose only writers are this
 * process and leadwright's daemon, both honoring the same lock.
 */
export async function withDecisionsLock<T>(
  deps: DecisionsLockDeps,
  fn: (ctx: DecisionsLockContext) => Promise<T> | T,
): Promise<T> {
  const { proposedPath, loggedPath } = resolveDecisionsPaths(deps.leadsRoot);
  const lstat = deps.lstatSync ?? ((p: string) => lstatSync(p));

  ensureFile(proposedPath);
  assertNotSymlink(proposedPath, lstat);
  assertNotSymlink(loggedPath, lstat);

  const release = await lockfile.lock(proposedPath, {
    stale: 10_000,
    realpath: true,
    retries: { retries: 8, minTimeout: 50, maxTimeout: 500, factor: 2 },
  });
  try {
    assertNotSymlink(proposedPath, lstat);
    assertNotSymlink(loggedPath, lstat);
    const ctx: DecisionsLockContext = {
      proposedPath,
      loggedPath,
      readProposed: () => readFileSync(proposedPath, "utf8"),
      readLogged: () => (existsSync(loggedPath) ? readFileSync(loggedPath, "utf8") : ""),
    };
    return await fn(ctx);
  } finally {
    await release();
  }
}
