/*
 * doc-bullets.ts — architecture / convention / learning bullets as per-run drop
 * files (events-drop-files, issue 978, unit S5b). TS twin of shipwright
 * `shared/scripts/lib/doc_bullets.py` + the entry helpers of `agent_doc_budget.py`.
 *
 * Until a release folds them, an iterate's one-line doc bullets live as
 *
 *     .shipwright/agent_docs/decision-drops/bullets/<target>--<key>--<wt8>--<nonce8>.md
 *
 * (`<target>` = architecture | conventions | learnings, ONE `- ` line). The
 * subfolder AND the `.md` suffix keep them out of every ADR reader: the WebUI
 * decision-drops reader lists `<run_id>_NNN.json` files in the PARENT folder,
 * non-recursively, so no bullet — and no other `.md` — ever renders as an ADR.
 *
 * A file that is not the grammar (name, symlink, empty, more than one line, not
 * strict UTF-8) is SKIPPED and counted, never rendered. `.gitkeep` is not counted.
 * Read-only: nothing here writes.
 */

import { lstatSync, readdirSync } from "node:fs";
import path from "node:path";

import { readBoundedFile } from "./mission-context/fs-read.js";
import { pathGuard } from "./path-guard.js";

export const BULLETS_REL = ".shipwright/agent_docs/decision-drops/bullets";
export type BulletTarget = "architecture" | "conventions" | "learnings";

/** target → (doc under `.shipwright/agent_docs/`, section header) — `doc_bullets.TARGETS`. */
export const TARGETS: Record<BulletTarget, { doc: string; header: string }> = {
  architecture: { doc: "architecture.md", header: "## Architecture Updates" },
  conventions: { doc: "conventions.md", header: "## Convention Updates" },
  learnings: { doc: "conventions.md", header: "## Learnings" },
};

const NAME = /^(architecture|conventions|learnings)--([A-Za-z0-9._-]{1,80})--([0-9a-f]{8})--([0-9a-f]{8})\.md$/;
/** A bullet is one line; 600 chars is the writer's own cap, 16 KB is headroom. */
const MAX_BULLET_BYTES = 16 * 1024;
/** Python `str.splitlines()` boundaries (not only `\n`). */
// eslint-disable-next-line no-control-regex -- Python splitlines() boundaries include -
const PY_LINE_BREAK = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/;

export interface Bullet {
  target: BulletTarget;
  key: string;
  text: string;
  fileName: string;
}

/** `len(text.splitlines())`: a trailing line break opens no extra line. */
function pyLineCount(text: string): number {
  const parts = text.split(PY_LINE_BREAK);
  return parts.length > 1 && parts[parts.length - 1] === "" ? parts.length - 1 : parts.length;
}

/** The bullet in file `name` with `content`, or null when it is not the bullet grammar. */
export function parseBullet(name: string, content: string): Bullet | null {
  const m = NAME.exec(name);
  const text = content.replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "");
  if (!m || !text.startsWith("- ") || pyLineCount(text) !== 1) return null;
  return { target: m[1] as BulletTarget, key: m[2]!, text, fileName: name };
}

const PAREN_DATE = /\([^)]*?(\d{4})-(\d{2})-(\d{2})[^)]*?\)/g;

/** First valid paren-enclosed `YYYY-MM-DD` (`agent_doc_budget.entry_date`) as `YYYY-MM-DD`, or null. */
export function entryDate(entry: string): string | null {
  for (const m of entry.matchAll(PAREN_DATE)) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const dt = new Date(Date.UTC(2000, mo - 1, d));
    dt.setUTCFullYear(y);
    if (y >= 1 && dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d) {
      return `${m[1]}-${m[2]}-${m[3]}`;
    }
  }
  return null;
}

const LEADING_ANCHOR = /^- \*\*(iterate-\d{4}-\d{2}-\d{2}-[a-z0-9-]+|ADR-\d{3,4})\*\*/;

/** `agent_doc_budget.entry_anchor`: leading run/ADR anchor, else the first 60 body chars. */
export function entryAnchor(entry: string): string {
  const m = LEADING_ANCHOR.exec(entry);
  if (m) return m[1]!;
  return [...(entry.startsWith("- ") ? entry.slice(2) : entry).trim()].slice(0, 60).join(""); // code points, like Python
}

/** `agent_doc_budget.iter_entries`: top-level `- ` blocks under `header`, up to the next `## `. */
export function iterEntries(text: string, header: string): string[] {
  const lines = text.split(PY_LINE_BREAK);
  const start = lines.findIndex((ln) => ln.trim() === header);
  if (start === -1) return [];
  const entries: string[] = [];
  let cur: string[] | null = null;
  for (const ln of lines.slice(start + 1)) {
    if (ln.startsWith("## ")) break;
    if (ln.startsWith("- ")) {
      if (cur) entries.push(cur.join("\n").trimEnd());
      cur = [ln];
    } else if (cur) {
      cur.push(ln);
    }
  }
  if (cur) entries.push(cur.join("\n").trimEnd());
  return entries;
}

/** Python fold order: (entry date or the earliest date, key, file name). */
export function compareBullets(a: Bullet, b: Bullet): number {
  const da = entryDate(a.text) ?? "";
  const db = entryDate(b.text) ?? "";
  if (da !== db) return da < db ? -1 : 1;
  if (a.key !== b.key) return a.key < b.key ? -1 : 1;
  return a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0;
}

export type PendingBullets =
  | { status: "ok"; bullets: Bullet[]; skipped: string[] }
  | { status: "unavailable" };

/** Valid pending bullets oldest first (Python order) + the names skipped. An absent folder is ok/empty. */
export function readPendingBullets(projectRoot: string): PendingBullets {
  const guard = pathGuard(projectRoot, BULLETS_REL);
  if (!guard.ok) return { status: "unavailable" };
  let entries;
  try {
    if (lstatSync(guard.absolute).isSymbolicLink()) return { status: "unavailable" };
    entries = readdirSync(guard.absolute, { withFileTypes: true });
  } catch (err) {
    return (err as NodeJS.ErrnoException | null)?.code === "ENOENT"
      ? { status: "ok", bullets: [], skipped: [] }
      : { status: "unavailable" };
  }
  const bullets: Bullet[] = [];
  const skipped: string[] = [];
  for (const d of [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (d.name === ".gitkeep") continue;
    let bullet: Bullet | null = null;
    if (d.isFile()) {
      const read = readBoundedBytes(path.join(guard.absolute, d.name));
      bullet = read === null ? null : parseBullet(d.name, read);
    }
    if (bullet) bullets.push(bullet);
    else skipped.push(d.name);
  }
  return { status: "ok", bullets: bullets.sort(compareBullets), skipped };
}

/**
 * Bounded read, then a strict-UTF-8 stand-in: Python reads bullets strictly (a bad
 * byte means "skipped"), `readBoundedFile` decodes leniently and turns a bad byte
 * into U+FFFD — so a U+FFFD is treated as a bad byte. (A bullet that genuinely
 * contains U+FFFD is skipped too; the writer never produces one.)
 */
function readBoundedBytes(absolute: string): string | null {
  const read = readBoundedFile(absolute, MAX_BULLET_BYTES);
  return read && !read.text.includes("\uFFFD") ? read.text : null;
}
