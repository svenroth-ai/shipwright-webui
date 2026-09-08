/*
 * external/org/beat-register.ts — shared shapes + fs helpers for a lead's
 * `beat-register.json` (iterate-2026-08-18-org-route-beat-register,
 * V4a-2B point 7 — the open-register finding).
 *
 * Reads leadwright's `~/.claude/leads/<lead-id>/beat-register.json`
 * (contract name (a), decided by leadwright: `{version:1, entries:
 * BeatRegisterEntry[]}`, open iff `closedAt === null`, a second entry under
 * one `sessionId` is a fault). This is a JSON-safe MIRROR of leadwright's
 * `lib/beat-register.ts` (`evaluateRegisterHealth`) — not an import,
 * cross-repo — matching its contract exactly, including one of its known
 * limitations (see the `MIRRORED LIMITATION` comment below).
 *
 * The two guarded READ routes (health classification + raw entries) live in
 * `beat-register-health.ts`, and the release action (point 4.4) lives in
 * `beat-register-release.ts` — both import the shared shapes/helpers below.
 * Split out of this file (bloat gate, iterate-2026-09-08-lead-inventory-page)
 * once `registerEntriesGuarded` pushed it past the 300-line ceiling.
 */

import { readFileSync, writeFileSync, renameSync, existsSync, unlinkSync } from "node:fs";
import path, { dirname, basename } from "node:path";
import { randomBytes } from "node:crypto";

import { realPathGuard } from "../../core/path-guard.js";
import type { BeatRegisterEntryView } from "../../types/org.js";

export type {
  BeatRegisterEntryView,
  BeatRegisterHealthResponse,
} from "../../types/org.js";

// ---------------------------------------------------------------------------
// Register shapes — JSON-safe mirror of leadwright's BeatRegisterEntry.
// ---------------------------------------------------------------------------

export interface BeatRegisterFile {
  version: 1;
  entries: BeatRegisterEntryView[];
}

function isValidEntry(v: unknown): v is BeatRegisterEntryView {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.sessionId === "string" &&
    e.sessionId.length > 0 &&
    typeof e.beatId === "string" &&
    typeof e.leadId === "string" &&
    typeof e.pid === "number" &&
    typeof e.startedAt === "string" &&
    (e.closedAt === null || typeof e.closedAt === "string")
  );
}

/** Structural validation only — mirrors leadwright's own schema, not a
 *  re-derivation. Rejects an unsupported `version` or malformed entries
 *  rather than guessing a health/staleness value from corrupt data
 *  (plan-review PR-4). */
export function isValidRegisterFile(v: unknown): v is BeatRegisterFile {
  if (typeof v !== "object" || v === null) return false;
  const f = v as Record<string, unknown>;
  return f.version === 1 && Array.isArray(f.entries) && f.entries.every(isValidEntry);
}

export type RegisterHealth =
  | { status: "clear" }
  | { status: "open"; entry: BeatRegisterEntryView }
  | {
      status: "fault";
      reason: "duplicate-session-id";
      sessionId: string;
      entries: BeatRegisterEntryView[];
    };

/**
 * Mirrors leadwright's `evaluateRegisterHealth` exactly, including its
 * scope: duplicate-sessionId is checked first (fault always wins), then the
 * FIRST open entry is reported.
 *
 * MIRRORED LIMITATION (plan-review PR-10, disclosed not fixed): two
 * DISTINCT open entries (different sessionIds, neither duplicated) are NOT
 * flagged as a fault — only the first found is reported as "open". This
 * matches leadwright's own function precisely (verified by reading
 * `lib/beat-register.ts`); FR-04.41's lock is what is supposed to prevent
 * this state from occurring at all.
 */
export function evaluateRegisterHealth(file: BeatRegisterFile): RegisterHealth {
  const bySession = new Map<string, BeatRegisterEntryView[]>();
  for (const entry of file.entries) {
    const list = bySession.get(entry.sessionId) ?? [];
    list.push(entry);
    bySession.set(entry.sessionId, list);
  }
  for (const [sessionId, entries] of bySession) {
    if (entries.length > 1) {
      return { status: "fault", reason: "duplicate-session-id", sessionId, entries };
    }
  }
  const open = file.entries.find((e) => e.closedAt === null);
  if (open) {
    return { status: "open", entry: open };
  }
  return { status: "clear" };
}

// ---------------------------------------------------------------------------
// Shared fs helpers — used by both the GET route below and
// beat-register-release.ts's POST route.
// ---------------------------------------------------------------------------

export type LstatFn = (p: string) => { isSymbolicLink(): boolean };

export function registerPathFor(leadsRoot: string, leadId: string): string {
  return path.join(leadsRoot, leadId, "beat-register.json");
}

export function auditPathFor(leadsRoot: string, leadId: string): string {
  return path.join(leadsRoot, leadId, "audit.jsonl");
}

/**
 * Symlink + containment guard for a target already known to exist.
 *
 * Code-review fix (Stage 2, medium/correctness): the original version let
 * `lstat` throw uncaught, so a target deleted between the caller's own
 * existence check and this call (the register file genuinely has a second
 * writer — leadwright's own daemon) propagated as an unhandled exception
 * into a bare 500 instead of a graceful outcome. Mirrors
 * `decisions-lock.ts`'s `assertNotSymlink`, which is ENOENT-tolerant for
 * exactly this reason — the difference here is a vanished target is
 * reported back as its OWN status (`404 vanished`) rather than silently
 * treated as "fine, proceed", because (unlike `assertNotSymlink`'s
 * create-if-absent callers) every current caller of this function needs
 * the target to actually be there for what it does next.
 */
export function guardExistingTarget(
  leadsRoot: string,
  absolute: string,
  lstat: LstatFn,
): { ok: true } | { ok: false; status: 403 | 400 | 404; error: string; detail?: string } {
  let lst;
  try {
    lst = lstat(absolute);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { ok: false, status: 404, error: "vanished" };
    }
    throw err;
  }
  if (lst.isSymbolicLink()) {
    return { ok: false, status: 403, error: "symlink_forbidden" };
  }
  const containment = realPathGuard(leadsRoot, absolute);
  if (!containment.ok) {
    return { ok: false, status: 400, error: "path_traversal", detail: containment.reason };
  }
  return { ok: true };
}

export function atomicWriteJson(target: string, value: unknown): void {
  const tmp = path.join(
    dirname(target),
    `.${basename(target)}.tmp-${process.pid}-${Date.now()}-${randomBytes(4).toString("hex")}`,
  );
  try {
    writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
    renameSync(tmp, target);
  } catch (err) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      /* swallow */
    }
    throw err;
  }
}

/** Empty text and any parse/structural failure both resolve the same way
 *  regardless of how the caller obtained the text (a plain `readFileSync`
 *  by path, or a held-fd read after an open-first guard chain) — split out
 *  of `readRegisterFileTolerant` so `registerEntriesGuarded` (beat-register-
 *  health.ts) can reuse the parse without re-reading the file by path,
 *  which is what the open-first pattern exists to avoid (external code
 *  review, medium/security: `registerEntriesGuarded` originally checked
 *  `lstat`+`realPathGuard` and then reopened the pathname via this
 *  function's `readFileSync(absolute)` — a TOCTOU window where a local
 *  writer could swap the checked regular file for a symlink between the
 *  check and the reopen). */
export function parseRegisterFileText(raw: string): { ok: true; file: BeatRegisterFile } | { ok: false } {
  if (raw.trim().length === 0) {
    return { ok: true, file: { version: 1, entries: [] } };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false };
  }
  if (!isValidRegisterFile(parsed)) {
    return { ok: false };
  }
  return { ok: true, file: parsed };
}

/** ENOENT/empty-file both read as a `{version:1, entries:[]}` clear
 *  register — mirrors leadwright's own `readRegisterUnlocked`. Any other
 *  parse/structural failure returns `ok:false` (never a guessed value). */
export function readRegisterFileTolerant(
  absolute: string,
): { ok: true; file: BeatRegisterFile } | { ok: false } {
  let raw: string;
  try {
    raw = readFileSync(absolute, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { ok: true, file: { version: 1, entries: [] } };
    }
    return { ok: false };
  }
  return parseRegisterFileText(raw);
}
