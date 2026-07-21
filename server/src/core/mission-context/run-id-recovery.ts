/*
 * core/mission-context/run-id-recovery.ts — the THIRD identification source:
 * the `Run-ID:` footer the run itself wrote into its own commit message.
 *
 * WHY IT EXISTS (measured 2026-07-21 on the operator's real store). The pointer
 * is deleted at Finalize and the durable association is only ever written while
 * somebody has the Mission tab OPEN during the live window — so 1 of 416 real
 * tasks carried an association and 19 of 150 sessions in this project could be
 * identified at all. The identity was never actually lost: every finalized run
 * signs its own commit with `Run-ID: <run_id>` (the F6 footer), and that text is
 * in the session's own transcript.
 *
 * The transcript is UNTRUSTED DATA even though it is read server-side (§5.1) —
 * same posture as the transcript-derived PR number in merge-check.ts, which is
 * bounded-int validated before use. So the value found here is admitted only
 * after THREE independent checks, each derived from a REAL false positive found
 * while probing 65 transcripts:
 *
 *   1. CANONICAL SHAPE. `Run-ID: iterate-<YYYY-MM-DD>-<slug>`, then the strict
 *      `isSafeRunId` grammar on top. A permissive id class matched the template
 *      mention `Run-ID: iterate-` and the non-iterate `Run-ID: security-…`; both
 *      pass `isSafeRunId` happily and would resolve to an iterate that does not
 *      exist.
 *   2. LINE-TERMINATED. The id must END its line (or its JSON string). This is
 *      what a commit footer looks like. It rejects the measured prose case
 *      `→ decision_log.md (ADR via Run-ID: iterate-2026-06-14-repair-claude-json)`
 *      in a session that is not an iterate at all — a quotation is not a claim.
 *   3. CORROBORATED. The project's OWN records must know the run: a
 *      `work_completed` row in `shipwright_events.jsonl`, or an
 *      `iterates/<run_id>.json`. Measured, this rejects the 2 cross-repo run ids
 *      quoted inside webui sessions while keeping 29 of 31 recoveries. An
 *      UNREADABLE event log is explicitly NOT evidence — "we could not check"
 *      must never become "yes".
 *
 * A transcript with no qualifying marker yields null and the session stays
 * `plain`. There is no partial answer and no guess.
 */

import { findWorkCompleted, readIterateDoc } from "./iterate-record.js";
import { isSafeRunId } from "./pointer.js";

/**
 * Hard cap on how much text is scanned, independent of what the caller passes.
 * The caller already reads a bounded tail; this is the belt to that braces.
 */
export const MAX_SCAN_CHARS = 1024 * 1024;

/**
 * The F6 footer marker.
 *
 * The transcript is raw JSONL, so a message newline appears as the two
 * characters `\` + `n` inside a JSON string and a string end appears as `"`
 * (often preceded by an escaping backslash). The lookahead therefore accepts
 * exactly those terminators — `\n`, `\r`, `\"`, a real CR/LF, a bare quote, or
 * end-of-input — which is what makes an inline prose mention (followed by `)`,
 * `,`, a word…) fail to match.
 *
 * The escape set is ENUMERATED rather than "any backslash" (external code
 * review, openai MEDIUM): a prose sentence ending `…-real-run\)` is a backslash
 * too, and accepting it would re-open the very quotation case the
 * line-termination rule exists to reject.
 */
const RUN_ID_FOOTER =
  /Run-ID:[ \t]*(iterate-\d{4}-\d{2}-\d{2}-[A-Za-z0-9][A-Za-z0-9._-]{0,90})[ \t]*(?=\\[nr"]|"|\r|\n|$)/g;

/**
 * The LAST qualifying `Run-ID` in `transcript`, or null.
 *
 * LAST, not first: a long session legitimately contains several iterates (a
 * fix-forward after a merge, a campaign's sub-iterates), and the most recent one
 * is the run this session is about. Verified against every session in this
 * project that still has a live pointer: 18 agreements, 0 disagreements.
 *
 * Pure — no I/O, no corroboration. `recoverRunIdFromTranscript` is the entry
 * point that adds evidence.
 */
export function findRunIdFooter(transcript: string): string | null {
  if (typeof transcript !== "string" || transcript.length === 0) return null;
  const text =
    transcript.length > MAX_SCAN_CHARS ? transcript.slice(-MAX_SCAN_CHARS) : transcript;

  let last: string | null = null;
  RUN_ID_FOOTER.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RUN_ID_FOOTER.exec(text)) !== null) {
    // Defense in depth: the same grammar every other run_id must satisfy before
    // it may take part in a path join (kills `..`, separators, non-ASCII).
    if (isSafeRunId(m[1])) last = m[1];
  }
  return last;
}

/**
 * Does THIS project's own record set know `runId`?
 *
 * `unavailable` (the log could not be read) is deliberately not evidence: an
 * unreadable source must never be upgraded into a confirmation.
 */
export function hasRunRecord(projectRoot: string, runId: string): boolean {
  if (!isSafeRunId(runId)) return false;
  if (findWorkCompleted(projectRoot, runId).status === "found") return true;
  return readIterateDoc(projectRoot, runId) !== null;
}

/**
 * NEGATIVE memo (external plan review, gemini HIGH + openai MEDIUM).
 *
 * A SUCCESSFUL recovery is paid once because the caller persists it. A session
 * that genuinely has no footer — an ordinary chat — never becomes associated, so
 * without this it would re-scan on every poll for as long as its Mission tab is
 * open.
 *
 * KEYED BY CONTENT, NOT BY LENGTH (external code review, openai MEDIUM). Length
 * alone is a trap: past 1 MB the bounded tail is ALWAYS exactly `MAX_SCAN_CHARS`
 * while its content slides forward, so a length key would freeze every large
 * session at "no marker" — and the footer arrives precisely by sliding into that
 * window. The fingerprint therefore also samples the END of the tail, which is
 * exactly what moves as the transcript grows.
 *
 * Deliberately NOT a persisted "no run" association: that would add a second
 * meaning to `task.missionContext` and a second write surface, to cache a regex.
 */
const negativeScans = new Map<string, string>();
const NEGATIVE_CAP = 512;
/** How much of the tail END feeds the fingerprint. */
const FINGERPRINT_CHARS = 256;

function tailFingerprint(text: string): string {
  return `${text.length}:${text.slice(-FINGERPRINT_CHARS)}`;
}

/**
 * Test-only: how many real scans ran. Without it a memo test can only assert the
 * same answer twice — which passes whether or not the memo exists.
 */
let scanCount = 0;
export function _recoveryScanCount(): number {
  return scanCount;
}

/** Test-only: drop the negative-scan memo between cases. */
export function _clearRecoveryMemo(): void {
  negativeScans.clear();
  scanCount = 0;
}

/**
 * The recovered run id for this session, or null.
 *
 * Called ONLY from rule 5 of the ordered scenario table (scenario.ts), i.e. only
 * once rules 1-4 — custom-actions, pointer, association, pipeline, campaign —
 * have all missed. Every caller that reaches it therefore RESOLVES on the
 * answer, and the route persists that answer, so the scan is paid once per task
 * rather than once per poll.
 *
 * It was not always so: until iterate-2026-07-21-mission-recovery-memo-perf the
 * resolver computed this BEFORE the table, so a campaign- or pipeline-resolved
 * session that happened to quote a corroborated footer scanned on every poll
 * forever — nothing consumed the answer, so nothing ever persisted it, and the
 * memo below only covers a NEGATIVE result (internal code review of PR #309).
 */
export function recoverRunIdFromTranscript(
  projectRoot: string,
  transcript: string,
  sessionUuid?: string,
): string | null {
  const memoKey = sessionUuid ? `${projectRoot}::${sessionUuid}` : null;
  const fingerprint = memoKey ? tailFingerprint(transcript) : null;
  if (memoKey && negativeScans.get(memoKey) === fingerprint) return null;

  scanCount++;
  const candidate = findRunIdFooter(transcript);

  // Memoize ONLY "this text contains no marker" — a purely TEXTUAL fact, which
  // cannot change while the text does not. A candidate that failed
  // CORROBORATION is deliberately re-checked every poll: the project's records
  // can gain the run later (Finalize writes the event), and caching that answer
  // would strand the session as `plain` until the transcript happened to grow.
  if (!candidate) {
    if (memoKey && fingerprint) {
      if (negativeScans.size >= NEGATIVE_CAP) negativeScans.clear();
      negativeScans.set(memoKey, fingerprint);
    }
    return null;
  }
  return hasRunRecord(projectRoot, candidate) ? candidate : null;
}
