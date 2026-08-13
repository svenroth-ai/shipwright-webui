/*
 * VerdictBanner — the Operation card's top line (FR-01.56, A12).
 *
 * The verdict is DERIVED, never decorative (deriveVerdict in proofLines.ts). This
 * component only PAINTS an EARNED, specific outcome:
 *   - `clear` -> the `.ok` banner (a check icon + "ALL CLEAR ...", narrator copy),
 *   - `hold`  -> the `.err` banner (a shield-alert icon + a red "GATE HOLD" badge
 *                + the narrator's hold body).
 *
 * There is deliberately no `neutral` variant (retired
 * iterate-2026-08-13-mission-mobile-visual): a neutral verdict carries no
 * specific fact worth a banner of its own, and `OperationCard`'s
 * `ProofSummary` already renders its own honest "No run data yet — nothing
 * to prove" empty state, or the real proof lines (a red suite line, etc.)
 * when they exist — a fact-free banner on top of either was pure
 * redundancy. `OperationCard` renders NO banner at all for a neutral verdict.
 *
 * It can NEVER render a green ALL CLEAR for an unknown run — the only way to the
 * `.ok` branch is an explicit `outcome: "clear"` from the derivation (AC3).
 *
 * a11y (AC7): every state is ICON + TEXT, never colour alone; the flat verdict is
 * mirrored into the region's aria-label so a screen reader hears the outcome.
 */

import { Check, ShieldAlert } from "lucide-react";

import {
  composeVerdict,
  narrateVerdict,
  type VerdictTests,
} from "../../../lib/narrator";

export type VerdictBannerProps =
  | { outcome: "clear"; tests: VerdictTests | null }
  | { outcome: "hold" };

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
