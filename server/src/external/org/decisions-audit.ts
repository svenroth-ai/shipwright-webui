/*
 * external/org/decisions-audit.ts — the audit records of the proposal
 * decisions (campaign shadow-proposals-webui, W3): one `decision_rejected`
 * or `decision_countersigned` line in the proposing lead's `audit.jsonl`.
 *
 * The record names WHO decided, the lead, the entry timestamp, the
 * decisionKey and the action — never the proposed text or a quote
 * (operator decision 5). `reason` is the operator's own optional note.
 *
 * Not tamper-proof: the file belongs to the lead, who can also write it; the record is the
 * operator's trail, not an authenticated log. Crash-safe against process death, not
 * power loss (no fsync).
 *
 * Exactly once: a record is identified by (kind, entryTimestamp,
 * decisionKey) inside one lead's file; `ensureDecisionAudit` appends only
 * when no such line exists. Callers hold the decisions lock, so the
 * check-then-append cannot interleave with another decision.
 */

import { accessSync, constants as fsConstants, existsSync, lstatSync as lstatSyncReal } from "node:fs";
import { join } from "node:path";

import { appendAuditLine, resolveParentLeadId } from "./beat-register-release-audit.js";
import { readAuditLinesGuarded } from "./audit-log.js";
import { OrgSymlinkEscapeError } from "./decisions-lock.js";
import { pathGuard } from "../../core/path-guard.js";

export type DecisionAuditKind = "decision_rejected" | "decision_countersigned";

export const REASON_MAX = 280;

export interface DecisionAuditDeps {
  leadsRoot: string;
  lstatSync?: (path: string) => { isSymbolicLink(): boolean };
  now?: () => Date;
}

export interface DecisionAuditFacts {
  kind: DecisionAuditKind;
  leadId: string;
  author: string;
  entryTimestamp: string;
  decisionKey: string | null;
  /** Rejection note typed by the operator; `null` when none. */
  reason?: string | null;
  /** ADR number, for a countersign. */
  adr?: string;
}

/** One line, bounded: an operator note can never forge a second JSONL line. */
export function normalizeReason(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").trim().slice(0, REASON_MAX);
  return text.length > 0 ? text : null;
}

function readAuditLines(deps: DecisionAuditDeps, leadId: string): string[] {
  const read = readAuditLinesGuarded({ leadsRoot: deps.leadsRoot }, leadId);
  if (read.status === 200) return read.linesNewestFirst;
  if (read.status === 404) return [];
  if (read.status === 403) throw new OrgSymlinkEscapeError(join(deps.leadsRoot, leadId, "audit.jsonl"));
  throw new Error(`audit.jsonl unreadable: ${read.body.error}`);
}

function parsed(line: string): { kind?: unknown; data?: Record<string, unknown> } | null {
  try {
    const v = JSON.parse(line) as unknown;
    return v && typeof v === "object" ? (v as { kind?: unknown; data?: Record<string, unknown> }) : null;
  } catch {
    return null;
  }
}

function matches(
  line: string,
  kind: DecisionAuditKind,
  entryTimestamp: string,
  decisionKey: string | null | undefined,
): boolean {
  const rec = parsed(line);
  return (
    rec !== null &&
    rec.kind === kind &&
    rec.data?.entryTimestamp === entryTimestamp &&
    (decisionKey === undefined || (rec.data?.decisionKey ?? null) === decisionKey)
  );
}

export function hasDecisionAudit(
  deps: DecisionAuditDeps,
  kind: DecisionAuditKind,
  leadId: string,
  entryTimestamp: string,
  /** `undefined` = any key. */
  decisionKey: string | null | undefined,
): boolean {
  return readAuditLines(deps, leadId).some((l) => matches(l, kind, entryTimestamp, decisionKey));
}

/** The lead's own folder exists (the audit never creates a lead that is not there). */
export function leadFolderExists(deps: DecisionAuditDeps, leadId: string): boolean {
  return existsSync(join(deps.leadsRoot, leadId));
}

/** Fail BEFORE a decision changes anything when the audit line could not be appended later. */
export function assertAuditAppendable(deps: DecisionAuditDeps, leadId: string): void {
  if (!leadFolderExists(deps, leadId)) return;
  hasDecisionAudit(deps, "decision_rejected", leadId, "", undefined); // unreadable / symlink -> throws
  const file = join(deps.leadsRoot, leadId, "audit.jsonl");
  if (existsSync(file)) accessSync(file, fsConstants.W_OK);
}

/** Append the decision's record unless it is already there. Returns whether it appended. */
export function ensureDecisionAudit(deps: DecisionAuditDeps, f: DecisionAuditFacts): boolean {
  if (!leadFolderExists(deps, f.leadId)) return false;
  if (hasDecisionAudit(deps, f.kind, f.leadId, f.entryTimestamp, f.decisionKey)) return false;
  const auditGuard = pathGuard(deps.leadsRoot, join(f.leadId, "audit.jsonl"));
  if (!auditGuard.ok) throw new Error(`audit path rejected: ${auditGuard.reason}`);
  const lstat = deps.lstatSync ?? ((p: string) => lstatSyncReal(p));
  const verb = f.kind === "decision_rejected" ? "rejected" : "countersigned";
  appendAuditLine(deps.leadsRoot, auditGuard.absolute, lstat, {
    ts: (deps.now ?? (() => new Date()))().toISOString(),
    kind: f.kind,
    lead_id: f.leadId,
    parent_lead_id: resolveParentLeadId(deps.leadsRoot, f.leadId),
    summary: `proposal ${verb} by ${f.author}: ${f.decisionKey ?? f.entryTimestamp}`,
    data: {
      action: verb,
      author: f.author,
      entryTimestamp: f.entryTimestamp,
      decisionKey: f.decisionKey,
      ...(f.kind === "decision_rejected" ? { reason: f.reason ?? null } : { adr: f.adr ?? null }),
    },
  });
  return true;
}

export interface RejectedKey {
  key: string;
  /** Timestamp of the rejected entry - lets a reader tell a crash leftover (same entry) from a repeat. */
  entryTimestamp: string;
}

/** Decision keys of a lead's rejected proposals — what makes a later proposal a repeat. */
export function rejectedKeys(deps: DecisionAuditDeps, leadId: string): RejectedKey[] {
  const out: RejectedKey[] = [];
  for (const line of readAuditLines(deps, leadId)) {
    const rec = parsed(line);
    if (rec?.kind !== "decision_rejected") continue;
    const key = rec.data?.decisionKey;
    const ts = rec.data?.entryTimestamp;
    if (typeof key === "string" && key.length > 0 && typeof ts === "string") out.push({ key, entryTimestamp: ts });
  }
  return out;
}

