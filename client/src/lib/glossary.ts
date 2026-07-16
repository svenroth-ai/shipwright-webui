/*
 * Plain-language glossary — one source, no drift (A07 / FR-01.50).
 *
 * A single bank of the jargon the Command Center surfaces (framework terms
 * like IREB / ADR / RTM / SBOM, the pipeline phases, and the two mid-run
 * prompt kinds), each with a ONE-LINE plain-language explanation shown exactly
 * where the term appears (JIT tooltips + teaching empty states).
 *
 * Wording rules (load-bearing — a test asserts them verbatim):
 *   - Framework terms copy the monorepo Plain-Language Index word-for-word
 *     (`shipwright/docs/guide.md` Appendix A). One source, no paraphrase.
 *   - The two UI-prompt glosses (AskUserQuestion / approval gate) copy the
 *     approved prototype (`Spec/prototype/screens/inbox.js`) verbatim.
 *
 * This module is PLAIN DATA + a lookup. No React, no component logic — so it
 * can feed a `title` attribute, an empty-state sentence, or a future overlay
 * without dragging in rendering concerns.
 */

/** term (canonical casing) → one-line plain-language explanation. */
export const GLOSSARY: Readonly<Record<string, string>> = {
  // ── Framework terms — VERBATIM from guide.md Appendix A "Plain-Language Index".
  IREB:
    "Description of what the app should do, who it's for, and what it must not do",
  Spec: "Description of what the app should do, who it's for, and what it must not do",
  ADR: "Log of architectural decisions with rationale (why this database, why this pattern)",
  RTM: "Coverage matrix where every requirement points at the test that proves it",
  SBOM: "Inventory of every third-party component in the app, for license and CVE tracking",
  "Conventional Commits":
    "Standardized commit-message format (feat:, fix:, etc.) so version history is machine-readable",
  Gate: "A checkpoint between two pipeline steps where output is verified before the next step starts",
  Harness:
    "The whole system of guides (Specs, Conventions) and sensors (Tests, Reviews, Scanners) that steers AI output before and after generation",

  // ── Mid-run prompt kinds — VERBATIM from Spec/prototype/screens/inbox.js glosses.
  AskUserQuestion:
    "A mid-run prompt where the pipeline pauses to ask you a multiple-choice question before continuing.",
  "approval gate":
    "A checkpoint where the pipeline pauses for your approval before it continues.",

  // ── Requirements / process terms not in the plain-language index (kept honest + concise).
  FR: "A single numbered requirement — one thing the app must do, tracked from spec to test.",
  Canon: "The minimum set of checks every pipeline phase must pass before the next one starts.",

  // ── Pipeline phases (the chips in the create dialog) — concise, from the
  //    framework command reference (guide.md Appendix B). Keyed by phase id.
  adopt:
    "Onboard an existing repo into Shipwright — analyze its stack, routes, and conventions, then write the agent docs.",
  project: "Break requirements into shippable splits and write the IREB-aligned specs.",
  design: "Generate HTML mockups from the specs, with a review viewer and feedback loop.",
  plan: "Turn one split's spec into an implementation plan — research the stack, then write the section files.",
  build: "Implement one section test-first — a failing test, the code, a review, then a Conventional Commit.",
  test: "Run the full test suite — unit, integration, RLS, smoke, and end-to-end.",
  deploy: "Ship through the project's deploy profile — smoke-tested, and rolled back on failure.",
  changelog:
    "Turn the Conventional Commits since the last release into a changelog entry and a version tag.",
  compliance:
    "A cross-artifact audit that catches drift between the config, the event log, and the docs.",
  security: "Run a security scan, classify the findings, and loop a fixer over them.",
};

/** Lowercased key → canonical key, for case-insensitive lookup. */
const NORMALIZED: ReadonlyMap<string, string> = new Map(
  Object.keys(GLOSSARY).map((k) => [k.toLowerCase(), k]),
);

/**
 * Look up a term's one-line explanation, case-insensitively. Returns
 * `undefined` for an unknown term so callers can render `title={undefined}`
 * (no attribute) rather than an empty tooltip.
 */
export function glossaryLookup(term: string | null | undefined): string | undefined {
  if (!term) return undefined;
  const canonical = NORMALIZED.get(term.toLowerCase());
  return canonical ? GLOSSARY[canonical] : undefined;
}
