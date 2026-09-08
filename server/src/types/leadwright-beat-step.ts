/*
 * leadwright-beat-step.ts — hand-typed mirror of leadwright's published
 * beat-step contract (iterate-2026-09-08-lead-inventory-page). Vendored
 * source: server/src/vendor/leadwright/beat-step.schema.json, copied
 * byte-for-byte from leadwright origin/main @
 * db2938b308899b8cbca017b291c18696a54844b5 (PR #75 added steps.jsonl +
 * this schema; PR #78 wired the production writer). Verified on
 * origin/main, not a local-only commit.
 *
 * CLAUDE.md rule 7 (ADR-080): no cross-package import — this is a verbatim
 * mirror kept in fidelity-test sync (leadwright-beat-step.test.ts), which
 * reads the vendored JSON fresh off disk rather than diffing bytes against
 * a live leadwright checkout (no such dependency exists here).
 *
 * `isValidBeatStep` deliberately validates ONLY the fields this viewer
 * consumes and TOLERATES unknown properties — looser than the vendored
 * schema's own `additionalProperties: false`. A future leadwright field
 * addition should degrade to "ignored", not "every line in every
 * steps.jsonl rejected" (Internal Plan Review finding #6).
 *
 * Cross-repo drift cannot be caught by any test in this repo — this repo
 * has no build-time dependency on a leadwright checkout, so a schema change
 * on leadwright's main after the pinned commit above is silent here until a
 * human re-vendors deliberately and bumps the pin.
 */

/** Mirrors the vendored schema's own `at` pattern exactly (external code
 *  review, low/bug): `isValidBeatStep` previously accepted any string for
 *  `at`, so a malformed timestamp (`"not-a-time"`) rendered as a valid
 *  logged step instead of being counted as an unreadable line. */
const BEAT_STEP_AT_RE = /^\d{4}-\d{2}-\d{2}T/;

export const BEAT_STEP_BANDS = ["bugfix", "maintenance", "feature", "architecture"] as const;

export type BeatStepBand = (typeof BEAT_STEP_BANDS)[number];

export type BeatStepEffect =
  | { kind: "card"; taskId: string }
  | { kind: "decision"; decisionKey: string }
  | { kind: "none" };

export interface BeatStep {
  at: string;
  band: BeatStepBand;
  summary: string;
  effect: BeatStepEffect;
}

function isValidEffect(v: unknown): v is BeatStepEffect {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  if (e.kind === "card") return typeof e.taskId === "string" && e.taskId.length > 0;
  if (e.kind === "decision") return typeof e.decisionKey === "string" && e.decisionKey.length > 0;
  if (e.kind === "none") return true;
  return false;
}

export function isValidBeatStep(v: unknown): v is BeatStep {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.at === "string" &&
    BEAT_STEP_AT_RE.test(s.at) &&
    typeof s.band === "string" &&
    (BEAT_STEP_BANDS as readonly string[]).includes(s.band) &&
    typeof s.summary === "string" &&
    s.summary.length > 0 &&
    isValidEffect(s.effect)
  );
}
