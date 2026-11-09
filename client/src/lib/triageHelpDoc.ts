/*
 * triageHelpDoc.ts — renders every Triage help text as one reviewable
 * Markdown document (iterate-2026-11-09-triage-fixnow-task). The committed
 * copy lives in the spec folder (`.shipwright/planning/01-adopted/
 * triage-help-texts.md`); triageHelpDoc.test.ts fails when it drifts from
 * the code and rewrites it with UPDATE_HELP_DOC=1.
 */

import {
  KNOWN_CHECK_CODES,
  SEVERITY_HELP,
  SOURCE_LABELS,
  checkHelp,
  severityHelp,
  sourceHelp,
  type HelpText,
} from "./triageHelpText";

function entry(h: HelpText, id: string): string {
  return `### ${h.title}  \`${id}\`\n- **What is it:** ${h.what}\n- **Why is it here:** ${h.why}\n- **What do I do:** ${h.todo}\n\n`;
}

export function renderHelpDoc(): string {
  let out =
    "# Triage page — help texts for review\n\n" +
    'Shown behind the "?" icons on the Triage page. Source of truth: `client/src/lib/triageHelpText.ts` — ' +
    "edit the wording there; this file is generated from it (a test keeps the two in sync).\n\n" +
    "> Drafted prose — not yet verified against the compliance check implementations.\n\n## Sources\n\n";
  for (const k of Object.keys(SOURCE_LABELS)) out += entry(sourceHelp(k), k);
  out += "## Severities\n\n";
  for (const k of Object.keys(SEVERITY_HELP)) out += entry(severityHelp(k), k);
  out += "## Audit checks\n\n";
  for (const k of KNOWN_CHECK_CODES) out += entry(checkHelp(k), k);
  return out;
}
