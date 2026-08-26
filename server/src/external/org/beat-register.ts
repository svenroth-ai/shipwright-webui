/*
 * external/org/beat-register.ts — shared shapes + GET
 * /api/external/org/leads/:leadId/beat-register (iterate-2026-08-18-org-route-beat-register,
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
 * The release action (point 4.4) lives in `beat-register-release.ts`, which
 * imports the shared shapes/helpers from this file.
 */

import type { Hono } from "hono";
import { readFileSync, lstatSync, writeFileSync, renameSync, existsSync, unlinkSync } from "node:fs";
import path, { dirname, basename } from "node:path";
import { randomBytes } from "node:crypto";

import { LEAD_ID_RE } from "./_helpers.js";
import { realPathGuard } from "../../core/path-guard.js";
import type { BeatRegisterEntryView, BeatRegisterHealthResponse } from "../../types/org.js";

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

// ---------------------------------------------------------------------------
// GET /api/external/org/leads/:leadId/beat-register
// ---------------------------------------------------------------------------

export interface BeatRegisterRouteDeps {
  leadsRoot: string;
  lstatSync?: LstatFn;
}

export type BeatRegisterHealthCoreResult =
  | { status: 200; body: BeatRegisterHealthResponse }
  | { status: 400 | 403 | 500 | 502; body: { error: string; leadId?: string; detail?: string } };

/** Pure core — shared by the secret-gated route and the plain-surface proxy. */
export function beatRegisterHealthCore(
  deps: BeatRegisterRouteDeps,
  leadId: string,
): BeatRegisterHealthCoreResult {
  const { leadsRoot } = deps;
  const lstat = deps.lstatSync ?? ((p: string) => lstatSync(p));

  if (!LEAD_ID_RE.test(leadId)) {
    return { status: 400, body: { error: "invalid_lead_id", leadId } };
  }

  const absolute = registerPathFor(leadsRoot, leadId);

  let lst;
  try {
    lst = lstat(absolute);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return { status: 200, body: { leadId, status: "clear" } };
    }
    return {
      status: 500,
      body: { error: "beat_register_read_failed", detail: String(err).slice(0, 200) },
    };
  }
  if (lst.isSymbolicLink()) {
    return { status: 403, body: { error: "symlink_forbidden", leadId } };
  }
  const containment = realPathGuard(leadsRoot, absolute);
  if (!containment.ok) {
    return { status: 400, body: { error: "path_traversal", detail: containment.reason } };
  }

  const read = readRegisterFileTolerant(absolute);
  if (!read.ok) {
    return { status: 502, body: { error: "beat_register_invalid", leadId } };
  }

  const health = evaluateRegisterHealth(read.file);
  return { status: 200, body: { leadId, ...health } };
}

export function registerBeatRegisterHealthRoute(app: Hono, deps: BeatRegisterRouteDeps): void {
  app.get("/api/external/org/leads/:leadId/beat-register", async (c) => {
    const result = beatRegisterHealthCore(deps, c.req.param("leadId"));
    return c.json(result.body, result.status);
  });
}
