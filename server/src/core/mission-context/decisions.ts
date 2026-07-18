/*
 * core/mission-context/decisions.ts — the DECISIONS artifact source
 * (CONTRACT §6 row 5 / §10 Slice-2, campaign 2026-07-18-mission-artifacts).
 *
 * `.shipwright/agent_docs/decision_log.md` is a 639 KB append-only log of EVERY
 * ADR this project ever recorded. The provenance problem external-review GPT #10
 * closed is what makes it usable: each iterate's ADR carries a
 * `- **Run-ID:** <run_id>` bullet, so this run's decisions are an EXACT-MATCH
 * filter — not a date heuristic, not "the last N entries". That exactness is
 * AC3: a concurrent iterate's ADRs, written into the same file minutes apart,
 * can never leak into this run.
 *
 * Two disciplines this module exists to keep (S1 review lessons):
 *
 *   1. SCOPE THE READ TO THE SECTION THE CONTRACT NAMED. The right panel renders
 *      "the ADR Markdown", not the decision log. So we extract the matched ADR
 *      BLOCKS and render those — pointing the viewer at the whole 639 KB file
 *      would bury this run's two decisions under four hundred unrelated ones.
 *   2. BOUND EVERYTHING. Entry count, per-entry size and total size are all
 *      capped, and truncation is REPORTED rather than silently applied.
 */

import { existsSync } from "node:fs";
import path from "node:path";

import { readBoundedFile } from "./fs-read.js";
import { pathGuard } from "../path-guard.js";

export const DECISION_LOG_REL = ".shipwright/agent_docs/decision_log.md";

/** Real file is ~640 KB and only grows; 16 MB bounds it with room to spare. */
const MAX_LOG_BYTES = 16 * 1024 * 1024;

/** One iterate records a handful of ADRs. 20 is a generous, bounded ceiling. */
export const MAX_DECISION_ENTRIES = 20;

/** Per-entry and total caps on the Markdown carried into the response. */
const MAX_ENTRY_CHARS = 64 * 1024;
const MAX_TOTAL_CHARS = 256 * 1024;

export interface DecisionEntry {
  /** `ADR-070`, `ADR-045b` — as written in the heading. */
  adrId: string;
  /** Heading text after the id. May be empty when the heading carried none. */
  title: string;
  /** The ADR block's own Markdown, ready for `DocumentMarkdown`. */
  markdown: string;
}

export type DecisionsLookup =
  | { status: "ok"; entries: DecisionEntry[]; truncated: boolean }
  | { status: "unavailable"; reason: "missing" | "too_large" | "denied" };

/** Absolute path to the decision log — used for `sourceRev` probing. */
export function decisionLogPath(projectRoot: string): string {
  return path.join(projectRoot, ...DECISION_LOG_REL.split("/"));
}

/** An ADR heading at h1–h4: `### ADR-070: title`. */
const ADR_HEADING = /^#{1,4}[ \t]+(ADR-[0-9A-Za-z._-]+)[ \t]*(?::[ \t]*(.*))?$/;

/** Any h1–h3 heading closes the previous ADR block. */
const BLOCK_BOUNDARY = /^#{1,3}[ \t]+\S/;

/**
 * The Run-ID bullet. BOTH real spellings occur in this repo's log and both must
 * match, or a third of the entries would silently never resolve:
 *   `- **Run-ID:** iterate-…`   (colon inside the bold)
 *   `- **Run-ID**: iterate-…`   (colon outside)
 */
const RUN_ID_BULLET = /^[ \t]*[-*][ \t]*\*\*Run-ID[ \t]*:?[ \t]*\*\*[ \t]*:?[ \t]*(\S.*)$/i;

/**
 * The recorded value, normalised for comparison: strip Markdown code ticks,
 * quotes and trailing punctuation a human may have typed around it.
 */
function normaliseRunId(raw: string): string {
  return raw
    .trim()
    .replace(/^[`'"]+/, "")
    .replace(/[`'".,;]+$/, "")
    .trim();
}

/** The Run-ID this block declares, or null when it declares none. */
export function blockRunId(block: string): string | null {
  for (const line of block.split(/\r?\n/)) {
    const m = RUN_ID_BULLET.exec(line);
    if (m) {
      const v = normaliseRunId(m[1]);
      return v.length > 0 ? v : null;
    }
  }
  return null;
}

interface RawBlock {
  adrId: string;
  title: string;
  lines: string[];
}

/**
 * Split the log into ADR blocks. Exported for direct unit testing — the
 * splitting rule is the fragile part and deserves its own cases.
 */
export function splitAdrBlocks(text: string): RawBlock[] {
  const lines = text.split(/\r?\n/);
  const blocks: RawBlock[] = [];
  let current: RawBlock | null = null;

  for (const line of lines) {
    const heading = ADR_HEADING.exec(line);
    if (heading) {
      if (current) blocks.push(current);
      current = { adrId: heading[1], title: (heading[2] ?? "").trim(), lines: [line] };
      continue;
    }
    if (current && BLOCK_BOUNDARY.test(line)) {
      // A non-ADR h1–h3 heading ends the block — an ADR body never contains one.
      blocks.push(current);
      current = null;
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) blocks.push(current);
  return blocks;
}

/**
 * The ADRs this run recorded.
 *
 * `unavailable` means the log itself could not be read. An `ok` with zero
 * entries means the log WAS read and this run recorded no ADR — a real, honest
 * answer, and the caller renders the two cases differently.
 */
export function readRunDecisions(projectRoot: string, runId: string): DecisionsLookup {
  if (typeof runId !== "string" || runId.trim().length === 0) {
    return { status: "unavailable", reason: "missing" };
  }
  const guard = pathGuard(projectRoot, DECISION_LOG_REL);
  if (!guard.ok) return { status: "unavailable", reason: "denied" };
  if (!existsSync(guard.absolute)) return { status: "unavailable", reason: "missing" };

  const read = readBoundedFile(guard.absolute, MAX_LOG_BYTES);
  if (!read) return { status: "unavailable", reason: "too_large" };

  const wanted = runId.trim();
  const entries: DecisionEntry[] = [];
  let truncated = false;
  let totalChars = 0;

  for (const block of splitAdrBlocks(read.text)) {
    const text = block.lines.join("\n").trimEnd();
    // EXACT match — the whole point of the Run-ID tag (AC3). A prefix or
    // substring test would let `…-mission-s2` match `…-mission-s2-followup`.
    if (blockRunId(text) !== wanted) continue;

    if (entries.length >= MAX_DECISION_ENTRIES) {
      truncated = true;
      break;
    }
    const clipped = text.length > MAX_ENTRY_CHARS ? `${text.slice(0, MAX_ENTRY_CHARS)}\n\n…` : text;
    if (totalChars + clipped.length > MAX_TOTAL_CHARS) {
      truncated = true;
      break;
    }
    totalChars += clipped.length;
    if (clipped.length < text.length) truncated = true;
    entries.push({ adrId: block.adrId, title: block.title, markdown: clipped });
  }

  return { status: "ok", entries, truncated };
}
