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

/**
 * Strip inline Markdown emphasis / code markers from a table cell value.
 * Producers bold the ID column (`**C1**`) and decorate titles with bold + code
 * spans. The plain text is what the consumer needs — most critically for the
 * ID, which is load-bearing: it forms the `<id>-<slug>.md` spec filename, so a
 * literal `**C1**` resolves to a non-existent file → null specPath → a dead
 * Copy-launch button on the board. Conservative + paired-only: code spans
 * first, then bold (`**` / `__`) BEFORE italic (`*` / `_`) so `**x**` collapses
 * in one pass. Leaves hyphens, arrows, and unpaired markers (e.g. the single
 * `_` in `group_a5`) untouched.
 */
function stripInlineEmphasis(s: string): string {
  return s
    .replace(/`([^`]*)`/g, "$1") // `code`
    .replace(/\*\*([^*]+)\*\*/g, "$1") // **bold**
    .replace(/__([^_]+)__/g, "$1") // __bold__
    .replace(/\*([^*]+)\*/g, "$1") // *italic*
    .replace(/_([^_]+)_/g, "$1") // _italic_
    .trim();
}

/**
 * Parse the `## Sub-Iterates` markdown table.
 *
 * Header-driven, not positional: the producer table has evolved from the
 * original `| ID | Slug | Title | Status |` to optionally include `Repo` /
 * `Depends on` columns and to bold the ID cell (the verbatim
 * `2026-06-02-compliance-detective-realign` campaign is `| ID | Slug | Title |
 * Repo | Depends on | Status |` with `**C1**` IDs). Locating the load-bearing
 * columns by header name keeps `status` anchored to the Status column instead
 * of whatever now sits in the 4th cell, and every cell is emphasis-stripped so
 * a bold ID round-trips to a real `<id>-<slug>.md` filename. Falls back to
 * positional `[id, slug, title, status]` for a (hypothetical) headerless table.
 */
export function parseSubIteratesTable(md: string): CampaignTableRow[] {
  const lines = md.split("\n");
  let i = 0;
  for (; i < lines.length; i++) {
    if (/^##\s+Sub-Iterates\s*$/i.test(lines[i].trim())) break;
  }
  if (i >= lines.length) return [];

  // Collect every pipe row (emphasis-stripped cells); drop separator rows.
  const pipeRows: string[][] = [];
  for (i = i + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/^##\s+/.test(t)) break; // next section
    if (!t.startsWith("|")) continue;
    const inner = t.replace(/^\|/, "").replace(/\|$/, "");
    const cells = inner.split("|").map((c) => stripInlineEmphasis(c.trim()));
    // separator row (cells only of - : space) → skip
    if (cells.every((c) => c === "" || /^:?-+:?$/.test(c))) continue;
    pipeRows.push(cells);
  }
  if (pipeRows.length === 0) return [];

  // First non-separator row is the header when it carries an `ID` column.
  const header = pipeRows[0].map((c) => c.toLowerCase());
  const hasHeader = header.includes("id");
  const colOf = (name: string, dflt: number): number => {
    const idx = header.indexOf(name);
    return idx === -1 ? dflt : idx;
  };
  const idCol = hasHeader ? colOf("id", 0) : 0;
  const slugCol = hasHeader ? colOf("slug", 1) : 1;
  const titleCol = hasHeader ? colOf("title", 2) : 2;
  // status is conventionally the last column; default to the final cell.
  const statusCol = hasHeader ? colOf("status", header.length - 1) : 3;
  const dataStart = hasHeader ? 1 : 0;

  const rows: CampaignTableRow[] = [];
  for (let r = dataStart; r < pipeRows.length; r++) {
    const cells = pipeRows[r];
    const id = cells[idCol] ?? "";
    if (!id) continue;
    rows.push({
      id,
      slug: cells[slugCol] ?? "",
      title: cells[titleCol] ?? "",
      status: (cells[statusCol] ?? "").toLowerCase(),
    });
  }
  return rows;
}
