/*
 * triageHelpDoc.ts — renders every Triage help text as one reviewable
 * Markdown document (iterate-2026-11-09-triage-fixnow-task). The committed
 * copy lives in the spec folder (`.shipwright/planning/01-adopted/
 * triage-help-texts.md`); triageHelpDoc.test.ts fails when it drifts from
 * the code and rewrites it with UPDATE_HELP_DOC=1.
 */

import {
  KNOWN_CHECK_CODES,
  SOURCE_LABELS,
  checkHelp,
  sourceHelp,
  type HelpText,
} from "./triageHelpText";

function entry(h: HelpText, id: string): string {
  return `### ${h.title}  \`${id}\`\n- **What is it:** ${h.what}\n- **Why is it here:** ${h.why}\n- **What Fix now does:** ${h.todo}\n\n`;
}

export function renderHelpDoc(): string {
  let out =
    "# Triage page — help texts for review\n\n" +
    'Shown behind the "?" icons on the Triage page. Source of truth: `client/src/lib/triageHelpText.ts` — ' +
    "edit the wording there; this file is generated from it (a test keeps the two in sync). " +
    "Severities (critical, high, medium, low) have no help marker on purpose.\n\n" +
    "> Drafted prose — not yet verified against the compliance check implementations.\n\n## Sources\n\n";
  for (const k of Object.keys(SOURCE_LABELS)) out += entry(sourceHelp(k), k);
  out += entry(sourceHelp("github", "GitHub security: 3 finding(s)"), "github: security scan summary");
  out += entry(sourceHelp("github", "[pr-ci] PR #1 has 1 failing check(s)"), "github: failing pull-request check");
  out += "## Any other source\n\nSources are free text and differ per project, so every other source shows this generic text.\n\n";
  out += entry(sourceHelp("any-other-source"), "any other source");
  out += "## Audit checks\n\n";
  for (const k of KNOWN_CHECK_CODES) out += entry(checkHelp(k), k);
  return out;
}
