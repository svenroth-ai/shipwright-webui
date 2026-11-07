/*
 * shipslog-pending-docs.ts — the Ship's-Log Documents panel's "Pending doc
 * updates" group (events-drop-files, issue 978, unit S5b).
 *
 * Since bullet drops, an iterate no longer edits architecture.md /
 * conventions.md directly: each one-line update is its own file under
 * `.shipwright/agent_docs/decision-drops/bullets/` until a release folds it into
 * the document. Without this group those lines would be invisible in the panel
 * between merge and release. Each row opens the bullet file itself; the
 * documents themselves stay in "Agent docs", unchanged.
 *
 * Rows are in the fold order (`doc-bullets.readPendingBullets`), so the list
 * reads in the order the release will add them. A file that is not the bullet
 * grammar is counted, never listed; an unreadable folder is reported, never
 * shown as "no pending updates".
 */

import { statSync } from "node:fs";
import path from "node:path";

import { BULLETS_REL, readPendingBullets, type BulletTarget } from "./doc-bullets.js";

export interface PendingDocRow {
  path: string;
  label: string;
  when: string | null;
}

export interface PendingDocUpdates {
  rows: PendingDocRow[];
  skipped: number;
  unreadable: boolean;
}

const TARGET_LABEL: Record<BulletTarget, string> = {
  architecture: "Architecture",
  conventions: "Conventions",
  learnings: "Learnings",
};
const LABEL_TEXT_CHARS = 90;

function mtimeIso(absolute: string): string | null {
  try {
    return statSync(absolute).mtime.toISOString();
  } catch {
    return null;
  }
}

export function readPendingDocUpdates(projectRoot: string): PendingDocUpdates {
  const read = readPendingBullets(projectRoot);
  if (read.status !== "ok") return { rows: [], skipped: 0, unreadable: true };
  const rows = read.bullets.map((b) => {
    const body = b.text.slice(2).trim();
    const short = body.length > LABEL_TEXT_CHARS ? `${body.slice(0, LABEL_TEXT_CHARS - 1)}…` : body;
    return {
      path: `${BULLETS_REL}/${b.fileName}`,
      label: `${TARGET_LABEL[b.target]} · ${short}`,
      when: mtimeIso(path.join(projectRoot, ...BULLETS_REL.split("/"), b.fileName)),
    };
  });
  return { rows, skipped: read.skipped.length, unreadable: false };
}
