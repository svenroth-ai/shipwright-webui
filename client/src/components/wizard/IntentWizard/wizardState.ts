/*
 * wizardState — the ONE state machine all three doors feed (A08).
 *
 * The prototype used a single mutable `S`; here it is a typed reducer. Three
 * doors, one machine, one flight-plan derivation — never three forked wizards.
 * The working-screen ticker (step 2) computes its own length from `scanSteps`,
 * so the reducer knows when to advance to the result without the view telling it.
 */

import { doorLabel, profileFor, scanSteps } from "./stubData";
import type { FlightRow, WizardDoor, WizardState } from "./types";

export const INITIAL_STATE: WizardState = {
  door: null,
  step: 0,
  answers: {},
  path: null,
  workingTick: null,
};

export type WizardAction =
  | { t: "pickDoor"; door: WizardDoor }
  | { t: "setBrief"; text: string }
  | { t: "chip"; text: string }
  | { t: "answer"; k: "who" | "remember" | "where"; v: string }
  | { t: "next" }
  | { t: "back" }
  | { t: "setPath"; path: string }
  | { t: "startWork"; path?: string }
  | { t: "tick" }
  | { t: "toAdopt" };

export function wizardReducer(s: WizardState, a: WizardAction): WizardState {
  switch (a.t) {
    case "pickDoor":
      return { ...s, door: a.door, step: 1, workingTick: null };
    case "setBrief":
      return { ...s, answers: { ...s.answers, brief: a.text } };
    case "chip":
      return { ...s, answers: { ...s.answers, brief: a.text }, step: 2 };
    case "answer":
      return { ...s, answers: { ...s.answers, [a.k]: a.v } };
    case "next": {
      // New door: step 1 keeps a typed-but-empty brief honest with a default.
      if (s.door === "new" && s.step === 1 && !s.answers.brief?.trim()) {
        return { ...s, answers: { ...s.answers, brief: "My idea" }, step: 2 };
      }
      return { ...s, step: Math.min(5, s.step + 1) };
    }
    case "back": {
      if (s.workingTick !== null) {
        // Cancel an in-flight scan → back to the pick.
        return { ...s, step: 1, workingTick: null };
      }
      if (s.step <= 1) {
        // Adopt/grade step-1 back returns to the picker; new step-1 too.
        return { ...INITIAL_STATE };
      }
      return { ...s, step: s.step - 1 };
    }
    case "setPath":
      return { ...s, path: a.path };
    case "startWork":
      return { ...s, path: a.path ?? s.path, step: 2, workingTick: 0 };
    case "tick": {
      const count = scanSteps(s.door ?? "adopt", s.path).length;
      const next = (s.workingTick ?? 0) + 1;
      if (next >= count) return { ...s, step: 3, workingTick: null };
      return { ...s, workingTick: next };
    }
    case "toAdopt":
      // Grade → adopt conversion: same state, door flips to adopt, RE-scans
      // (adopt reads far more than grade did), lands on the adopt result. The
      // repo (path) is preserved — never re-asked.
      return { ...s, door: "adopt", step: 2, workingTick: 0 };
    default:
      return s;
  }
}

/** New-door flight-plan rows. Unanswered fields render as dim spine nodes. */
export function deriveNewRows(s: WizardState): FlightRow[] {
  const a = s.answers;
  const p = profileFor(a);
  return [
    { key: "Door", answered: !!s.door, value: s.door ? doorLabel(s.door) : "", why: "" },
    {
      key: "The brief",
      answered: !!a.brief,
      value: a.brief ?? "",
      why: a.brief ? "This becomes the spec Shipwright writes against." : "",
    },
    {
      key: "Users",
      answered: !!a.who,
      value: a.who ?? "",
      why: a.who ? `Because you said “${a.who}” → auth scope + deploy ambition set.` : "",
    },
    {
      key: "Stack profile",
      answered: !!a.remember,
      value: a.remember ? p.name : "",
      why: a.remember ? `Because you said “${a.remember}” → ${p.note}.` : "",
    },
    {
      key: "Runs at",
      answered: !!a.where,
      value: a.where ?? "",
      why:
        a.where === "On the web"
          ? "Web → I’ll ask for deploy env vars, but only now that they matter."
          : a.where
            ? "Local → zero env questions."
            : "",
    },
  ];
}

/** Adopt/grade flight-plan rows. The result rows light only at step ≥ 3. The
 *  grade summary (e.g. "A · 97.4/100") is the REAL fetched grade (A09b) — null
 *  until the report is ready, so the row stays a dim node rather than showing a
 *  fabricated number. */
export function deriveDoorRows(s: WizardState, gradeSummary?: string | null): FlightRow[] {
  const grade = s.door === "grade";
  const done = s.step >= 3;
  const gradeReady = done && !!gradeSummary;
  return [
    {
      key: "Door",
      answered: true,
      value: grade ? "Grade your repo" : "Bring Shipwright to an existing repo",
      why: "",
    },
    {
      key: "Repo",
      answered: !!s.path,
      value: s.path ?? "",
      why: s.path
        ? grade
          ? "Read-only. Nothing is written, no account."
          : "I read it before I touch it."
        : "",
    },
    {
      key: grade ? "Grade" : "What I found",
      answered: grade ? gradeReady : done,
      value: grade ? (gradeSummary ?? "") : done ? "Vite · Hono · TS · 84 tests" : "",
      why: grade
        ? gradeReady
          ? "Read-only — graded from what the repo can prove."
          : ""
        : done
          ? "Conventions learned from 412 commits."
          : "",
    },
    {
      key: grade ? "What you’d gain" : "What happens next",
      answered: done,
      value: done ? (grade ? "traceability + test evidence" : "adopting runs as a task") : "",
      why: done
        ? grade
          ? "The n/a rows are exactly what adopting lights up."
          : "It writes files — so you watch it in Mission."
        : "",
    },
  ];
}
