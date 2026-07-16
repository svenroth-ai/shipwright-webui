/*
 * IntentWizard — the orchestrator (A08). ONE state machine, ONE flight-plan rail,
 * three doors feeding them. Renders the correct step body for the current
 * (door, step) and the live rail beside it.
 *
 * The working screen (step 2) auto-advances on a timer whose per-tick interval
 * is `tickMs` (injectable so tests drive it instantly). When the tick count
 * reaches the scan-step length the reducer flips to the result (step 3).
 */

import { useEffect, useReducer } from "react";

import { DoorPicker } from "./DoorPicker";
import { NewPathQuestions } from "./NewPathQuestions";
import { NewPathPlanCard } from "./NewPathPlanCard";
import { RepoPicker } from "./RepoPicker";
import { WorkingScreen } from "./WorkingScreen";
import { AdoptResult } from "./AdoptResult";
import { GradeResult } from "./GradeResult";
import { FlightPlanRail } from "./FlightPlanRail";
import { useReadiness } from "./useReadiness";
import {
  INITIAL_STATE,
  deriveDoorRows,
  deriveNewRows,
  wizardReducer,
} from "./wizardState";
import type { WizardDoor, WizardState } from "./types";

function initState(initialDoor: WizardDoor | null): WizardState {
  if (initialDoor === "adopt") return { ...INITIAL_STATE, door: "adopt", step: 1 };
  if (initialDoor === "grade") return { ...INITIAL_STATE, door: "grade", step: 1 };
  return INITIAL_STATE;
}

export function IntentWizard({
  initialDoor = null,
  tickMs = 450,
}: {
  initialDoor?: WizardDoor | null;
  tickMs?: number;
}) {
  const [state, dispatch] = useReducer(wizardReducer, initialDoor, initState);
  const readiness = useReadiness();

  // Working-screen ticker: advance while on step 2. The reducer decides when the
  // count is reached and flips to the result; here we just keep the clock.
  useEffect(() => {
    if (state.step !== 2 || state.workingTick === null) return;
    const id = window.setInterval(() => dispatch({ t: "tick" }), Math.max(1, tickMs));
    return () => window.clearInterval(id);
  }, [state.step, state.workingTick === null, tickMs]);

  const isDoorFlow = state.door === "adopt" || state.door === "grade";
  const rows = isDoorFlow ? deriveDoorRows(state) : deriveNewRows(state);

  let body: React.ReactNode;
  if (state.step === 0 || state.door === null) {
    body = <DoorPicker readiness={readiness} onPickDoor={(d) => dispatch({ t: "pickDoor", door: d })} />;
  } else if (state.door === "new") {
    body = state.step >= 5 ? (
      <NewPathPlanCard answers={state.answers} dispatch={dispatch} />
    ) : (
      <NewPathQuestions step={state.step} answers={state.answers} dispatch={dispatch} />
    );
  } else if (state.step === 1) {
    body = <RepoPicker door={state.door} path={state.path} dispatch={dispatch} />;
  } else if (state.step === 2) {
    body = <WorkingScreen door={state.door} path={state.path} tick={state.workingTick ?? 0} />;
  } else {
    body =
      state.door === "grade" ? (
        <GradeResult path={state.path} dispatch={dispatch} />
      ) : (
        <AdoptResult dispatch={dispatch} />
      );
  }

  return (
    <div className="wz" data-testid="intent-wizard">
      {body}
      <FlightPlanRail rows={rows} />
    </div>
  );
}
