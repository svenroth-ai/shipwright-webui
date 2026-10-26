/*
 * Intent-Wizard STUB reports (A08, AC3 provenance-honesty) — the adopt snapshot
 * and grade ReportModel fixtures, split out of stubData.ts to keep it under the
 * 300-line cap. Same STUB contract as stubData.ts: nothing here is a live reading.
 */

import type { AdoptSnapshot, ReportModel } from "./types";

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
      weight: 0.3,
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
      weight: 0.3,
      score: 0.71,
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
      weight: 0.2,
      score: 1.0,
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
      weight: 0.2,
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
