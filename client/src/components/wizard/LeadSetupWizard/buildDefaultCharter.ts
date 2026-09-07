/*
 * buildDefaultCharter — the charter.md content written for a new lead. Pure
 * so it can be shown verbatim on VerdictStep's "what will be written" group
 * before the user commits, and reused unchanged as the actual write.
 */
import { AUTHORITY_BAND_HEADINGS } from "./types";
import type { LeadSetupAnswers } from "./types";

export function buildDefaultCharter(a: LeadSetupAnswers): string {
  const lines: string[] = [];
  lines.push(`# ${a.name ?? a.leadId ?? "Untitled lead"}`);
  lines.push("");
  lines.push(`Domain: \`${a.domain ?? ""}\``);
  lines.push(`Escalates to: \`${a.escalationTarget ?? ""}\``);
  lines.push("");
  lines.push("## Authority");
  lines.push("");
  for (const heading of AUTHORITY_BAND_HEADINGS) {
    lines.push(`### ${heading}`);
    lines.push("");
    lines.push(a.authorityBands[heading].trim() || "_(not set)_");
    lines.push("");
  }
  return lines.join("\n");
}
