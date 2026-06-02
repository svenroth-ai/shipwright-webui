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
