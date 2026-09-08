/*
 * external/org/beat-register-health.ts — GET
 * /api/external/org/leads/:leadId/beat-register (iterate-2026-08-18-org-route-beat-register,
 * V4a-2B point 7 — the open-register finding) plus `registerEntriesGuarded`,
 * the same guard chain for a caller that needs the raw entries rather than
 * a derived health classification (iterate-2026-09-08-lead-inventory-page).
 *
 * Split out of `beat-register.ts` (bloat gate — that file crossed the
 * 300-line convention ceiling once this iterate's guarded-entries reader
 * was added). `beat-register.ts` keeps the shared shapes/fs helpers used by
 * BOTH this file and `beat-register-release.ts`'s POST route; this file
 * keeps only the two guarded READ paths.
 */

import type { Hono } from "hono";
import { closeSync, constants as fsConstants, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";

import { LEAD_ID_RE } from "./_helpers.js";
import { realPathGuard } from "../../core/path-guard.js";
import {
  registerPathFor,
  readRegisterFileTolerant,
  parseRegisterFileText,
  evaluateRegisterHealth,
  type LstatFn,
} from "./beat-register.js";
import type { BeatRegisterEntryView, BeatRegisterHealthResponse } from "../../types/org.js";

export interface BeatRegisterRouteDeps {
  leadsRoot: string;
  lstatSync?: LstatFn;
  openSync?: typeof openSync;
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

export type RegisterEntriesGuardedResult =
  | { ok: true; entries: BeatRegisterEntryView[] }
  | { ok: false };

/**
 * Guarded, tolerant read of a lead's raw register entries — for a caller
 * that needs the entries themselves (e.g. the Lead Inventory composite)
 * rather than a derived health classification. Code review (Stage 2,
 * high/correctness + medium/security): the original Lead Inventory
 * composite called `readRegisterFileTolerant` directly on an UNVALIDATED
 * `leadId` sourced from `org-chart.json`'s keys (which `orgChartCore` does
 * not itself validate against `LEAD_ID_RE`), with no symlink refusal or
 * containment check — and collapsed a genuine parse/structural failure
 * (`ok:false`) into the same "zero beats" shape as a lead that has simply
 * never run, exactly the false-positive-clear class this iterate exists to
 * close elsewhere. `ok:false` here must be rendered as "beat history
 * unavailable" by the caller, never silently treated as zero beats.
 *
 * Open-first (external code review, medium/security): unlike
 * `beatRegisterHealthCore` above — which `lstat`s the pathname, then
 * *reopens it by path* through `readRegisterFileTolerant`, leaving a TOCTOU
 * window where a local writer can swap the checked regular file for a
 * symlink between the two calls — this function opens the fd FIRST
 * (`O_NOFOLLOW`), `fstat`s and containment-checks that SAME fd's path, then
 * reads from the held fd. Matches the pattern `readAuditLinesGuarded`
 * (`audit-log.ts`) and `beat-steps-read.ts` already use for every other
 * reader this iterate added; `beatRegisterHealthCore` itself is
 * pre-existing code from a prior iterate and is unchanged here — out of
 * this iterate's scope.
 */
export function registerEntriesGuarded(
  deps: BeatRegisterRouteDeps,
  leadId: string,
): RegisterEntriesGuardedResult {
  const { leadsRoot } = deps;
  const open = deps.openSync ?? openSync;

  if (!LEAD_ID_RE.test(leadId)) {
    return { ok: false };
  }

  const absolute = registerPathFor(leadsRoot, leadId);

  let fd: number;
  try {
    fd = open(absolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { ok: true, entries: [] };
    }
    return { ok: false };
  }

  try {
    if (!fstatSync(fd).isFile()) {
      return { ok: false };
    }
    const containment = realPathGuard(leadsRoot, absolute);
    if (!containment.ok) {
      return { ok: false };
    }
    const raw = readFileSync(fd, "utf8");
    const parsed = parseRegisterFileText(raw);
    if (!parsed.ok) {
      return { ok: false };
    }
    return { ok: true, entries: parsed.file.entries };
  } catch {
    return { ok: false };
  } finally {
    closeSync(fd);
  }
}

export function registerBeatRegisterHealthRoute(app: Hono, deps: BeatRegisterRouteDeps): void {
  app.get("/api/external/org/leads/:leadId/beat-register", async (c) => {
    const result = beatRegisterHealthCore(deps, c.req.param("leadId"));
    return c.json(result.body, result.status);
  });
}
