/*
 * Intent-Wizard STUB data (A08, AC3 provenance-honesty).
 *
 * A08 is UI-only. The scan trace, adopt snapshot and grade ReportModel below are
 * a STUB — tagged `STUB_PROVENANCE` and rendered behind an explicit "sample, not
 * your repo" placeholder. A09 replaces them with the real /shipwright-adopt +
 * /shipwright-grade output. Nothing here is presented as a live reading.
 *
 * The grade stub is shaped EXACTLY like the plugin's ReportModel (provenance is
 * a structured object, schema_version present, n/a ⇒ score null) so the renderer
 * exercises the real contract, not a convenient simplification.
 */

import type { AdoptSnapshot, NewAnswers, ReportModel, WizardDoor } from "./types";

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
    route: "/wizard",
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
  if (answers.remember === "Yes") {
    return { name: "supabase-nextjs", note: "needs a free Supabase account" };
  }
  return {
    name: "vite-hono",
    note: "runs fully local · zero-signup default · upgradeable later",
  };
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

/** STUB adopt snapshot (what's here / what adopt writes). */
export const ADOPT_SNAPSHOT: AdoptSnapshot = {
  found: [
    { label: "Stack", value: "Vite · Hono · TypeScript (strict)" },
    { label: "Profile", value: "vite-hono" },
    { label: "Routes", value: "34 mapped from the router + server handlers" },
    { label: "Tests", value: "Vitest — 84 files · 71% of sources covered" },
    { label: "CI", value: "GitHub Actions — no security scan (a CI gap)" },
    { label: "Conventions", value: "learned from your last 412 commits" },
    { label: "Features", value: "23 detected from the routes + folders" },
    { label: "Commands", value: "npm run dev · build · test" },
  ],
  writes: [
    { label: "CLAUDE.md", value: "your rules — so every future change respects them" },
    { label: ".shipwright/agent_docs", value: "architecture + component map, read before each change" },
    { label: "spec.md", value: "written FROM your code — what “done” already means here" },
    { label: "baseline E2E suite", value: "a safety net, crawled from your running app" },
    { label: "shipwright_*_config.json", value: "the pipeline config, matched to your stack" },
  ],
};

/**
 * STUB grade ReportModel — shaped EXACTLY like the plugin's asdict() output. The
 * cold-repo case: requirement traceability cannot be proven, so it is a genuine
 * n/a (score null, status "n/a"). NO number is invented for it.
 */
export const GRADE_REPORT: ReportModel = {
  target_display: "github.com/acme/checkout",
  grade: "C",
  score: 61,
  gradeable: true,
  verdict: "Real code, thin evidence. Two of four dimensions cannot be derived at all.",
  band_label: "Partial control",
  mode: "cold repo (never adopted)",
  routing_state: "heuristic",
  routing_reason: "no Shipwright records found — graded from history + structure",
  verified_from: "shallow clone — fetched to a temp folder, deleted after grading",
  measurable_count: 2,
  na_count: 2,
  static_test_inventory: "84 test files (Vitest) · 71% of source files have a sibling test",
  honest_ceiling_note:
    "A cold repo can only be graded on what it can prove. Two dimensions have no evidence to read — that is a finding about the record, not a verdict on your code.",
  dimensions: [
    {
      key: "requirement_traceability",
      label: "Requirement traceability",
      weight: 30,
      score: null,
      status: "n/a",
      anchor: "trace",
      detail: "There is no spec, so no line of code can be traced back to a requirement.",
      provenance: {
        source: "Looked for: spec.md, requirements/, an FR index. None found.",
        mode: "unavailable",
        freshness: "n/a",
        sampled: false,
        truncated: false,
        disabled_enrichments: ["scorecard-fr-index"],
      },
      would_light_up: true,
    },
    {
      key: "test_health",
      label: "Test health",
      weight: 30,
      score: 71,
      status: "gap",
      anchor: "tests",
      detail: "84 real tests run and pass — but nothing records what they are supposed to protect.",
      provenance: {
        source: "Read: package.json scripts + the test-file inventory.",
        mode: "heuristic",
        freshness: "a1b2c3d4e5f6",
        sampled: false,
        truncated: false,
        disabled_enrichments: ["ci-junit-pass-ratio"],
      },
      would_light_up: true,
    },
    {
      key: "security",
      label: "Security",
      weight: 20,
      score: 100,
      status: "ok",
      anchor: "sec",
      detail: "No high or critical findings today. But nothing re-checks on every change.",
      provenance: {
        source: "Read: CI workflows. No security scan step found.",
        mode: "heuristic",
        freshness: "a1b2c3d4e5f6",
        sampled: false,
        truncated: false,
        disabled_enrichments: ["code-scanning-sarif"],
      },
      would_light_up: false,
    },
    {
      // Change TRACEABILITY is git-derived: on a cold repo with no conventional
      // commits, no PR/issue links and no decision log, there is no evidence that
      // links a change to a reason — so change discipline can't be scored at all.
      // A genuine n/a (the second underivable dimension), never a faked number.
      // Key is `change_traceability` — the plugin's canonical _DIM_META key
      // (report_model.py) — so A09's real payload keeps the same testids/label.
      key: "change_traceability",
      label: "Change history",
      weight: 20,
      score: null,
      status: "n/a",
      anchor: "hist",
      detail:
        "412 commits record WHAT changed — but with no conventional commits, no PR/issue links and no decision log, nothing records WHY, so change discipline has no evidence to score.",
      provenance: {
        source: "Read: git log (412 commits, 14 months). Found no PR/issue links or decision log.",
        mode: "unavailable",
        freshness: "n/a",
        sampled: false,
        truncated: false,
        disabled_enrichments: ["ci-run-per-sha", "conventional-commit-links"],
      },
      would_light_up: true,
    },
  ],
  reasons: [
    "No spec exists, so traceability has nothing to trace to.",
    "The tests pass, but they cannot say what they defend.",
    "Nothing scans for vulnerabilities when the code changes.",
    "The history says what happened, never why.",
  ],
  controls_shipwright_would_light: [
    "A spec written FROM your existing code — the 84 tests then prove something specific",
    "Test evidence: which requirement each test defends",
    "A security scan on every change, not once",
    "A decision log — the why, next to the what",
  ],
  network_enabled: true,
  network_note: "Nothing of yours was uploaded. Nothing was written to the repo.",
  network_enrichments: ["git clone --depth 1 (public repo)", "gh api — repository metadata (stars, default branch)"],
  schema_version: "1.0",
};
