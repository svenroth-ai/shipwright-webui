/*
 * FlightPlanRail — the ONE live flight-plan idiom all three doors feed (A08).
 *
 * It grows one labelled row per ANSWERED field ("Because you said X → Y").
 * Unanswered fields are a dim node on the spine — never a "—" placeholder row
 * (AC1). Takes already-derived rows (wizardState.deriveNewRows /
 * deriveDoorRows), so it has no per-door knowledge.
 */

import { Sparkles } from "lucide-react";

import type { FlightRow } from "./types";

export function FlightPlanRail({ rows }: { rows: FlightRow[] }) {
  return (
    <div className="flightplan" data-testid="wizard-flightplan">
      <div className="fh">
        <Sparkles size={14} /> Flight plan — building live
      </div>
      <div className="fp-spine">
        <div className="fp-line" aria-hidden="true" />
        {rows.map((r) =>
          r.answered ? (
            <div className="fp-item" key={r.key} data-testid={`fp-row-${r.key}`}>
              <span className="fp-dot" aria-hidden="true" />
              <div className="fk">{r.key}</div>
              <div className="fv">{r.value}</div>
              {r.why ? <div className="fw">{r.why}</div> : null}
            </div>
          ) : (
            <div className="fp-node" key={r.key} data-testid={`fp-node-${r.key}`}>
              <span className="fp-dot" aria-hidden="true" />
              <span className="fk">{r.key}</span>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
