/*
 * triageFindings.ts — reads the per-check lines out of a bundled triage
 * item's `detail` (iterate-2026-11-08-triage-page-redesign).
 *
 * Real shapes (from the project's triage log):
 *   compliance:   "- B/B7: <title> — <detail> | hint: <command>"
 *   phaseQuality: "- C1 <title>" / "- C1: <title>"
 * Anything that does not look like such a line is ignored; when no line
 * parses, `parseFindings` returns `[]` and the caller shows the raw detail,
 * so a finding is never silently dropped.
 */

export interface TriageFinding {
  code: string;
  title: string;
  detail: string | null;
  hint: string | null;
}

const LINE = /^-\s+([A-Z]\/[A-Za-z0-9.?-]+|[A-Z]\d+(?:\.\d+)?)(?::\s*|\s+)(.+)$/;

export function parseFindings(detail: string): TriageFinding[] {
  const out: TriageFinding[] = [];
  for (const raw of detail.split(/\r?\n/)) {
    const m = LINE.exec(raw.trim());
    if (!m) continue;
    let rest = m[2];
    let hint: string | null = null;
    const h = rest.indexOf(" | hint:");
    if (h >= 0) {
      hint = rest.slice(h + " | hint:".length).trim() || null;
      rest = rest.slice(0, h);
    }
    const dash = rest.indexOf(" — ");
    const title = (dash >= 0 ? rest.slice(0, dash) : rest).trim();
    const more = dash >= 0 ? rest.slice(dash + 3).trim() : "";
    out.push({ code: m[1], title, detail: more || null, hint });
  }
  return out;
}
