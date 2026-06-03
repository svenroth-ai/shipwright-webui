/*
 * campaign-write.ts — the ONLY WebUI write to campaign lifecycle state.
 *
 * Sets a campaign's top-level lifecycle `status` (the `draft → active` flip
 * behind the Triage "Start Campaign" action). A deliberate, narrow relaxation
 * of the "WebUI is read-only on campaign state" rule — the same operator-write
 * pattern as `core/triage-write.ts` (ADR-101/106): caller holds the lock; this
 * module just does the read-modify-write of a single field.
 *
 * Write target mirrors the READ precedence in `pickLifecycle` (status.json
 * top-level `status` wins, else `campaign.md` frontmatter), so a write always
 * lands where the next read looks:
 *   - `status.json` exists → JSON.parse, set top-level `status`, re-serialize.
 *   - else `campaign.md` has a frontmatter block → replace/insert `status:`
 *     INSIDE the leading `---…---` block only (never the body).
 *   - neither → `CampaignWriteError("no_writable_status_target")` (the route
 *     maps it to 422) — we never blindly create/append, which could corrupt.
 *
 * All writes are atomic (temp file + rename) so a crash mid-write can't leave a
 * half-written status.json / campaign.md (external review HIGH #2 / #1).
 */

import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";

import type { CampaignLifecycleStatus } from "./campaign-status-json.js";

export type CampaignWriteErrorCode =
  | "no_writable_status_target"
  | "campaign_write_failed";

export class CampaignWriteError extends Error {
  constructor(
    readonly code: CampaignWriteErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CampaignWriteError";
  }
}

const VALID_LIFECYCLE: ReadonlySet<string> = new Set([
  "draft",
  "active",
  "complete",
]);

/** Write `content` to `file` atomically (same-dir temp + rename). */
function atomicWrite(file: string, content: string): void {
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, content, "utf-8");
  renameSync(tmp, file);
}

/** Set status.json top-level `status` when status.json exists. */
function writeStatusJson(campaignDir: string, status: string): boolean {
  const p = path.join(campaignDir, "status.json");
  if (!existsSync(p)) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    throw new CampaignWriteError(
      "campaign_write_failed",
      "status.json is not valid JSON; refusing to rewrite",
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new CampaignWriteError(
      "campaign_write_failed",
      "status.json is not a JSON object; refusing to rewrite",
    );
  }
  (parsed as Record<string, unknown>).status = status;
  atomicWrite(p, JSON.stringify(parsed, null, 2) + "\n");
  return true;
}

/**
 * Set the `status:` key INSIDE the leading `---…---` frontmatter block of
 * campaign.md (never the body). Tolerates CRLF + an existing `status:` line.
 * Returns false when there is no frontmatter block to write into.
 */
function writeFrontmatterStatus(campaignDir: string, status: string): boolean {
  const p = path.join(campaignDir, "campaign.md");
  if (!existsSync(p)) return false;
  const md = readFileSync(p, "utf-8");
  // Capture the leading frontmatter block: opening `---<eol>`, body, closing `<eol>---`.
  const m = md.match(/^(---[ \t]*\r?\n)([\s\S]*?)(\r?\n---[ \t]*)(\r?\n|$)/);
  if (!m) return false; // no frontmatter block — refuse (route → 422)
  const open = m[1];
  const body = m[2];
  const close = m[3];
  const after = m[4];
  // Only treat this as YAML frontmatter (not a leading `---` thematic break
  // wrapping prose) if the block has at least one TOP-LEVEL `key:` line. A
  // prose block fenced by `---` has none → refuse (route → 422) rather than
  // splice `status:` into the middle of prose (review MEDIUM #1).
  if (!/^[A-Za-z0-9_-]+[ \t]*:/m.test(body)) return false;
  const eol = open.includes("\r\n") ? "\r\n" : "\n";
  const lines = body.split(/\r?\n/);
  let found = false;
  const rewritten = lines.map((ln) => {
    // Column-0 anchor: only the TOP-LEVEL `status:` (the lifecycle field
    // `pickLifecycle` reads) is rewritten — an indented `status:` nested under
    // another mapping is left byte-intact (review MEDIUM #2).
    if (/^status[ \t]*:/.test(ln)) {
      found = true;
      return `status: ${status}`;
    }
    return ln;
  });
  if (!found) rewritten.push(`status: ${status}`);
  const newBlock = open + rewritten.join(eol) + close + after;
  const newMd = md.slice(0, m.index ?? 0) + newBlock + md.slice((m.index ?? 0) + m[0].length);
  atomicWrite(p, newMd);
  return true;
}

/**
 * Set the campaign-level lifecycle `status`. Writes status.json if present,
 * else the campaign.md frontmatter; throws `no_writable_status_target` when
 * neither exists. Caller MUST hold the campaign-dir lock.
 */
export function setCampaignStatus(
  campaignDir: string,
  status: CampaignLifecycleStatus,
): void {
  if (!VALID_LIFECYCLE.has(status)) {
    throw new CampaignWriteError(
      "campaign_write_failed",
      `invalid lifecycle status: ${String(status)}`,
    );
  }
  try {
    if (writeStatusJson(campaignDir, status)) return;
    if (writeFrontmatterStatus(campaignDir, status)) return;
  } catch (err) {
    if (err instanceof CampaignWriteError) throw err;
    throw new CampaignWriteError(
      "campaign_write_failed",
      `campaign status write failed: ${String(err).slice(0, 200)}`,
    );
  }
  throw new CampaignWriteError(
    "no_writable_status_target",
    "campaign has neither a status.json nor a campaign.md frontmatter block to write the status into",
  );
}
