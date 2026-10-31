/*
 * Session evidence for GET /tasks/:id/session-file: which absolute paths did
 * THIS session itself touch or name? A path is evidenced when
 *   1. it is an Output (Write/Edit/NotebookEdit/MultiEdit target, incl. its
 *      subagents) per core/session-info, or
 *   2. it is named, as a whole path, in a chat text block or in a tool_use
 *      input of the session JSONL.
 * tool_result bodies, attachments and thinking are NEVER evidence: they quote
 * arbitrary file content and command output, not the session's intent.
 *
 * Stateless (CLAUDE.md rule 4): every call is a fresh bounded positional scan
 * via scanLines; the only cache is session-info's pure per-file memo.
 * Read-only (DO-NOT #1). A whole-path match means the char before is not a path
 * character and the char after does not continue the path, so a mention of a
 * directory never evidences its children and `/a/b` never evidences `/a/b.txt`.
 */

import path from "node:path";

import { scanLines } from "../session-info/line-scan.js";
import { SESSION_SCAN_BYTES, readSessionInfo, type SessionInfoDeps } from "../session-info/session-info.js";
import type { JsonlLocation } from "../session-watcher.js";

const CI = process.platform === "win32";
/** Comparison key: Windows paths are case-insensitive and may use either slash. */
export const evidenceKey = (p: string): string => (CI ? p.replace(/\//g, "\\").toLowerCase() : p);

// Before-set: '=' is left out on purpose so `--out=/x/y.md` still evidences /x/y.md.
// ')' '}' '*' ':' end shell expressions / remote specs (`$(pwd)/x`, `host:/x`): the path after them is a suffix, not a mention.
const BEFORE_BAD = /[\p{L}\p{N}_\-./\x5c~+@%#$)}*:]/u;
// '~', '+', '@', '%', '#', '$', '=' are valid filename characters: they continue a path, never end it.
// (A space inside a quoted filename stays ambiguous; the extension allowlist bounds that residual.)
const AFTER_BAD = /[\p{L}\p{N}_\-/\x5c~+@%#$=]/u;
const MAX_STRINGS_PER_LINE = 2000;
const MAX_DEPTH = 8;

/** True when `hay` names `needle` as a complete path (see file header). */
export function mentionsWholePath(hay: string, needle: string): boolean {
  if (!needle) return false;
  const h = CI ? hay.replace(/\//g, "\\").toLowerCase() : hay;
  const n = evidenceKey(needle);
  for (let i = h.indexOf(n); i !== -1; i = h.indexOf(n, i + 1)) {
    const before = i > 0 ? h[i - 1]! : "";
    if (before && BEFORE_BAD.test(before)) continue;
    const end = i + n.length;
    const after = h[end] ?? "";
    if (after && AFTER_BAD.test(after)) continue;
    // A '.' ends a sentence, unless it starts an extension ("a.txt" vs "a.txt.bak").
    if (after === "." && h[end + 1] !== undefined && AFTER_BAD.test(h[end + 1]!)) continue;
    return true;
  }
  return false;
}

function collectStrings(v: unknown, out: string[], depth = 0): void {
  if (out.length >= MAX_STRINGS_PER_LINE || depth > MAX_DEPTH) return;
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) collectStrings(x, out, depth + 1);
  else if (v && typeof v === "object") for (const x of Object.values(v)) collectStrings(x, out, depth + 1);
}

const OUTPUT_SECTIONS = ["bash-stdout", "bash-stderr", "local-command-stdout", "local-command-stderr"];

/** Drop `<name>…</name>` sections (command output echoed into user records) by plain string search. */
function stripSections(text: string, names: string[]): string {
  let out = text;
  for (const name of names) {
    const open = `<${name}>`;
    const close = `</${name}>`;
    for (let s = out.indexOf(open); s !== -1; s = out.indexOf(open)) {
      const e = out.indexOf(close, s);
      out = out.slice(0, s) + (e === -1 ? "" : out.slice(e + close.length));
    }
  }
  return out;
}

/** Text a user could have SEEN or the assistant DID: chat text + tool_use inputs. Never command output or injected meta. */
function evidenceStrings(rec: Record<string, unknown>): string[] {
  if (rec.type !== "user" && rec.type !== "assistant") return [];
  if (rec.isMeta === true || rec.isCompactSummary === true) return [];
  const msg = rec.message as Record<string, unknown> | undefined;
  const content = msg?.content;
  const out: string[] = [];
  if (typeof content === "string") out.push(stripSections(content, OUTPUT_SECTIONS));
  else if (Array.isArray(content)) {
    for (const b of content as Record<string, unknown>[]) {
      if (!b || typeof b !== "object") continue;
      if (b.type === "text" && typeof b.text === "string") out.push(stripSections(b.text, OUTPUT_SECTIONS));
      else if (b.type === "tool_use") collectStrings(b.input, out);
    }
  }
  return out;
}

/** Cheap raw-line pre-filter token: the basename, unless JSON could have escaped it. */
function prefilterToken(candidate: string): string | null {
  const base = path.win32.basename(candidate.replace(/\//g, "\\"));
  if (!base || [...base].some((ch) => ch === '"' || ch === "\x5c" || ch.charCodeAt(0) < 32)) return null;
  return CI ? base.toLowerCase() : base;
}

export interface EvidenceDeps {
  infoDeps?: SessionInfoDeps;
}

/**
 * The subset of `candidates` (absolute paths) this session evidences (as
 * evidenceKey()s), plus whether the search window was incomplete. The window is
 * the newest SESSION_SCAN_BYTES (48 MB) of the session file; older mentions are
 * a documented false negative (fail closed), reported as `incomplete` so the
 * caller can tell "not evidenced" from "not searched". An unreadable/missing
 * session evidences nothing. Evidence is bound to ONE session: the task's own
 * sessionUuid, located by the watcher — no other transcript is ever consulted.
 */
export interface EvidenceResult {
  found: Set<string>;
  /** The transcript was larger than the scan window: older history was NOT searched. */
  incomplete: boolean;
}

/**
 * Scans are serialized process-wide: each is synchronous JSON work over up to 48 MB, and a burst of
 * concurrent requests must queue rather than starve the event loop (terminal WS, transcript polls).
 * A promise chain, not a cache - nothing is remembered between requests (CLAUDE.md rule 4).
 */
let scanQueue: Promise<unknown> = Promise.resolve();

const SCAN_TIMEOUT_MS = 20_000;
const MAX_PENDING_SCANS = 8;
let pendingScans = 0;

export function findSessionEvidence(
  sessionUuid: string,
  loc: JsonlLocation | null,
  candidates: string[],
  deps: EvidenceDeps = {},
): Promise<EvidenceResult> {
  // Bounded backlog: a burst of unevidenced requests must not queue unbounded full scans (fail closed, incomplete).
  if (pendingScans >= MAX_PENDING_SCANS) return Promise.resolve({ found: new Set(), incomplete: true });
  pendingScans++;
  const run = scanQueue.then(() => withTimeout(scanForEvidence(sessionUuid, loc, candidates, deps)));
  scanQueue = run.catch(() => undefined);
  return run.finally(() => {
    pendingScans--;
  });
}

/** A stalled read must not hold the queue forever: give up (fail closed, incomplete) and move on. */
function withTimeout(p: Promise<EvidenceResult>): Promise<EvidenceResult> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<EvidenceResult>((resolve) => {
    timer = setTimeout(() => resolve({ found: new Set(), incomplete: true }), SCAN_TIMEOUT_MS);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

async function scanForEvidence(
  sessionUuid: string,
  loc: JsonlLocation | null,
  candidates: string[],
  deps: EvidenceDeps,
): Promise<EvidenceResult> {
  const found = new Set<string>();
  let incomplete = false;
  if (!loc || candidates.length === 0) return { found, incomplete };
  const wanted = new Map(candidates.map((c) => [evidenceKey(c), c]));

  try {
    const info = await readSessionInfo(sessionUuid, loc, deps.infoDeps);
    for (const o of info.outputs) if (wanted.has(evidenceKey(o.path))) found.add(evidenceKey(o.path));
  } catch {
    /* fall through to the raw scan; never widen access on error */
  }

  const tokens = candidates.map(prefilterToken);
  const pending = () => candidates.filter((c) => !found.has(evidenceKey(c)));
  const onLine = (line: string): void => {
    if (pending().length === 0) return;
    if (!line.includes('"user"') && !line.includes('"assistant"')) return;
    const probe = CI ? line.toLowerCase() : line;
    const live = candidates.filter((c, i) => !found.has(evidenceKey(c)) && (tokens[i] === null || probe.includes(tokens[i]!)));
    if (live.length === 0) return;
    let rec: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!parsed || typeof parsed !== "object") return;
      rec = parsed as Record<string, unknown>;
    } catch {
      return;
    }
    const strings = evidenceStrings(rec);
    for (const c of live) if (strings.some((s) => mentionsWholePath(s, c))) found.add(evidenceKey(c));
  };
  try {
    incomplete = (await scanLines(loc.path, SESSION_SCAN_BYTES, onLine)).truncated;
  } catch {
    /* unreadable session: only what structured outputs already proved */
    incomplete = true;
  }
  return { found, incomplete };
}
