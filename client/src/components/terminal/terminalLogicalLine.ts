/*
 * terminalLogicalLine - builds the LOGICAL line around a buffer row for the file-link provider
 * (FR-01.28): the rows that together hold one wrapped path, as one string plus a per-code-unit map
 * back to buffer cells. READ-ONLY on the buffer.
 *
 * Two kinds of join, per row boundary:
 *  - SOFT  : the terminal itself wrapped (`isWrapped`). Always joined.
 *  - HARD  : an app (Claude's TUI) wrapped its own text with a real newline, so `isWrapped` is false.
 *            Joined ONLY when it is reliably a broken path (see `isHardJoin`); any doubt = not joined.
 */
import type { Terminal } from "@xterm/xterm";

export type LinkTerm = Pick<Terminal, "buffer" | "cols" | "hasSelection">;

/** A logical line longer than this many rows is not scanned at all. */
export const MAX_ROWS = 20;
/** A TUI continuation row may be indented (bullet / quote gutter) by at most this many cells. */
const MAX_HARD_INDENT = 6;

export interface CellPos {
  /** 0-based column of the cell the code unit starts in. */
  x: number;
  /** 1-based buffer row. */
  y: number;
  /** Cell width of the character the code unit belongs to. */
  w: number;
}

export interface LogicalLine {
  text: string;
  pos: CellPos[];
}

interface Unit {
  x: number;
  w: number;
  /** Cell content; "" = a never-written cell. */
  chars: string;
}

type Join = "soft" | "hard";
type Buf = LinkTerm["buffer"]["active"];

const blank = (u: Unit): boolean => u.chars.trim() === "";
const joinChars = (us: Unit[]): string => us.map((u) => u.chars).join("");

function readRow(buf: Buf, row: number, cols: number): Unit[] | undefined {
  const line = buf.getLine(row);
  if (!line) return undefined;
  const out: Unit[] = [];
  for (let x = 0; x < cols; x++) {
    const cell = line.getCell(x);
    if (!cell) break;
    const w = cell.getWidth();
    if (w === 0) continue;
    out.push({ x, w, chars: cell.getChars() });
  }
  return out;
}

// A continuation never starts like a NEW path (drive, root, ./, ../, ~): that is a second path, not the rest of the first.
const NEW_PATH_HEAD = /^(?:[A-Za-z]:[\\/]|[\\/]|\.{1,2}[\\/]|~)/;
const CONT_CHARS = /^[\w.\-\\/@+%~#:]+$/;
const FILE_EXT_TAIL = /\.[A-Za-z][A-Za-z0-9]{0,7}$/;
// An extension after a real name character ("a.ts"), not a dot-directory ("\.shipw").
const NAMED_EXT_TAIL = /[\w-]\.[A-Za-z][A-Za-z0-9]{0,7}$/;

/**
 * True when row `next` is the continuation of a path an app hard-wrapped at the right edge of `prev`:
 * `prev` is filled to the last column and ends in a separator-carrying token (no URL), and `next`
 * (indent <= MAX_HARD_INDENT) opens with one path-like token that is not a new path head and carries a
 * separator or a file extension. Prose, words and two separate paths therefore never merge.
 */
function isHardJoin(prev: Unit[], next: Unit[]): boolean {
  const last = prev[prev.length - 1];
  if (!last || blank(last)) return false;
  let i = prev.length;
  while (i > 0 && !blank(prev[i - 1]!)) i--;
  const tail = joinChars(prev.slice(i));
  if (!/[\\/]/.test(tail) || tail.includes("://")) return false;

  let j = 0;
  while (j < next.length && blank(next[j]!)) j++;
  if (j > MAX_HARD_INDENT || j >= next.length) return false;
  let k = j;
  while (k < next.length && !blank(next[k]!)) k++;
  const head = joinChars(next.slice(j, k)).replace(/[.,;:!?)\]}>"'`]+$/, "");
  if (!head || head.includes("://") || NEW_PATH_HEAD.test(head) || !CONT_CHARS.test(head)) return false;
  // A tail that already ends in a file extension is a complete path (a list of paths / file names), not a
  // broken one. The rare break inside an extension ("a.t|sx") is deliberately given up.
  if (NAMED_EXT_TAIL.test(tail)) return false;
  return /[\\/]/.test(head) || FILE_EXT_TAIL.test(head);
}

/** The logical line holding buffer row `row0` (0-based), or undefined (no such row / over the row cap). */
export function buildLogicalLine(term: LinkTerm, row0: number): LogicalLine | undefined {
  const buf = term.buffer.active;
  const cache = new Map<number, Unit[] | undefined>();
  const rowUnits = (r: number): Unit[] | undefined => {
    if (!cache.has(r)) cache.set(r, readRow(buf, r, term.cols));
    return cache.get(r);
  };
  const joinKind = (prevRow: number, row: number): Join | null => {
    if (prevRow < 0 || !rowUnits(row)) return null;
    if (buf.getLine(row)?.isWrapped) return "soft";
    const p = rowUnits(prevRow);
    const n = rowUnits(row);
    return p && n && isHardJoin(p, n) ? "hard" : null;
  };
  if (!rowUnits(row0)) return undefined;

  let first = row0;
  let last = row0;
  const joins = new Map<number, Join>(); // key = the later row of the boundary
  for (let k = joinKind(first - 1, first); k && last - first < MAX_ROWS; k = joinKind(first - 1, first)) {
    joins.set(first, k);
    first--;
  }
  for (let k = joinKind(last, last + 1); k && last - first < MAX_ROWS; k = joinKind(last, last + 1)) {
    last++;
    joins.set(last, k);
  }
  if (last - first >= MAX_ROWS) {
    // Over the cap (a huge wrapped blob): the hovered row alone, exactly as before any joining existed.
    first = row0;
    last = row0;
    joins.clear();
  }

  let text = "";
  const pos: CellPos[] = [];
  for (let row = first; row <= last; row++) {
    const units = rowUnits(row);
    if (!units) break;
    let from = 0;
    if (joins.get(row) === "hard") while (from < units.length && blank(units[from]!)) from++;
    for (let u = from; u < units.length; u++) {
      const { x, w, chars } = units[u]!;
      // An empty cell at the end of a row that soft-wraps on (a wide char that did not fit) is not a space.
      const c = chars || (row < last && x === term.cols - 1 ? "" : " ");
      for (let i = 0; i < c.length; i++) pos.push({ x, y: row + 1, w });
      text += c;
    }
  }
  return { text, pos };
}
