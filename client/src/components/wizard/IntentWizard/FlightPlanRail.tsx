/*
 * FlightPlanRail — the ONE live flight-plan idiom all three doors feed (A08).
 *
 * It grows one labelled row per ANSWERED field ("Because you said X → Y").
 * Unanswered fields are a dim node on the spine — never a "—" placeholder row
 * (AC1). Takes already-derived rows (wizardState.deriveNewRows /
 * deriveDoorRows), so it has no per-door knowledge.
 *
 * Phone (iterate-2026-08-13-mission-mobile-visual): the full dark rail used to
 * fall in under `@media (max-width:900px)` and stack BELOW the question,
 * breaking "one question per screen" with its own solid background and
 * padding mid-scroll. On a phone (isPhone, ≤767px — narrower than that
 * 900px reflow breakpoint, which still governs tablet unchanged) the rail
 * collapses to a tappable summary chip pinned under the question; the SAME
 * row markup opens in a Radix Dialog styled as a bottom sheet on tap. Desktop
 * and tablet are untouched — same markup, same `wizard-flightplan` testid,
 * same rows.
 */

import { useState } from "react";
import { ChevronRight, Sparkles, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";

import { useIsPhoneViewport } from "../../../hooks/useIsCompactViewport";
import type { FlightRow } from "./types";

function FlightPlanRows({ rows }: { rows: FlightRow[] }) {
  return (
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
  );
}

export function FlightPlanRail({ rows }: { rows: FlightRow[] }) {
  const isPhone = useIsPhoneViewport();
  const [open, setOpen] = useState(false);

  if (isPhone) {
    const answeredCount = rows.filter((r) => r.answered).length;
    return (
      <>
        <button
          type="button"
          className="fp-chip"
          data-testid="wizard-flightplan-chip"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          <Sparkles size={15} className="fp-chip-ic" aria-hidden="true" />
          <span className="fp-chip-t">
            <b>Flight plan</b>
            <span>{answeredCount} of {rows.length} answered</span>
          </span>
          <span className="fp-chip-dots" aria-hidden="true">
            {rows.map((r) => (
              <i key={r.key} className={r.answered ? "done" : undefined} />
            ))}
          </span>
          <ChevronRight size={13} className="fp-chip-chev" aria-hidden="true" />
        </button>
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className="fp-sheet-overlay" data-testid="wizard-flightplan-sheet-overlay" />
            <Dialog.Content
              className="flightplan fp-sheet"
              data-testid="wizard-flightplan-sheet"
            >
              <div className="fp-sheet-head">
                <Dialog.Title className="fh" style={{ marginBottom: 0 }}>
                  <Sparkles size={14} /> Flight plan — building live
                </Dialog.Title>
                <Dialog.Close aria-label="Close" data-testid="wizard-flightplan-sheet-close" className="fp-sheet-close">
                  <X size={16} aria-hidden="true" />
                </Dialog.Close>
              </div>
              <Dialog.Description className="sr-only">
                The live flight plan for this session — one row per answered question.
              </Dialog.Description>
              <FlightPlanRows rows={rows} />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </>
    );
  }

  return (
    <div className="flightplan" data-testid="wizard-flightplan">
      <div className="fh">
        <Sparkles size={14} /> Flight plan — building live
      </div>
      <FlightPlanRows rows={rows} />
    </div>
  );
}
