/*
 * compliance-dimensions.ts — parse the Control-Verdict dimension table into
 * structured sub-scores (A16, FR-01.60, campaign webui-wow-usability-2026-07-10).
 *
 * Split out of `compliance-reader.ts` (which stays a lean grade/verdict/slice
 * reader under the 300-LOC ceiling): the Ship's-Log Captain's Drawer needs the
 * dimensions as DATA, not just the raw markdown slice the detail modal renders.
 *
 * Honesty is the hard contract (spec AC2):
 *   - Absent table → `[]`. Malformed table → `[]`. NEVER a throw.
 *   - `pct` (the mini-bar height) is DERIVED FROM THE DASHBOARD'S OWN
 *     PER-DIMENSION VERDICT (the ✅/⚠️/❌ status glyph), NOT from a fraction
 *     scraped out of the free-text signal. Signals phrase fractions
 *     inconsistently ("43/44 covered" is good-over-total, "1/25 not
 *     re-verified" is bad-over-total), so a scraped ratio would render a
 *     dishonest bar. `pct` is `null` when the glyph is unrecognized — the
 *     consumer then shows NO bar, never a fabricated 100%.
 */

export interface ComplianceDimension {
  /** Slug of the label — stable key for React lists. */
  key: string;
  /** Dimension name (table column "Dimension"), e.g. "Test health". */
  label: string;
  /** The full "Signal" cell, verbatim — the honest detail (tooltip/modal). */
  value: string;
  /** Health from the row's ✅/⚠️/❌ verdict glyph; `null` when unrecognized. */
  pct: number | null;
  /** The "Anchor" cell — the open standard the dimension follows. */
  doc: string;
}

/**
 * Health percentage from a Control-Verdict row's status glyph. The dashboard
 * marks each dimension ✅ (under control) / ⚠️ (warning) / ❌ (failing); we
 * mirror that verdict as a bar height rather than inventing a numeric score.
 */
function pctFromStatus(status: string): number | null {
  if (/[✅✔☑🟢]/u.test(status)) return 100;
  if (/[⚠🟡🟠]/u.test(status)) return 60;
  if (/[❌✖🔴⛔]/u.test(status)) return 25;
  return null;
}

function slug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** A markdown pipe-table row → trimmed cells (outer empties from the leading/
 *  trailing `|` dropped). Returns `null` for a line that is not a table row. */
function pipeCells(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  const parts = trimmed.split("|");
  // Leading + trailing `|` produce empty first/last members — drop them.
  return parts.slice(1, -1).map((c) => c.trim());
}

const SEPARATOR_CELL_RE = /^:?-{2,}:?$/;

/**
 * Parse the Control-Verdict dimension table into structured rows. Column-driven
 * (not positional) so a reordered producer table still resolves
 * Dimension/Signal/Anchor by header name; the status glyph is read from
 * whatever leading column the header did not name. Absent/malformed → `[]`.
 */
export function parseDimensions(controlVerdictMarkdown: string): ComplianceDimension[] {
  try {
    const lines = controlVerdictMarkdown.split("\n");
    let headerIdx = -1;
    let cols: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const cells = pipeCells(lines[i] ?? "");
      if (!cells) continue;
      const lower = cells.map((c) => c.toLowerCase());
      if (lower.includes("dimension") && lower.includes("signal")) {
        headerIdx = i;
        cols = lower;
        break;
      }
    }
    if (headerIdx === -1) return [];

    const dimIdx = cols.indexOf("dimension");
    const sigIdx = cols.indexOf("signal");
    const anchorIdx = cols.indexOf("anchor");
    // The status column is the first header cell that names none of the above
    // (the dashboard's leading glyph column has an empty header).
    const named = new Set([dimIdx, sigIdx, anchorIdx]);
    let statusIdx = -1;
    for (let i = 0; i < cols.length; i++) {
      if (!named.has(i)) {
        statusIdx = i;
        break;
      }
    }

    const dimensions: ComplianceDimension[] = [];
    const seen = new Set<string>();
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const cells = pipeCells(lines[i] ?? "");
      if (!cells) break; // table ended (first non-`|` line)
      if (cells.every((c) => c === "" || SEPARATOR_CELL_RE.test(c))) continue; // separator
      const label = (dimIdx >= 0 ? cells[dimIdx] : "")?.trim() ?? "";
      if (!label) continue;
      const value = (sigIdx >= 0 ? cells[sigIdx] : "")?.trim() ?? "";
      const doc = (anchorIdx >= 0 ? cells[anchorIdx] : "")?.trim() ?? "";
      const status = (statusIdx >= 0 ? cells[statusIdx] : "")?.trim() ?? "";
      let key = slug(label) || `dim-${dimensions.length}`;
      while (seen.has(key)) key = `${key}-${dimensions.length}`;
      seen.add(key);
      dimensions.push({ key, label, value, pct: pctFromStatus(status), doc });
    }
    return dimensions;
  } catch {
    // Malformed table must degrade to [] — never throw (spec AC2 / test plan).
    return [];
  }
}
