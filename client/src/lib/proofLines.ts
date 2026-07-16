/*
 * proofLines.ts — the Operation card's DERIVED verdict + curated proof summary
 * (FR-01.56, A12, campaign webui-wow-usability-2026-07-10). Pure + deterministic.
 *
 * deriveVerdict is HONEST: ALL CLEAR only on affirmative evidence, GATE HOLD only
 * on a real failing security gate, NEUTRAL for everything else — NEVER a false ALL
 * CLEAR (AC3, the worst bug this card can ship). deriveProofLines builds a short
 * (<=8, capped) list of proof LINES from ONLY real facts (no facts -> [], honest
 * empty). Line kinds map to the prototype's `.mc-hero` spans: t / p / r / d.
 * Durations always render `n/a` (AC4/AC5 — trg-eb989815; never synthesized). Reads
 * the SAME facts as A11's Record, so a HOLD and a "review clean" receipt can never
 * coexist. NOT a terminal (Architecture rule 1): rendered history, no xterm / pty /
 * WebSocket / input.
 */

import { NA } from "./narrator-strings";

export type GateState = "pass" | "fail" | "unknown";
/** ALL CLEAR / GATE HOLD / neutral. `neutral` is deliberately never `clear`. */
export type VerdictOutcome = "clear" | "hold" | "neutral";

/** Structural subset of A02's `RunDataJoin` (never a cross-package import,
 *  ADR-080) — `RunDataJoin` is assignable, so OperationCard passes it straight.
 *  Today the server derives `test` from the suite count but `review`/`security`
 *  have NO per-run signal in the event log (run-data-join.ts) — they are always
 *  `unknown`. The verdict honours that: ALL CLEAR needs all three affirmatively
 *  green, so an unwired review/security gate degrades to neutral, never a false
 *  clear (AC3/AC5). `phaseDurations` is deliberately NOT read: the emitter has
 *  never fired (trg-eb989815), so every duration on this card is `n/a` — no
 *  summing, no synthesis (AC4). */
export interface ProofFacts {
  runId?: string | null;
  commit?: string | null;
  affectedFrs?: string[] | null;
  tests?: { passed: number | null; total: number | null } | null;
  gates?: { test?: GateState; review?: GateState; security?: GateState } | null;
}

export interface OperationVerdict {
  outcome: VerdictOutcome;
  /** For `hold` — the gate that actually held (only `security` today: the sole
   *  gate hold the narrator + prototype model). `null` otherwise. */
  heldGate: "security" | null;
}

export type ProofKind = "t" | "p" | "r" | "d" | "plain";
export interface ProofSpan {
  kind: ProofKind;
  text: string;
}
export interface ProofLine {
  id: string;
  spans: ProofSpan[];
}

/** Glyphs + punctuation as code points (ASCII source — no encoding ambiguity). */
const PROMPT = String.fromCodePoint(0x203a); // >
const PASS = String.fromCodePoint(0x2713); // check
const FAIL = String.fromCodePoint(0x2715); // cross
const DASH = String.fromCodePoint(0x2014); // em dash
const DOT = String.fromCodePoint(0x00b7); // middle dot
const MAX_PROOF_LINES = 8;

/** Every duration on this card is `n/a` — the phase-timing emitter has never
 *  produced a row (trg-eb989815), so a value is never synthesized (AC4). */
export const DURATION_NA = NA;

function testsGreen(tests?: ProofFacts["tests"]): boolean {
  return (
    tests != null &&
    tests.passed != null &&
    tests.total != null &&
    tests.total > 0 &&
    tests.passed === tests.total
  );
}

/**
 * The HONEST verdict. Order matters:
 *   1. no facts -> `neutral` (never `clear` — AC3).
 *   2. the security gate actually failed -> `hold`. Only the SECURITY gate holds:
 *      it is the one gate hold A10's narrator models (its head, body and mission
 *      line are all security-worded). A failed test/review gate is NOT forced into
 *      that security copy — printing "The security gate caught something" for a red
 *      test would be a FALSE claim, strictly worse than an honest neutral; those
 *      degrade to the in-progress/unverified neutral instead (the red suite is still
 *      shown as a proof line, so the failure is never HIDDEN).
 *   3. real ALL-CLEAR evidence — suite fully green AND review AND security both
 *      AFFIRMATIVELY `pass`. "no failing gate" is not enough: an `unknown` gate
 *      (today's real state for review/security) is not evidence, and the banner
 *      literally claims "security ... review clean", so it must be earned. This is
 *      forward-safe — the card lights ALL CLEAR the moment the backend wires those
 *      gates, and stays honest until then.
 *   4. everything else -> `neutral`.
 */
export function deriveVerdict(input: { facts: ProofFacts | null }): OperationVerdict {
  const { facts } = input;
  if (facts == null) return { outcome: "neutral", heldGate: null };

  const gates = facts.gates ?? {};
  if (gates.security === "fail") return { outcome: "hold", heldGate: "security" };

  if (testsGreen(facts.tests) && gates.review === "pass" && gates.security === "pass") {
    return { outcome: "clear", heldGate: null };
  }
  return { outcome: "neutral", heldGate: null };
}

/**
 * Event-log strings are UNTRUSTED display data (the runId, the FR) — the proof
 * summary must not become a place raw log payloads leak control/bidi characters or
 * unbounded text (touches_io_boundary). React escapes HTML, but not C0/C1 controls,
 * the DEL byte, or the Unicode bidi overrides that can visually reorder a line. A
 * code-point filter (not a literal-byte regex) strips those, collapses whitespace,
 * and caps the length.
 */
export function sanitizeProofText(raw: string, maxLen = 64): string {
  let out = "";
  for (const ch of raw) {
    const cp = ch.codePointAt(0) ?? 0;
    // C0 (0x00-0x1F, incl. tab/CR/LF) + DEL/C1 (0x7F-0x9F) controls.
    const isControl = cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f);
    // Bidi embeds/overrides/isolates (200E/200F, 202A-202E, 2066-2069).
    const isBidi =
      cp === 0x200e ||
      cp === 0x200f ||
      (cp >= 0x202a && cp <= 0x202e) ||
      (cp >= 0x2066 && cp <= 0x2069);
    if (!isControl && !isBidi) out += ch;
  }
  out = out.replace(/  +/g, " ").trim(); // collapse multi-space runs
  if (out.length <= maxLen) return out;
  return out.slice(0, maxLen - 1) + String.fromCodePoint(0x2026); // ellipsis
}

function promptLine(facts: ProofFacts): ProofLine | null {
  const runId = sanitizeProofText(facts.runId?.trim() ?? "");
  if (!runId) return null;
  return {
    id: "prompt",
    spans: [
      { kind: "t", text: PROMPT },
      { kind: "plain", text: ` ${runId} ` },
      { kind: "d", text: `${DOT} ${DURATION_NA}` },
    ],
  };
}

function suiteLine(facts: ProofFacts): ProofLine | null {
  const t = facts.tests;
  if (!testsGreen(t)) return null;
  return {
    id: "suite",
    spans: [
      { kind: "p", text: PASS },
      { kind: "plain", text: ` suite green ${DASH} ${t!.passed} passed` },
    ],
  };
}

/** A RED suite line — surfaced honestly so a failing suite is never HIDDEN behind a
 *  bare "neutral" banner (a red test gate is not a security hold, so it does not
 *  flip the verdict to GATE HOLD, but the failure is still shown). */
function suiteFailLine(facts: ProofFacts): ProofLine | null {
  const t = facts.tests;
  if (!t || t.passed == null || t.total == null || t.total <= 0) return null;
  if (t.passed === t.total) return null; // green — handled by suiteLine
  return {
    id: "suite-fail",
    spans: [
      { kind: "r", text: FAIL },
      { kind: "plain", text: ` suite ${DASH} ${t.passed}/${t.total} passing` },
    ],
  };
}

function checksLine(facts: ProofFacts): ProofLine | null {
  const gates = facts.gates ?? {};
  const parts: string[] = [];
  if (gates.review === "pass") parts.push("review clean");
  if (gates.security === "pass") parts.push("security clean");
  if (parts.length === 0) return null;
  return {
    id: "checks",
    spans: [
      { kind: "p", text: PASS },
      { kind: "plain", text: ` ${parts.join(` ${DOT} `)}` },
    ],
  };
}

function commitLine(facts: ProofFacts): ProofLine | null {
  const commit = facts.commit?.trim();
  if (!commit) return null;
  const fr = sanitizeProofText(facts.affectedFrs?.[0]?.trim() ?? "", 24);
  const spans: ProofSpan[] = [
    { kind: "p", text: PASS },
    { kind: "plain", text: " committed" },
  ];
  if (fr) spans.push({ kind: "d", text: ` [${fr}]` });
  return { id: "commit", spans };
}

/**
 * The curated proof lines. NO facts -> [] (never invented). A `hold` shows the
 * prompt + the failing gate ONLY (no ✓ pass line, so a hold can never sit beside a
 * "clean" receipt). `clear`/`neutral` show only the evidence that is REALLY present
 * — a green OR a red suite line, the passing gates, and (clear only) the commit.
 * Capped so the summary stays a glance, not a scrollback.
 */
export function deriveProofLines(input: {
  facts: ProofFacts | null;
  verdict: OperationVerdict;
}): ProofLine[] {
  const { facts, verdict } = input;
  if (facts == null) return [];

  const lines: (ProofLine | null)[] = [promptLine(facts)];
  if (verdict.outcome === "hold") {
    lines.push({
      id: "hold",
      spans: [
        { kind: "r", text: FAIL },
        { kind: "plain", text: " security gate held" },
      ],
    });
  } else {
    lines.push(suiteLine(facts), suiteFailLine(facts), checksLine(facts));
    if (verdict.outcome === "clear") lines.push(commitLine(facts));
  }
  return lines.filter((l): l is ProofLine => l != null).slice(0, MAX_PROOF_LINES);
}
