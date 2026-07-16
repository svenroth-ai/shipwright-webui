/*
 * IntentWizard — the orchestrator (A08). ONE state machine, ONE flight-plan rail,
 * three doors feeding them. Renders the correct step body for the current
 * (door, step) and the live rail beside it.
 *
 * The working screen (step 2) auto-advances on a timer whose per-tick interval
 * is `tickMs` (injectable so tests drive it instantly). When the tick count
 * reaches the scan-step length the reducer flips to the result (step 3).
 */

import { useEffect, useReducer, useState } from "react";

import { DoorPicker } from "./DoorPicker";
import { NewPathQuestions } from "./NewPathQuestions";
import { NewPathPlanCard } from "./NewPathPlanCard";
import { RepoPicker } from "./RepoPicker";
import { WorkingScreen } from "./WorkingScreen";
import { AdoptResult } from "./AdoptResult";
import { GradeResult } from "./GradeResult";
import { LaunchingScreen } from "./LaunchingScreen";
import { FlightPlanRail } from "./FlightPlanRail";
import { useReadiness } from "./useReadiness";
import { useWizardLaunch } from "./useWizardLaunch";
import { useGradeReport } from "./useGradeReport";
import { isRemote } from "./stubData";
import {
  INITIAL_STATE,
  deriveDoorRows,
  deriveNewRows,
  wizardReducer,
} from "./wizardState";
import type { WizardLaunchRequest } from "./contract";
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
  const launch = useWizardLaunch();
  // Grade door: run the REAL read-only grade once the user commits a target
  // (step ≥ 2). A bare /wizard/grade (step 1) fires nothing (A09b, FR-01.53).
  const gradeTarget = state.door === "grade" ? state.path : null;
  const gradeReport = useGradeReport(gradeTarget, {
    isRemote: isRemote(gradeTarget),
    enabled: state.door === "grade" && state.step >= 2 && gradeTarget !== null,
  });
  // Launch is a transient, cross-door concern layered OVER the step reducer:
  // `launching` renders the hand-off screen; on success the wizard navigates to
  // Mission (this component unmounts), so only a failure lingers here.
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  // Retained so "Try again" re-runs the SAME request rather than only clearing
  // the error (external review — a retry button must actually retry).
  const [lastRequest, setLastRequest] = useState<WizardLaunchRequest | null>(null);

  // Working-screen ticker: advance while on step 2. The reducer decides when the
  // count is reached and flips to the result; here we just keep the clock.
  useEffect(() => {
    if (state.step !== 2 || state.workingTick === null) return;
    const id = window.setInterval(() => dispatch({ t: "tick" }), Math.max(1, tickMs));
    return () => window.clearInterval(id);
  }, [state.step, state.workingTick === null, tickMs]);

  async function handleLaunch(request: WizardLaunchRequest) {
    if (launching) return; // in-flight guard (a fast double-click is a no-op)
    setLastRequest(request);
    setLaunchError(null);
    setLaunching(true);
    const result = await launch(request);
    // On success the hook has already navigated to /tasks/:id; keep the
    // launching screen mounted until the route change tears us down. On
    // failure surface the reason and let the user retry the same request.
    if (!result.ok) {
      setLaunching(false);
      setLaunchError(result.detail ?? result.reason);
    }
  }

  const isDoorFlow = state.door === "adopt" || state.door === "grade";
  // Real grade summary for the rail (e.g. "A · 97.4/100"); null until ready, so
  // the rail never shows a fabricated grade.
  const gradeSummary =
    gradeReport.state === "report-ready" && gradeReport.model
      ? `${gradeReport.model.grade}${typeof gradeReport.model.score === "number" ? ` · ${gradeReport.model.score}/100` : ""}`
      : null;
  const rows = isDoorFlow ? deriveDoorRows(state, gradeSummary) : deriveNewRows(state);
  // The failed-launch screen replaces the door body until the user retries or
  // goes back; `door` here is always new|adopt (grade never launches).
  const launchDoor = state.door === "adopt" ? "adopt" : "new";

  let body: React.ReactNode;
  if (launching || launchError !== null) {
    body = (
      <LaunchingScreen
        door={launchDoor}
        failed={launchError !== null}
        error={launchError ?? undefined}
        onBack={() => {
          setLaunchError(null);
          dispatch({ t: "back" });
        }}
        onRetry={() => {
          if (lastRequest) void handleLaunch(lastRequest);
        }}
      />
    );
  } else if (state.step === 0 || state.door === null) {
    body = <DoorPicker readiness={readiness} onPickDoor={(d) => dispatch({ t: "pickDoor", door: d })} />;
  } else if (state.door === "new") {
    body = state.step >= 5 ? (
      <NewPathPlanCard answers={state.answers} dispatch={dispatch} onLaunch={handleLaunch} />
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
        <GradeResult path={state.path} report={gradeReport} dispatch={dispatch} />
      ) : (
        <AdoptResult path={state.path} dispatch={dispatch} onLaunch={handleLaunch} />
      );
  }

  return (
    <div className="wz" data-testid="intent-wizard">
      {body}
      <FlightPlanRail rows={rows} />
    </div>
  );
}
