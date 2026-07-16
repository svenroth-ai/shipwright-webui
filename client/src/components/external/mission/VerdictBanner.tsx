/*
 * VerdictBanner — the Operation card's top line (FR-01.56, A12).
 *
 * The verdict is DERIVED, never decorative (deriveVerdict in proofLines.ts). This
 * component only PAINTS the outcome it is handed:
 *   - `clear` -> the `.ok` banner (a check icon + "ALL CLEAR ...", narrator copy),
 *   - `hold`  -> the `.err` banner (a shield-alert icon + a red "GATE HOLD" badge
 *                + the narrator's hold body),
 *   - `neutral` -> an HONEST muted banner: "No run data yet" (no facts) or
 *                  "In progress" (a live run whose checks have not decided yet).
 *
 * It can NEVER render a green ALL CLEAR for an unknown run — the only way to the
 * `.ok` branch is an explicit `outcome: "clear"` from the derivation (AC3).
 *
 * a11y (AC7): every state is ICON + TEXT, never colour alone; the flat verdict is
 * mirrored into the region's aria-label so a screen reader hears the outcome.
 */

import { Check, ShieldAlert, Loader2, CircleDashed } from "lucide-react";

import {
  composeVerdict,
  narrateVerdict,
  type VerdictTests,
} from "../../../lib/narrator";

/** Neutral copy — UI STATUS labels, not narrative phase vocabulary (so this is not
 *  a "second phrase book"): the narrator models only clear/hold verdicts.
 *   - `no-data`     — no run join at all.
 *   - `in-progress` — a LIVE run whose checks have not decided yet.
 *   - `unverified`  — a finished run that is NOT affirmatively ALL CLEAR (today's
 *     real state: review/security gates are unwired), so it is neither green nor a
 *     hold — honestly "not fully verified", never a false ALL CLEAR. */
const NEUTRAL_TEXT = {
  "no-data": "No run data yet",
  "in-progress": "In progress",
  unverified: "Not fully verified",
} as const;

export type NeutralReason = keyof typeof NEUTRAL_TEXT;

export type VerdictBannerProps =
  | { outcome: "clear"; tests: VerdictTests | null }
  | { outcome: "hold" }
  | { outcome: "neutral"; reason: NeutralReason };

export function VerdictBanner(props: VerdictBannerProps) {
  if (props.outcome === "clear") {
    const v = narrateVerdict({ outcome: "clear", tests: props.tests });
    return (
      <div
        className="mc-verdict ok"
        role="status"
        aria-label={composeVerdict(v)}
        data-testid="verdict-banner"
        data-outcome="clear"
      >
        <Check size={15} aria-hidden="true" />
        <span>
          <strong>{v.head}</strong> {v.body}
        </span>
      </div>
    );
  }

  if (props.outcome === "hold") {
    const v = narrateVerdict({ outcome: "hold" });
    return (
      <div
        className="mc-verdict err"
        role="status"
        aria-label={composeVerdict(v)}
        data-testid="verdict-banner"
        data-outcome="hold"
      >
        <ShieldAlert size={15} aria-hidden="true" />
        <span className="mcv-badge">{v.head}</span>
        <span>{v.body}</span>
      </div>
    );
  }

  const text = NEUTRAL_TEXT[props.reason];
  const Icon = props.reason === "in-progress" ? Loader2 : CircleDashed;
  return (
    <div
      className="mc-verdict neutral"
      role="status"
      aria-label={text}
      data-testid="verdict-banner"
      data-outcome="neutral"
      data-reason={props.reason}
    >
      <Icon size={15} aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}
