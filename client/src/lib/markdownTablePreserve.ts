/*
 * markdownTablePreserve.ts — keep the user's hand-written pipe tables intact
 * through the SmartViewer editor round trip (iterate-2026-11-17-md-editor-table-editing).
 *
 * The editor always serializes a table in compact form (`| a | b |`). A source
 * table that was column-aligned (`| Name   | Wert |`) therefore came back
 * re-flowed, and the pre-save diff showed the WHOLE table as changed even when
 * the user touched none of it. Two rules fix that:
 *   1. a table the user did not change is written back as its ORIGINAL source;
 *   2. a table the user did change is written padded when the original table at
 *      that position was padded, so the diff shows only the rows that really differ.
 * "Unchanged" is judged against a BASELINE (the editor's own serialization right
 * after load), so editor-side normalisation (`*i*` -> `_i_`) cannot masquerade as
 * a user edit. Every case that cannot be mapped confidently falls back to the
 * editor's output, which the pre-save diff always shows.
 */

interface TableBlock {
  start: number; // first line index
  end: number; // one past the last line index
  lines: string[];
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const DELIMITER_CELL = /^:?-{1,}:?$/;

/** Split a pipe-table row into trimmed cells; `\|` does not split. */
export function splitRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === "\\" && i + 1 < t.length) {
      cur += c + t[i + 1];
      i++;
    } else if (c === "|") {
      cells.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

function isDelimiterRow(line: string): boolean {
  if (!line.trim().startsWith("|")) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((c) => DELIMITER_CELL.test(c));
}

/** Column-0 pipe tables outside fenced code. Nested/indented tables are left alone. */
export function extractPipeTables(text: string): TableBlock[] {
  const lines = text.split("\n");
  const out: TableBlock[] = [];
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const f = FENCE.exec(lines[i]);
    if (f) {
      if (fence === null) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    if (!lines[i].startsWith("|") || i + 1 >= lines.length || !isDelimiterRow(lines[i + 1]) || !lines[i + 1].startsWith("|")) continue;
    let j = i + 2;
    while (j < lines.length && lines[j].startsWith("|")) j++;
    out.push({ start: i, end: j, lines: lines.slice(i, j) });
    i = j - 1;
  }
  return out;
}

/** Whitespace/padding-insensitive identity of a table's content + alignment. */
function tableKey(lines: string[]): string {
  return lines
    .map((l, i) => {
      const cells = splitRow(l);
      return (i === 1 ? cells.map((c) => (c.startsWith(":") ? "L" : "-") + (c.endsWith(":") ? "R" : "-")) : cells).join("\u0001");
    })
    .join("\u0002");
}

/** True when the author column-aligned the table: any body/header row has two or
 *  more spaces before a pipe, or the delimiter row has dash runs longer than the
 *  compact `---`. Ragged rows (one cell outgrew its column) still count. */
function isPadded(lines: string[]): boolean {
  if (lines.length < 2) return false;
  return lines.some((l, i) => (i === 1 ? splitRow(l).some((c) => c.replace(/:/g, "").length > 3) : / {2,}\|/.test(l)));
}

/** Re-write a table with every column padded to its widest cell. Cell text is
 *  padded on the right (on the left for right-aligned columns), the way tables
 *  are written by hand; centering only happens in the delimiter row. */
export function padTable(lines: string[]): string[] {
  const rows = lines.map(splitRow);
  const align = rows[1].map((c) => (c.startsWith(":") && c.endsWith(":") ? "C" : c.endsWith(":") ? "R" : c.startsWith(":") ? "L" : "-"));
  const width = rows[0].map((_, col) =>
    Math.max(3, ...rows.map((r, ri) => (ri === 1 ? 3 : (r[col] ?? "").length))),
  );
  const fmt = (r: string[], ri: number) =>
    "| " +
    width
      .map((w, col) => {
        const cell = r[col] ?? "";
        if (ri === 1) {
          const a = align[col];
          if (a === "C") return ":" + "-".repeat(w - 2) + ":";
          if (a === "R") return "-".repeat(w - 1) + ":";
          if (a === "L") return ":" + "-".repeat(w - 1);
          return "-".repeat(w);
        }
        const gap = w - cell.length;
        if (align[col] === "R") return " ".repeat(gap) + cell;
        return cell + " ".repeat(gap);
      })
      .join(" | ") +
    " |";
  return rows.map(fmt);
}

/**
 * @param original  the file body the editor loaded (frontmatter stripped)
 * @param baseline  the editor's serialization right after loading `original`
 * @param current   the editor's serialization now
 */
export function restoreUntouchedTables(original: string, baseline: string, current: string): string {
  // The original may carry CRLF; the serializer is LF-only and the envelope re-maps on compose.
  const O = extractPipeTables(original.split(String.fromCharCode(13)).join(""));
  const B = extractPipeTables(baseline);
  const C = extractPipeTables(current);
  if (C.length === 0 || O.length === 0 || O.length !== B.length) return current;

  const keyB = B.map((t) => tableKey(t.lines));
  const lines = current.split("\n");
  let cursor = 0;
  // Replace back-to-front so earlier indices stay valid.
  const replacements: Array<{ t: TableBlock; with: string[] }> = [];
  for (const t of C) {
    const key = tableKey(t.lines);
    let hit = -1;
    for (let i = cursor; i < keyB.length; i++) {
      if (keyB[i] === key) {
        hit = i;
        break;
      }
    }
    // A source table whose row count differs from the editor's (a lazy row without a
    // leading pipe) would lose that row if restored verbatim: keep the editor output.
    if (hit >= 0 && O[hit].lines.length === B[hit].lines.length) {
      cursor = hit + 1;
      replacements.push({ t, with: O[hit].lines });
    } else if (cursor < O.length && isPadded(O[cursor].lines)) {
      // Edited (or new) table: follow the style of the original table at this position.
      replacements.push({ t, with: padTable(t.lines) });
    }
  }
  for (const r of replacements.reverse()) lines.splice(r.t.start, r.t.end - r.t.start, ...r.with);
  return lines.join("\n");
}
