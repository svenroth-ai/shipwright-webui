/*
 * triageHelpText.ts — plain-English help for the Triage page
 * (iterate-2026-11-08-triage-page-redesign). Each entry answers three
 * questions: what is it, why is it here, what do I do. Wording is the
 * operator-approved draft from the design proposal; unknown codes and
 * sources never error — they fall back to a generic text.
 *
 * `KNOWN_CHECK_CODES` is the single list the coverage test iterates; the
 * test also scans the repo's real triage fixtures so a code that shows up in
 * practice but has no text here fails the build.
 */

export interface HelpText {
  title: string;
  what: string;
  why: string;
  todo: string;
}

export const SOURCE_LABELS: Record<string, string> = {
  compliance: "Compliance",
  phaseQuality: "Phase quality",
  req3: "Campaign",
  "req3-campaign": "Campaign",
  tooling: "Tooling",
  manual: "Manual",
  operator: "Operator",
  github: "GitHub",
  drift: "Drift",
  "required-checks": "Required checks",
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

const GENERIC_SOURCE: Omit<HelpText, "title"> = {
  what: "Created by a tool or a session.",
  why: "Kept here so it is not lost.",
  todo: "Open the item for details.",
};

const SOURCE_HELP: Record<string, Omit<HelpText, "title">> = {
  compliance: {
    what: "A recurring audit found gaps between requirements, code, tests and docs.",
    why: "One card bundles all open findings of one audit run. It does not go away on its own.",
    todo: "Open the lines below. Promote the real gaps, dismiss the ones that are intended.",
  },
  phaseQuality: {
    what: "A finished phase skipped a mandatory record (event or changelog entry).",
    why: "The phase is marked done, but a quality check disagrees.",
    todo: "Fix now repairs the record.",
  },
  req3: {
    what: "Created by a campaign: a planned work package.",
    why: "The campaign wants a decision here before it continues.",
    todo: "Start the campaign, or park it until you are ready.",
  },
  tooling: {
    what: "A problem noticed in the Shipwright tooling itself.",
    why: "Found while working on something else and kept so it is not lost.",
    todo: "Fix it now if it blocks you, otherwise park it.",
  },
  manual: {
    what: "Added by hand, from you or from a session.",
    why: "Nothing detected it; a person decided to keep it.",
    todo: "Promote it when you are ready to work on it.",
  },
  operator: {
    what: "A note or request you (the operator) added yourself.",
    why: "You decided it should be kept, even though no check found it.",
    todo: "Promote it when you are ready to work on it, or dismiss it if it is done.",
  },
  github: {
    what: "A finding from GitHub: a security scan roll-up or a failing check on a pull request.",
    why: "It happened outside this app and is kept here so it is not lost.",
    todo: "Check high severities first. Fix now starts a security task.",
  },
  drift: {
    what: "Documentation and the files on disk disagree.",
    why: "A file exists that the docs do not list, or the other way round.",
    todo: "Update the docs or remove the stray file.",
  },
  "required-checks": {
    what: "A check runs but does not block merging because it is not marked as required.",
    why: "The set of must-pass checks does not match the checks that actually run.",
    todo: "Add the check to the required set, or remove it.",
  },
};

/** Source spellings that share one help text (the label already merges them). */
const SOURCE_HELP_ALIAS: Record<string, string> = { "req3-campaign": "req3" };

export function sourceHelp(source: string): HelpText {
  const key = SOURCE_HELP_ALIAS[source] ?? source;
  return { title: sourceLabel(source), ...(SOURCE_HELP[key] ?? GENERIC_SOURCE) };
}

export const SEVERITY_HELP: Record<string, string> = {
  critical: "Act now. Can endanger data, security or delivery.",
  high: "Fix soon. Noticeable damage or risk.",
  medium: "Plan it. No acute damage.",
  low: "A small improvement.",
  info: "For your information only.",
};

export function severityHelp(severity: string): HelpText {
  const word = severity.charAt(0).toUpperCase() + severity.slice(1);
  return {
    title: `${word} severity`,
    what: SEVERITY_HELP[severity] ?? "How serious the finding is.",
    why: "The tool that found it rates how much damage or risk it carries.",
    todo: "Higher severity is handled earlier. Change it with the pencil if the rating is off.",
  };
}

const STALE_REPORT: Omit<HelpText, "title"> = {
  what: "A generated report is out of date.",
  why: "The source it is built from changed after the report was last produced.",
  todo: "Regenerate it. No change in the code is needed.",
};

const CHECK_HELP: Record<string, HelpText> = {
  "A/A5.0": {
    title: "Audit setup problem",
    what: "The audit could not run one of its own setup steps, for example a missing tool on this machine.",
    why: "Without that step some checks cannot be evaluated.",
    todo: "Install the missing tool named in the line and run the audit again.",
  },
  "A/A5.6": {
    title: "Audit setup problem",
    what: "A setup check of the audit failed.",
    why: "The audit could not trust its own inputs.",
    todo: "Read the line for the cause and fix the setup.",
  },
  "B/B7": {
    title: "Commits not in the project log",
    what: "Some commits since the last release have no matching entry in the project log, usually changes made outside an iterate.",
    why: "It is one line of an audit that found it.",
    todo: "Add the missing entries, or dismiss if the commits are intentional.",
  },
  "C/C1": {
    title: "Requirement without plan or design",
    what: "A requirement has no link to a plan or a design.",
    why: "It is one line of an audit that found it.",
    todo: "Add the missing plan or design reference.",
  },
  "D/D-layer": {
    title: "Test missing at a required level",
    what: "A requirement has no passing test at a level it must be tested at, for example only unit tests and no browser test.",
    why: "The requirement declares the levels it needs.",
    todo: "Add and run the missing test, or correct the declared levels.",
  },
  "D/D-orphan": {
    title: "Test without a requirement",
    what: "A test refers to a requirement that no longer exists or is not named.",
    why: "It is one line of an audit that found it.",
    todo: "Re-tag the test or remove it.",
  },
  "D/D1": {
    title: "Requirement never worked on",
    what: "Requirements exist for which the project log shows no work at all.",
    why: "It is one line of an audit that found it.",
    todo: "Plan the work, or retire the requirement.",
  },
  "D/D2": {
    title: "Requirement changed without follow-up",
    what: "A requirement changed after its last recorded work.",
    why: "It is one line of an audit that found it.",
    todo: "Check whether the work still matches, then re-confirm it.",
  },
  "D/D3": {
    title: "Promised requirements not delivered",
    what: "Requirements marked as promised are not delivered yet.",
    why: "It is one line of an audit that found it.",
    todo: "Check the list, deliver or re-plan.",
  },
  "D/D4": {
    title: "Last work on a requirement had failing tests",
    what: "The latest recorded work for a requirement ended with red tests.",
    why: "It is one line of an audit that found it.",
    todo: "Fix the tests and record a new passing run.",
  },
  "D/D5": {
    title: "Change not linked to a requirement",
    what: "A feature or change is not linked to any requirement.",
    why: "It is one line of an audit that found it.",
    todo: "Link it to the right requirement, or record that it changes none.",
  },
  "E/E1": { title: "Traceability report out of date", ...STALE_REPORT },
  "E/E2": { title: "Test evidence report out of date", ...STALE_REPORT },
  "E/E3": { title: "Change history out of date", ...STALE_REPORT },
  "E/E4": { title: "Software bill of materials out of date", ...STALE_REPORT },
  "E/E5": { title: "Compliance dashboard out of date", ...STALE_REPORT },
  "F/F4": {
    title: "Oversized decision records",
    what: "Some decision records are very long and have no link to a spec.",
    why: "It is one line of an audit that found it.",
    todo: "Split each into its own file and link it.",
  },
  "F/F5": {
    title: "Architecture note marker missing",
    what: "The architecture document has no marker although architecture notes exist.",
    why: "It is one line of an audit that found it.",
    todo: "Run the first architecture sync to set a baseline.",
  },
  "F/F6": {
    title: "Project instructions too long",
    what: "The project instruction file grew past its size cap.",
    why: "Long instructions are read less reliably.",
    todo: "Move the detail into separate files and shorten it.",
  },
  "G/G2": {
    title: "Unknown commit scope",
    what: "A commit uses a scope (for example 'standalone') that matches no known area.",
    why: "It is one line of an audit that found it.",
    todo: "Rename the scope or add it to the alias map.",
  },
  "H/H1": {
    title: "File too large, not in baseline",
    what: "A source file grew past the size limit and is not on the allowed list.",
    why: "It is one line of an audit that found it.",
    todo: "Split the file.",
  },
  "H/H2": {
    title: "Baseline can be lowered",
    what: "A file is now smaller than its allowed limit, so the limit can be tightened.",
    why: "It is one line of an audit that found it.",
    todo: "Lower the baseline entry.",
  },
  "H/H6": {
    title: "Size baseline problem",
    what: "The list of allowed file sizes has an entry that no longer matches.",
    why: "It is one line of an audit that found it.",
    todo: "Correct or remove the entry.",
  },
  "I/I5": {
    title: "Audit housekeeping",
    what: "A housekeeping check of the audit found something to tidy.",
    why: "It is one line of an audit that found it.",
    todo: "Read the line for the detail.",
  },
  C1: {
    title: "Phase-completed event missing",
    what: "The phase finished without writing its completion event.",
    why: "The phase is marked done, but a quality check disagrees.",
    todo: "Run the record command named in the hint.",
  },
  C5: {
    title: "Changelog entry missing",
    what: "The changelog has no 'Added' entry for this phase.",
    why: "The phase is marked done, but a quality check disagrees.",
    todo: "Prepend an entry.",
  },
  W3: {
    title: "Work-completed event missing",
    what: "The phase finished without recording its work-completed event.",
    why: "The phase is marked done, but a quality check disagrees.",
    todo: "Run the record command named in the hint.",
  },
};

/** Every code with an explicit text — what the coverage test iterates. */
export const KNOWN_CHECK_CODES: readonly string[] = Object.keys(CHECK_HELP);

const GENERIC_CHECK: Omit<HelpText, "title"> = {
  what: "One check of an audit failed.",
  why: "It is one line of an audit that found it.",
  todo: "Open the item and read the line for the detail.",
};

/** Help for one audit-check code; never throws, unknown codes get a generic text. */
export function checkHelp(code: string, fallbackTitle?: string): HelpText {
  return CHECK_HELP[code] ?? { title: fallbackTitle ?? code, ...GENERIC_CHECK };
}
