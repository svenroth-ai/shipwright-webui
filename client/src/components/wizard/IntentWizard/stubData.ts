/*
 * Intent-Wizard STUB data (A08, AC3 provenance-honesty).
 *
 * A08 is UI-only. The scan trace, adopt snapshot and grade ReportModel below are
 * a STUB — tagged `STUB_PROVENANCE` and rendered behind an explicit "sample, not
 * your repo" placeholder. A09 replaces them with the real /shipwright-adopt +
 * /shipwright-grade output. Nothing here is presented as a live reading.
 *
 * The grade stub is shaped EXACTLY like the plugin's ReportModel (structured
 * provenance, schema_version, n/a ⇒ score null). A09b's round-trip probe
 * confirmed dimension `score`/`weight` are 0..1 FRACTIONS; this fixture matches.
 */

import { resolveStackProfile } from "./contract";
import type { NewAnswers, WizardDoor } from "./types";

/** Every stubbed data source carries this so nothing is mistaken for live (AC3). */
export const STUB_PROVENANCE = "stub" as const;

export interface DoorDef {
  id: WizardDoor;
  icon: "sparkles" | "wrench" | "target";
  label: string;
  desc: string;
  /** Deep-link path segment (adopt/grade land inside the flow). */
  route: string;
}

/** Wording MUST match First Contact — the canonical copy. */
export const DOORS: DoorDef[] = [
  {
    id: "new",
    icon: "sparkles",
    label: "Build something new",
    desc: "From an idea to a spec, tests, and code.",
    route: "/wizard/new",
  },
  {
    id: "adopt",
    icon: "wrench",
    label: "Bring Shipwright to an existing repo",
    desc: "Point it at a folder — it learns your rules first, then changes safely.",
    route: "/wizard/adopt",
  },
  {
    id: "grade",
    icon: "target",
    label: "Grade your repo",
    desc: "Check how much control you have — read-only, about 60 seconds, no account.",
    route: "/wizard/grade",
  },
];

export function doorLabel(id: WizardDoor): string {
  return DOORS.find((d) => d.id === id)?.label ?? id;
}

export interface QuestionDef {
  k: keyof NewAnswers;
  q: string;
  hint: string;
  type: "text" | "opts";
  chips?: string[];
  opts?: string[];
}

/** The stack question — only offered when the user has profiles of their own. */
export const STACK_QUESTION: QuestionDef = {
  k: "profile",
  q: "Do you already have a tech stack you like to use?",
  hint:
    "A few questions will follow that decide the technology your project is built on. " +
    "If you've used Shipwright before and saved your own tech stack (a “stack profile”), pick it below and I'll skip those questions. " +
    "New here? Choose “I'm new — guide me” and I'll ask a few simple questions instead.",
  type: "opts",
};

/** The questions for THIS wizard run, in order. With no own profiles (or none
 *  chosen) this is the classic four; choosing a profile drops the two
 *  stack-deciding questions ("remember" and "where"). */
export function activeQuestions(
  s: { customProfiles: unknown[]; answers: NewAnswers },
): QuestionDef[] {
  const [brief, who, remember, where] = QUESTIONS;
  const stack = s.customProfiles.length > 0 ? [STACK_QUESTION] : [];
  return s.answers.profile ? [brief, ...stack, who] : [brief, ...stack, who, remember, where];
}

export const QUESTIONS: QuestionDef[] = [
  {
    k: "brief",
    q: "Describe it like you'd tell a friend.",
    hint: "A sentence or two is plenty — no jargon needed.",
    type: "text",
    chips: [
      "A booking tool for my yoga studio",
      "An internal dashboard for support tickets",
      "A link shortener with stats",
    ],
  },
  {
    k: "who",
    q: "Who's going to use it?",
    hint: "This sets how sign-in and permissions are handled.",
    type: "opts",
    opts: ["Just me", "My team", "Customers / public"],
  },
  {
    k: "remember",
    q: "Does it need to remember things?",
    hint: "Accounts, saved records, uploads — that kind of thing.",
    type: "opts",
    opts: ["Yes", "No", "Not sure yet"],
  },
  {
    k: "where",
    q: "Where should it run at first?",
    hint: "You can always change this later.",
    type: "opts",
    opts: ["Just on my machine", "On the web"],
  },
];

export function profileFor(answers: NewAnswers): { name: string; note: string } {
  // Single source of truth for the StackProfile mapping lives in contract.ts
  // (A09a) — the flight-plan/plan-card display and the launch payload can never
  // disagree about which profile "remember=Yes" means.
  const { profile, note } = resolveStackProfile(answers);
  return { name: profile, note };
}

/** The 7 pipeline phases in plain language for the plan card. */
export function planPhases(answers: NewAnswers): Array<{ name: string; desc: string; skipped: boolean }> {
  const web = answers.where === "On the web";
  return [
    { name: "Project", desc: "First I write down what “done” means — that’s your spec.", skipped: false },
    { name: "Design", desc: "I mock the screens so you can approve the look before code exists.", skipped: false },
    { name: "Plan", desc: "I break the work into small, testable pieces.", skipped: false },
    { name: "Build", desc: "Tests first (they prove it works), then the code to pass them.", skipped: false },
    { name: "Test", desc: "The full suite runs — the red→green moment is the proof.", skipped: false },
    { name: "Changelog", desc: "Every change is written up so the record stays honest.", skipped: false },
    {
      name: "Deploy",
      desc: web ? "I ship it to the web (I’ll ask for env vars here)." : "Skipped — it runs on your machine for now.",
      skipped: !web,
    },
  ];
}

/** The scan/working steps. Remote grade adds a shallow-clone step (real cost). */
export function scanSteps(door: WizardDoor, path: string | null): string[] {
  const remote = isRemote(path);
  const grade = door === "grade";
  const steps: string[] = [];
  if (grade && remote) steps.push("Shallow-cloning to a temp folder (deleted afterwards)");
  steps.push("Reading the git history");
  steps.push("Detecting the stack and the profile");
  steps.push("Mapping routes, folders and features");
  steps.push(grade ? "Inventorying tests + CI + security" : "Sampling tests and learning your conventions");
  steps.push(grade ? "Scoring the four dimensions" : "Drafting what it would write");
  return steps;
}

export function isRemote(path: string | null): boolean {
  const p = path ?? "";
  // A remote target either carries a URL scheme, or is a `host/owner/repo`
  // shorthand ANCHORED at the start. The host tests are anchored (^) rather than
  // "contains github.com" so an arbitrary local path with a host-like segment in
  // the middle isn't misread as remote (this is a UI hint, but an unanchored
  // host substring check is also a static-analysis footgun). Windows drive paths
  // like `C:\repo` carry no `://`, so they read local.
  return /:\/\//.test(p) || /^(?:www\.)?(?:github|gitlab)\.com\//i.test(p);
}

/** Recent-path chips for the repo picker. */
export const RECENT_PATHS = [
  "C:\\01_Development\\leadwright",
  "C:\\work\\api-server",
  "github.com/acme/checkout",
];

export { ADOPT_SNAPSHOT, GRADE_REPORT } from "./stubReports";
