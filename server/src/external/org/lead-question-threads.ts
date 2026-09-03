/*
 * external/org/lead-question-threads.ts — reads leadwright's
 * `<leadsRoot>/<lead-id>/lead-question-threads.json` (FR-04.42, pinned by
 * leadwright#35's `lib/lead-question-thread.ts`). This module is the
 * webui-side half of that contract: leadwright owns the write path and the
 * exposure shape (`exposeLeadQuestionThread`) that this mirrors; this repo
 * only ever reads.
 *
 * Shapes below are a VERBATIM, INDEPENDENT mirror of leadwright's
 * `LeadQuestionRound` / `LeadQuestionThread` / `LeadQuestionThreadsFile`
 * (CLAUDE.md rule 7 — no cross-package import), not a re-implementation of
 * its write-time invariants.
 *
 * Unlike every sibling reader in this directory (`usage.ts`, `last-run.ts`,
 * `org-chart.ts`), a missing file, an unreadable file, invalid JSON, an
 * unknown `version`, or a malformed shape all collapse to the SAME "no
 * threads" result — never a distinct error status. A lead with no follow-up
 * history is the overwhelming steady state (most leads have never asked a
 * question), and the Org page must keep rendering cleanly either way (AC-d):
 * there is no page-level error surface for this data the way there is for
 * `org-chart.json` (`org_chart_invalid`, 502).
 */

import { readFileSync, lstatSync } from "node:fs";
import path from "node:path";

import { realPathGuard } from "../../core/path-guard.js";
import { LEAD_ID_RE } from "./_helpers.js";

const LEAD_QUESTION_THREADS_VERSION = 1;

export interface LeadQuestionRoundMirror {
  round: number;
  questionType: string;
  question: string;
  askedAt: string;
  answer?: { text: string; answeredAt: string };
}

export interface LeadQuestionThreadMirror {
  taskId: string;
  dedupKey: string;
  rounds: LeadQuestionRoundMirror[];
}

interface LeadQuestionThreadsFileMirror {
  version: number;
  threads: Record<string, LeadQuestionThreadMirror>;
}

function isValidAnswer(v: unknown): v is { text: string; answeredAt: string } {
  if (typeof v !== "object" || v === null) return false;
  const a = v as Record<string, unknown>;
  return typeof a.text === "string" && typeof a.answeredAt === "string";
}

function isValidRound(v: unknown): v is LeadQuestionRoundMirror {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  if (
    typeof r.round !== "number" ||
    typeof r.questionType !== "string" ||
    typeof r.question !== "string" ||
    typeof r.askedAt !== "string"
  ) {
    return false;
  }
  if (r.answer !== undefined && !isValidAnswer(r.answer)) return false;
  return true;
}

function isValidThread(v: unknown): v is LeadQuestionThreadMirror {
  if (typeof v !== "object" || v === null) return false;
  const t = v as Record<string, unknown>;
  return (
    typeof t.taskId === "string" &&
    typeof t.dedupKey === "string" &&
    Array.isArray(t.rounds) &&
    t.rounds.every(isValidRound)
  );
}

/**
 * Structural-only parse. `null` on anything that isn't a well-formed,
 * KNOWN-version threads file — every such case reads as "no threads" to
 * every caller (see file header).
 */
export function parseLeadQuestionThreadsFile(raw: string): LeadQuestionThreadsFileMirror | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.version !== LEAD_QUESTION_THREADS_VERSION) {
    // Not a crash, not a page-level error (AC-d) — but a schema bump on
    // leadwright's side would otherwise blank every Org-page thread with no
    // operator-visible signal anywhere, so this one branch gets a breadcrumb.
    console.warn(
      `lead-question-threads.json: unknown version ${JSON.stringify(obj.version)}, expected ${LEAD_QUESTION_THREADS_VERSION} — treating as no threads`,
    );
    return null;
  }
  if (typeof obj.threads !== "object" || obj.threads === null || Array.isArray(obj.threads)) {
    return null;
  }
  const threadsIn = obj.threads as Record<string, unknown>;
  const threads: Record<string, LeadQuestionThreadMirror> = {};
  for (const [taskId, thread] of Object.entries(threadsIn)) {
    if (!isValidThread(thread)) return null;
    threads[taskId] = thread;
  }
  return { version: obj.version, threads };
}

export interface LeadQuestionThreadsRouteDeps {
  leadsRoot: string;
  /** Injectable for tests; production wires the real lstatSync. */
  lstatSync?: (p: string) => { isSymbolicLink(): boolean };
}

export type LeadQuestionThreadsReadResult =
  | { ok: true; threads: Record<string, LeadQuestionThreadMirror> }
  | { ok: false };

/**
 * Pure core. Always succeeds with a (possibly empty) threads map — a
 * missing/symlinked/unreadable/invalid/unknown-version file degrades to
 * `{ ok: false }`, which callers treat identically to "no threads yet".
 */
export function readLeadQuestionThreadsCore(
  deps: LeadQuestionThreadsRouteDeps,
  leadId: string,
): LeadQuestionThreadsReadResult {
  const { leadsRoot } = deps;
  // Defense in depth, mirroring usage.ts/last-run.ts: callers pass a
  // chart-derived leadId (org-chart.json's parser validates each lead's
  // FIELDS but not that its object KEY is kebab-case), so this reader
  // re-validates its own leadId regardless of caller rather than trusting
  // the containment check below to be the only guard.
  if (!LEAD_ID_RE.test(leadId)) return { ok: false };
  const lstat = deps.lstatSync ?? ((p: string) => lstatSync(p));
  const absolute = path.join(leadsRoot, leadId, "lead-question-threads.json");

  let lst;
  try {
    lst = lstat(absolute);
  } catch {
    return { ok: false };
  }
  if (lst.isSymbolicLink()) return { ok: false };

  const containment = realPathGuard(leadsRoot, absolute);
  if (!containment.ok) return { ok: false };

  let raw: string;
  try {
    raw = readFileSync(absolute, "utf8");
  } catch {
    return { ok: false };
  }

  const file = parseLeadQuestionThreadsFile(raw);
  if (!file) return { ok: false };

  return { ok: true, threads: file.threads };
}
