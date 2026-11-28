/*
 * external/org/decisions-rejected.ts — the org-wide `<leadsRoot>/decisions-rejected.md`
 * (iterate-2026-11-28-decision-reject-reason): one block per rejected proposal, appended by the
 * reject action while it holds the decisions lock (`decisions-lock.ts`), so the leadwright daemon can
 * show a lead what was already rejected and why. Grammar (a cross-repo contract, read by leadwright):
 * `docs/org-proposed-entry-contract.md`, section "Rejected decisions file"; pinned sample:
 * `__tests__/fixtures/decisions-rejected-sample.md`.
 *
 *   ## Rejected [<entry timestamp>] <leadId>
 *   <!-- decisionKey: <key> -->          (only when the entry has an identifier key, as in decision_log.md)
 *                                        (blank line)
 *   - <proposed line, one line>
 *   - Rejected: <ISO-8601 UTC time of the rejection>
 *   - Reason: <operator reason, one line> (only when one was given)
 *                                        (blank line)
 *
 * The items are positional: the first item is always the proposed line, whatever text it starts with.
 * Every text field is one line (`normalizeLine`), so no text can start a header, a marker or a second item.
 *
 * Exactly once: a block is identified by (entry timestamp, lead, decisionKey or none, proposed line).
 * Reject appends only when no block with that identity exists, so a retry after a crash between this
 * write and the removal from `decisions-proposed.md` adds nothing. The rejection time and the reason are
 * NOT part of the identity (a retry has a new time, and may carry another reason).
 *
 * The file is written only here, never through the generic `/file` route (it is not in the org allowlist),
 * resolved by `pathGuard` and refused as a symlink, like the two decision files.
 */

import { accessSync, closeSync, constants as fsConstants, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import { pathGuard } from "../../core/path-guard.js";
import { atomicWrite } from "./countersign-core.js";
import { OrgSymlinkEscapeError } from "./decisions-lock.js";
import { normalizeLine } from "./proposed-grammar.js";

export const REJECTED_FILE = "decisions-rejected.md";

/** Written once, when the file does not exist yet (or is empty). Holds no `## ` line, so it is never a block. */
export const REJECTED_FILE_HEADER =
  "# Rejected decisions\n\n" +
  "Proposals the operator rejected, appended by the Shipwright WebUI when a proposal is rejected (oldest first).\n" +
  "Each block: the proposed line, when it was rejected and the operator's reason. Leads: do not propose these again\n" +
  "in other words. Format: docs/org-proposed-entry-contract.md in shipwright-webui, \"Rejected decisions file\".\n\n";

/** Written for an entry whose text is empty, so the first item is never blank. */
export const EMPTY_TEXT = "(no text)";

/** Written instead of a proposed line that copies a quote of the entry's evidence (never shared with other leads). */
export const QUOTE_WITHHELD = "(line withheld: it repeats a quote from the lead's evidence)";

export interface RejectedBlockFacts {
  /** Timestamp of the rejected entry (its identity in decisions-proposed.md). */
  timestamp: string;
  leadId: string;
  /** Identifier key (`decisionKeyOf`), `null` when the entry has none. */
  decisionKey: string | null;
  /** The proposed line as the lead wrote it (one line). */
  text: string;
  /** ISO-8601 UTC time of the rejection. */
  rejectedAt: string;
  /** The operator's reason (already validated, one line), `null` when none. */
  reason: string | null;
}

/** The file is unusable (not a file, read-only folder or file): the reject is refused before anything changes. */
export class RejectedFileUnwritableError extends Error {
  /** `true` when the write failed AFTER the audit record was written: the reject is half done and a retry finishes it. */
  readonly auditWritten: boolean;
  constructor(detail: string, auditWritten = false) {
    super(`${REJECTED_FILE} ${detail}`);
    this.auditWritten = auditWritten;
    this.name = "RejectedFileUnwritableError";
  }
}

const UNWRITABLE_CODES = new Set(["EACCES", "EPERM", "EROFS", "EISDIR", "ENOTDIR", "EBUSY", "ENOSPC"]);

export function toRejectedBlock(f: RejectedBlockFacts): string {
  const text = normalizeLine(f.text) || EMPTY_TEXT;
  const marker = f.decisionKey !== null ? `<!-- decisionKey: ${f.decisionKey} -->\n` : "";
  const reasonText = f.reason === null ? "" : normalizeLine(f.reason);
  const reason = reasonText !== "" ? `- Reason: ${reasonText}\n` : "";
  return `## Rejected [${f.timestamp}] ${f.leadId}\n${marker}\n- ${text}\n- Rejected: ${f.rejectedAt}\n${reason}\n`;
}

export interface ParsedRejectedBlock {
  timestamp: string;
  leadId: string;
  decisionKey: string | null;
  text: string;
  rejectedAt: string | null;
  reason: string | null;
}

const HEADER_RE = /^## Rejected \[([^\]]+)\] (\S+)$/;
const MARKER_RE = /^<!-- decisionKey: (.*) -->$/;
const ITEM_RE = /^- (.*)$/;

/** Every block of the file, by the grammar above (CR, BOM tolerated). A block whose first item is missing is skipped. */
export function parseRejectedBlocks(raw: string): ParsedRejectedBlock[] {
  const lines = raw.replace(/^\uFEFF/, "").replace(/\r/g, "").split("\n").map((l) => l.trimEnd());
  const out: ParsedRejectedBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    const h = HEADER_RE.exec(lines[i]);
    if (!h) continue;
    let j = i + 1;
    const m = MARKER_RE.exec(lines[j] ?? "");
    const decisionKey = m ? m[1] : null;
    if (m) j++;
    while (j < lines.length && lines[j].trim() === "") j++;
    const items: string[] = [];
    for (let it = ITEM_RE.exec(lines[j] ?? ""); it !== null; it = ITEM_RE.exec(lines[j] ?? "")) {
      items.push(it[1]);
      j++;
    }
    if (items.length === 0) continue;
    // Positional, like the grammar: item 2 is the time, item 3 the reason; a prefix only confirms the position.
    const at = (idx: number, label: string) => {
      const it = items[idx];
      return it !== undefined && it.startsWith(`${label}: `) ? it.slice(label.length + 2) : null;
    };
    out.push({ timestamp: h[1], leadId: h[2], decisionKey, text: items[0], rejectedAt: at(1, "Rejected"), reason: at(2, "Reason") });
  }
  return out;
}

/** Same identity: entry timestamp, lead, key (or none) and the proposed line. */
function sameRejection(b: ParsedRejectedBlock, f: RejectedBlockFacts): boolean {
  return b.timestamp === f.timestamp && b.leadId === f.leadId && b.decisionKey === f.decisionKey && b.text === (normalizeLine(f.text) || EMPTY_TEXT);
}

/** `<leadsRoot>/decisions-rejected.md`, guarded like the two decision files (never a symlink, never outside). */
export function resolveRejectedPath(leadsRoot: string): string {
  const guard = pathGuard(leadsRoot, REJECTED_FILE);
  if (!guard.ok) throw new Error(`internal invariant violated: ${REJECTED_FILE} failed to resolve under leadsRoot (${guard.reason})`);
  return guard.absolute;
}

function assertNotSymlink(path: string): void {
  try {
    if (lstatSync(path).isSymbolicLink()) throw new OrgSymlinkEscapeError(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return;
    throw err;
  }
}

function openOrMissing(path: string): number | null {
  try {
    return openSync(path, "r+");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw err;
  }
}

function readOrEmpty(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return "";
    throw err;
  }
}

/** Fail BEFORE the reject changes anything when the block could not be appended later. Call under the decisions lock. */
export function assertRejectedWritable(path: string): void {
  assertNotSymlink(path);
  try {
    // One handle for every check (no check-then-use race): opened read+write, it must be a file and readable,
    // since appending re-reads it for the duplicate check. Missing is fine: the append creates it.
    const fd = openOrMissing(path);
    if (fd !== null) {
      try {
        if (!fstatSync(fd).isFile()) throw new Error("not a file");
        readFileSync(fd, "utf8");
      } finally {
        closeSync(fd);
      }
    }
    // the atomic write creates a temp file next to it and renames it over the target
    accessSync(dirname(path), fsConstants.W_OK);
  } catch {
    throw new RejectedFileUnwritableError("cannot be read or written (read-only, unreadable, or not a file): make it a writable file, then retry");
  }
}

/** Append the block unless a block with the same identity is already there. Returns whether it appended.
 *  Call under the decisions lock (the read-check-write is not atomic on its own), after the audit record is written:
 *  a failure here is reported as `auditWritten`. */
export function appendRejectedBlock(path: string, f: RejectedBlockFacts): boolean {
  assertNotSymlink(path);
  try {
    const raw = readOrEmpty(path);
    if (parseRejectedBlocks(raw).some((b) => sameRejection(b, f))) return false;
    const base = raw.trim() === "" ? REJECTED_FILE_HEADER : raw;
    const sep = base.endsWith("\n\n") ? "" : base.endsWith("\n") ? "\n" : "\n\n";
    atomicWrite(path, base + sep + toRejectedBlock(f)); // header + first block in ONE write: never a header-only file
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== undefined && UNWRITABLE_CODES.has(code)) throw new RejectedFileUnwritableError(`could not be written (${code}): make it writable, then retry Reject to finish`, true);
    throw err;
  }
  return true;
}
