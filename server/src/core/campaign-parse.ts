/*
 * campaign-parse.ts — pure parsers for the `campaign.md` producer format
 * (written by `campaign_init.py init_campaign`):
 *
 *   ---
 *   campaign: <slug>
 *   branch_strategy: stacked
 *   created: <iso>
 *   ---
 *   # Campaign: <slug>
 *   ## Intent
 *   <intent text>
 *   ## Sub-Iterates
 *   | ID | Slug | Title | Status |
 *   |---|---|---|---|
 *   | B0 | phase-resolver | Fail-open resolver | pending |
 *
 * Pure string→data — no FS, no side effects — so the producer/consumer
 * boundary is unit-testable in isolation (the boundary probe).
 */

/** Parse a leading `---\n…\n---` frontmatter block into a flat string map. */
export function parseFrontmatter(md: string): Record<string, string> {
  const out: Record<string, string> = {};
  const m = md.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  if (!m) return out;
  for (const line of m[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    if (!key) continue;
    out[key] = line.slice(idx + 1).trim();
  }
  return out;
}

/** Extract the one-line intent from the `## Intent` section (joined, trimmed). */
export function parseIntent(md: string): string {
  const lines = md.split("\n");
  let i = 0;
  for (; i < lines.length; i++) {
    if (/^##\s+Intent\s*$/i.test(lines[i].trim())) break;
  }
  if (i >= lines.length) return "";
  const collected: string[] = [];
  for (i = i + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/^##\s+/.test(t)) break; // next section
    if (t) collected.push(t);
  }
  return collected.join(" ").trim();
}

export interface CampaignTableRow {
  id: string;
  slug: string;
  title: string;
  status: string;
}

/**
 * Forward-compat plan-first / risk marker on a sub-iterate spec file.
 *
 * The CURRENT `campaign_init.py` template writes NO frontmatter (just
 * `# Sub-Iterate:` + `## Scope` + `## Acceptance Criteria`), so this returns
 * `{ planFirst: false }` for every campaign that exists today. It is here so
 * that the day a producer emits `plan_first: true` (or `risk: high`) in a
 * sub-iterate's frontmatter, the WebUI's autonomous-launch guardrail surfaces
 * it WITHOUT a second consumer change — a deliberately forward-compatible read
 * (the producer change is monorepo-owned; see the iterate spec "Out of Scope").
 *
 * Tolerant: any parse failure / missing block → `{ planFirst: false }`, never
 * throws (the 3 s board poll WILL race a half-written file).
 */
const PLAN_FIRST_TRUE: ReadonlySet<string> = new Set(["true", "yes", "1"]);
const RISK_PLAN_FIRST: ReadonlySet<string> = new Set(["high", "plan-first", "plan_first"]);

export function parseSpecFrontmatter(md: string): { planFirst: boolean } {
  let fm: Record<string, string>;
  try {
    fm = parseFrontmatter(typeof md === "string" ? md : "");
  } catch {
    return { planFirst: false };
  }
  const planFirstVal = (fm.plan_first ?? "").trim().toLowerCase();
  const riskVal = (fm.risk ?? "").trim().toLowerCase();
  const planFirst = PLAN_FIRST_TRUE.has(planFirstVal) || RISK_PLAN_FIRST.has(riskVal);
  return { planFirst };
}

/** Parse the `## Sub-Iterates` markdown table rows (header + separator skipped). */
export function parseSubIteratesTable(md: string): CampaignTableRow[] {
  const lines = md.split("\n");
  let i = 0;
  for (; i < lines.length; i++) {
    if (/^##\s+Sub-Iterates\s*$/i.test(lines[i].trim())) break;
  }
  if (i >= lines.length) return [];
  const rows: CampaignTableRow[] = [];
  for (i = i + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/^##\s+/.test(t)) break; // next section
    if (!t.startsWith("|")) continue;
    const inner = t.replace(/^\|/, "").replace(/\|$/, "");
    const cells = inner.split("|").map((c) => c.trim());
    // separator row (cells only of - : space) → skip
    if (cells.every((c) => c === "" || /^:?-+:?$/.test(c))) continue;
    // header row → skip
    if (cells[0]?.toLowerCase() === "id") continue;
    const [id = "", slug = "", title = "", status = ""] = cells;
    if (!id) continue;
    rows.push({ id, slug, title, status: status.toLowerCase() });
  }
  return rows;
}
