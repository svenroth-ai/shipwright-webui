/*
 * core/mission-context/doc-updates.ts — a run's documentation updates, FOLDED +
 * PENDING (events-drop-files, issue 978, unit S5b), for the Decisions artifact.
 *
 *   folded   an entry of `## Architecture Updates` (architecture.md) or
 *            `## Convention Updates` (conventions.md) whose leading anchor is the
 *            run id (`- **<run_id>** …`) — written there by a release fold, or by
 *            a plugin from before bullet drops.
 *   pending  the run's bullet drop files (`doc-bullets.ts`, file key = the run id
 *            as the writer sanitizes it) that no release has folded yet.
 *
 * The rules are Python `doc_bullets.effective_text` / `insert_bullets`: a pending
 * bullet whose anchor is already an entry of its section is not shown again
 * (folded wins); among pending ones the first in fold order wins its anchor and a
 * later one with DIFFERENT text is a `conflict` (the fold keeps that file for a
 * human). `learnings` bullets are left out: once folded they carry no run anchor,
 * so a learning would show while pending and vanish at the release.
 *
 * `root` is the run's chosen read root: its worktree while it is live (bullets
 * are written there and ship in the PR), the project root once finished. A
 * merged-but-not-pulled run's pending bullets are not read from `origin/main`
 * (the main tree catches up on pull) — a known gap.
 */

import { existsSync } from "node:fs";
import path from "node:path";

import { readBoundedFile } from "./fs-read.js";
import { BULLETS_REL, entryAnchor, iterEntries, readPendingBullets, TARGETS, type BulletTarget } from "../doc-bullets.js";
import { sanitizeKey } from "../event-log-assemble.js";
import { pathGuard } from "../path-guard.js";
import type { DocUpdateView } from "./types-slice2.js";

const AGENT_DOCS_REL = ".shipwright/agent_docs";
/** architecture.md / conventions.md are curated docs; 16 MB bounds a corrupt one. */
const MAX_DOC_BYTES = 16 * 1024 * 1024;
const RUN_TARGETS: Exclude<BulletTarget, "learnings">[] = ["architecture", "conventions"];

export interface RunDocUpdates {
  entries: DocUpdateView[];
  /** Pending bullets dropped because another one already holds their anchor with other text. */
  conflicts: number;
  /** This run's bullet files that are not the grammar (counted, never rendered). */
  malformed: number;
  /** A doc or the bullets folder exists and could not be read — nothing may read as "none". */
  sawUnreadable: boolean;
}

/** Every path whose change must move the Mission `sourceRev`. */
export function docUpdateRevPaths(root: string, pendingFiles: string[] = []): string[] {
  return [
    path.join(root, ...AGENT_DOCS_REL.split("/"), "architecture.md"),
    path.join(root, ...AGENT_DOCS_REL.split("/"), "conventions.md"),
    path.join(root, ...BULLETS_REL.split("/")),
    ...pendingFiles.map((n) => path.join(root, ...BULLETS_REL.split("/"), n)),
  ];
}

/** The run's own bullet file names (for `sourceRev`: an edited file keeps the folder mtime). */
export function runBulletFiles(root: string, runId: string): string[] {
  const read = readPendingBullets(root);
  if (read.status !== "ok") return [];
  const key = sanitizeKey(runId);
  return [...read.bullets.filter((b) => b.key === key).map((b) => b.fileName),
    ...read.skipped.filter((n) => n.includes(`--${key}--`))];
}

/** The doc's text; an ABSENT doc is fine (""), one that exists and cannot be read is not. */
function readDoc(root: string, doc: string): { text: string; unreadable: boolean } {
  const guard = pathGuard(root, `${AGENT_DOCS_REL}/${doc}`);
  if (!guard.ok) return { text: "", unreadable: true };
  if (!existsSync(guard.absolute)) return { text: "", unreadable: false };
  const read = readBoundedFile(guard.absolute, MAX_DOC_BYTES);
  return read ? { text: read.text, unreadable: false } : { text: "", unreadable: true };
}

export function readRunDocUpdates(root: string, runId: string): RunDocUpdates {
  const out: RunDocUpdates = { entries: [], conflicts: 0, malformed: 0, sawUnreadable: false };
  const pending = readPendingBullets(root);
  if (pending.status !== "ok") out.sawUnreadable = true;
  const key = sanitizeKey(runId);
  const mine = pending.status === "ok" ? pending.bullets.filter((b) => b.key === key) : [];
  if (pending.status === "ok") {
    out.malformed = pending.skipped.filter((n) => RUN_TARGETS.some((t) => n.startsWith(`${t}--${key}--`))).length;
  }

  const docs = new Map<string, string>();
  for (const target of RUN_TARGETS) {
    const { doc, header } = TARGETS[target];
    if (!docs.has(doc)) {
      const read = readDoc(root, doc);
      if (read.unreadable) out.sawUnreadable = true;
      docs.set(doc, read.text);
    }
    const entries = iterEntries(docs.get(doc)!, header);
    // anchor → the text that holds it (folded first, then pending in fold order)
    const held = new Map<string, string>(entries.map((e) => [entryAnchor(e), e]));
    for (const e of entries) {
      if (entryAnchor(e) === runId) out.entries.push({ target, doc, text: e, state: "folded" });
    }
    for (const b of mine.filter((x) => x.target === target)) {
      const anchor = entryAnchor(b.text);
      const winner = held.get(anchor);
      if (winner === undefined) {
        held.set(anchor, b.text);
        out.entries.push({ target, doc, text: b.text, state: "pending" });
      } else if (winner !== b.text) {
        out.conflicts++;
      }
    }
  }
  return out;
}
