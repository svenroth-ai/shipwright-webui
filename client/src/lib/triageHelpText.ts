/*
 * triageHelpText.ts — plain-English help for the Triage page
 * (iterate-2026-11-08-triage-page-redesign, reworded in
 * iterate-2026-11-09-triage-polish-r3 after an Opus readability review). Each
 * entry answers three questions: what is it, why is it here, and what does
 * Fix now do about it. The wording is written for a technically minded reader
 * who is not a developer: no unexplained abbreviations, short sentences.
 *
 * Sources are free text and differ per project, so only the sources the
 * Shipwright framework itself produces for EVERY project have an entry here.
 * Anything else (a campaign label, a session name, a customer-specific tag)
 * gets the generic text — never add a project-specific source to this file.
 * Severities (critical … info) carry no help: the words explain themselves.
 *
 * `KNOWN_CHECK_CODES` is the single list the coverage test iterates; the
 * test also scans the repo's real triage fixtures so a code that shows up in
 * practice but has no text here fails the build.
 */

import { CHECK_HELP } from "./triageCheckHelp";

export interface HelpText {
  title: string;
  what: string;
  why: string;
  /** What pressing Fix now on this item starts. */
  todo: string;
}

/** Display names for the framework's own sources; any other source shows as written. */
export const SOURCE_LABELS: Record<string, string> = {
  compliance: "Compliance",
  phaseQuality: "Phase quality",
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
  what: "Reported by a tool or a working session in this project.",
  why: "This app has no built-in explanation for this source. The card's own text describes the problem.",
  todo: "Fix now starts a task that uses the title and description as its brief. Open the card to read the details first.",
};

const GITHUB_SECURITY_WHY = "GitHub reported these outside this app. One card collects the findings of one scan so none is lost.";
const GITHUB_SECURITY_TODO =
  "Fix now starts a task that reviews the findings, most serious first, and fixes what it safely can.";

/** The kinds of security finding named in a roll-up's detail line, in plain words. */
function securityKinds(detail: string): string[] {
  const kinds: string[] = [];
  const has = (key: string) => new RegExp(`${key}:\\s*(?!\\(unavailable\\)|0\\b)\\S`, "i").test(detail);
  if (has("code-scanning")) kinds.push("code scanning (code patterns an attacker could abuse)");
  if (has("dependabot")) kinds.push("dependency alerts (a third-party library with a known security hole)");
  if (has("secret-scanning")) kinds.push("secret scanning (a password or key saved in the code)");
  if (has("shipwright-security")) kinds.push("the project's own security check");
  return kinds;
}

function githubSecurity(detail?: string): Omit<HelpText, "title"> {
  const kinds = securityKinds(detail ?? "");
  return {
    what: kinds.length
      ? `Security scan results from GitHub: ${kinds.join("; ")}.`
      : "Security scan results reported by GitHub for this project.",
    why: GITHUB_SECURITY_WHY,
    todo: GITHUB_SECURITY_TODO,
  };
}

const GITHUB_PR_CHECK: Omit<HelpText, "title"> = {
  what: "A pull request (a proposed change) has an automatic check on GitHub that fails.",
  why: "A failing check usually keeps the change from being merged.",
  todo: "Fix now starts a task that finds out why the check fails and tries to fix it.",
};

const GITHUB_OTHER: Omit<HelpText, "title"> = {
  what: "A finding reported by GitHub.",
  why: "It happened outside this app and is kept here so it is not lost.",
  todo: "Fix now starts a task that uses the title and description as its brief.",
};

const SOURCE_HELP: Record<string, Omit<HelpText, "title">> = {
  compliance: {
    what: "A regular health check compared the project's requirements, code, tests and documents and found gaps.",
    why: "All open findings of one check run sit on this card. It stays until the gaps are closed or you decide they are fine.",
    todo: "Fix now starts a task that works through the findings on this card. For single lines use Promote (turn it into a planned task) or Dismiss (ignore it).",
  },
  phaseQuality: {
    what: "A finished step of the project's build process (a phase) is missing a required record, such as its completion note or changelog entry.",
    why: "The phase shows as done, but the project's own quality check found that bookkeeping step missing.",
    todo: "Fix now starts a short task that writes the missing record.",
  },
  manual: {
    what: "Added by a person, or by an AI work session on their behalf, not by an automatic check.",
    why: "Somebody decided it was worth keeping.",
    todo: "Fix now starts a task from this note, using its text as the brief.",
  },
  operator: {
    what: "A note or request you added yourself.",
    why: "You decided it should be kept, even though no automatic check found it.",
    todo: "Fix now starts a task from this note, using its text as the brief.",
  },
  drift: {
    what: "The project's documentation and the files on disk no longer match.",
    why: "A file or folder exists that the documentation does not mention, or the other way round.",
    todo: "Fix now starts a task that updates the documentation to match, or removes the file if it is a leftover.",
  },
  "required-checks": {
    what: "Some automatic checks run on every change but are not marked as must-pass for merging.",
    why: "Because they are not required, a failing check would not stop a change from being merged.",
    todo: "Fix now starts a task that adds them to the must-pass list, or marks them as optional on purpose.",
  },
};

/**
 * Help for a source. `title` and `detail` (the item's own headline and body)
 * let the GitHub source tell a security scan summary from a failing
 * pull-request check, and name which kinds of finding a scan summary holds.
 * Unknown sources get the generic text.
 */
export function sourceHelp(source: string, title?: string, detail?: string): HelpText {
  if (source === "github") {
    const t = title ?? "";
    const body = /security/i.test(t)
      ? githubSecurity(detail)
      : /^\[pr-ci\]|failing check/i.test(t)
        ? GITHUB_PR_CHECK
        : GITHUB_OTHER;
    return { title: sourceLabel(source), ...body };
  }
  return { title: sourceLabel(source), ...(SOURCE_HELP[source] ?? GENERIC_SOURCE) };
}

/** Every code with an explicit text — what the coverage test iterates. */
export const KNOWN_CHECK_CODES: readonly string[] = Object.keys(CHECK_HELP);

const GENERIC_CHECK: Omit<HelpText, "title"> = {
  what: "One check of an audit failed.",
  why: "The audit compares the project's records and lists every gap it finds.",
  todo: "Fix now starts a task that works on this line. Open the item and read the line for the detail.",
};

/** Help for one audit-check code; never throws, unknown codes get a generic text. */
export function checkHelp(code: string, fallbackTitle?: string): HelpText {
  return CHECK_HELP[code] ?? { title: fallbackTitle ?? code, ...GENERIC_CHECK };
}
