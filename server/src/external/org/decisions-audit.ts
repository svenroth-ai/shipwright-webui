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

import { accessSync, constants as fsConstants, existsSync, lstatSync as lstatSyncReal, statSync } from "node:fs";
import { join } from "node:path";

import { appendAuditLine, resolveParentLeadId } from "./audit-append.js";
import { readAuditLinesGuarded } from "./audit-log.js";
import { OrgSymlinkEscapeError } from "./decisions-lock.js";
import { NOTE_MAX, type EvidencePointer } from "./proposed-line.js";
import { pathGuard, realPathGuard } from "../../core/path-guard.js";

export type DecisionAuditKind = "decision_rejected" | "decision_countersigned";

/** Read-back cap of an existing record's reason: the same limit a new reason is checked against. */
export const REASON_MAX = NOTE_MAX;

/** The lead's `audit.jsonl` cannot be read or written (read-only, a directory, unreadable): the decision is refused before anything changes. */
export class AuditUnwritableError extends Error {
  constructor(readonly leadId: string, detail: string) {
    super(`${leadId}/audit.jsonl ${detail}`);
    this.name = "AuditUnwritableError";
  }
}

const UNWRITABLE_CODES = new Set(["EACCES", "EPERM", "EROFS", "EISDIR", "ENOTDIR", "EBUSY", "ENOSPC"]);

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
  /** Reject only: the rejected entry is a rewritten version of this already logged ADR (not a rejection of the approved key). */
  supersededAdr?: string;
  /** Countersign only: the operator changed the proposed line. The original text is never recorded. */
  edited?: boolean;
  /** Countersign only: the structured evidence pointer (session, file line or journal event; never free text or a quote). */
  evidence?: EvidencePointer | null;
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
  throw new AuditUnwritableError(leadId, `cannot be read (${read.body.error}): fix the file, then retry`);
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

/**
 * Whether THIS webui already wrote this exact record: same kind, entry, key,
 * author and action, plus the reason (reject) or the ADR (countersign). A line
 * that merely names the same entry (the lead can write one into its own file)
 * is NOT ours: the decision then writes its own record.
 */
function isOwnRecord(line: string, f: DecisionAuditFacts, anyReason = false): boolean {
  const rec = parsed(line);
  if (rec === null || !matches(line, f.kind, f.entryTimestamp, f.decisionKey)) return false;
  const verb = f.kind === "decision_rejected" ? "rejected" : "countersigned";
  const d = rec.data ?? {};
  if (d.author !== f.author || d.action !== verb) return false;
  if (anyReason) return f.kind === "decision_rejected" && "reason" in d; // the shape this webui writes: the reason field is always present
  return f.kind === "decision_rejected" ? (d.reason ?? null) === (f.reason ?? null) : (d.adr ?? null) === (f.adr ?? null);
}

/** The lead's own folder exists (the audit never creates a lead that is not there). */
export function leadFolderExists(deps: DecisionAuditDeps, leadId: string): boolean {
  const dir = join(deps.leadsRoot, leadId);
  if (!existsSync(dir)) return false;
  // A symlinked lead folder must not let an audit file be created outside leadsRoot.
  if (!realPathGuard(deps.leadsRoot, dir).ok) throw new OrgSymlinkEscapeError(dir);
  return statSync(dir).isDirectory();
}

/** Fail BEFORE a decision changes anything when the audit line could not be appended later. */
export function assertAuditAppendable(deps: DecisionAuditDeps, leadId: string): void {
  if (!leadFolderExists(deps, leadId)) return;
  readAuditLines(deps, leadId); // unreadable / symlink -> throws
  const file = join(deps.leadsRoot, leadId, "audit.jsonl");
  try {
    if (existsSync(file)) {
      if (!statSync(file).isFile()) throw new Error("not a file");
      accessSync(file, fsConstants.W_OK);
    } else {
      // absent audit file: the append creates it, so the lead folder must allow that
      accessSync(join(deps.leadsRoot, leadId), fsConstants.W_OK);
    }
  } catch {
    throw new AuditUnwritableError(leadId, "is read-only: make it writable, then retry");
  }
}

/** Append the decision's record unless it is already there. Returns whether it appended. */
export function ensureDecisionAudit(deps: DecisionAuditDeps, f: DecisionAuditFacts): boolean {
  if (!leadFolderExists(deps, f.leadId)) return false;
  if (readAuditLines(deps, f.leadId).some((l) => isOwnRecord(l, f))) return false;
  const auditGuard = pathGuard(deps.leadsRoot, join(f.leadId, "audit.jsonl"));
  if (!auditGuard.ok) throw new Error(`audit path rejected: ${auditGuard.reason}`);
  const lstat = deps.lstatSync ?? ((p: string) => lstatSyncReal(p));
  const verb = f.kind === "decision_rejected" ? "rejected" : "countersigned";
  try {
    appendAuditLine(deps.leadsRoot, auditGuard.absolute, lstat, {
      ts: (deps.now ?? (() => new Date()))().toISOString(),
      kind: f.kind,
      lead_id: f.leadId,
      parent_lead_id: resolveParentLeadId(deps.leadsRoot, f.leadId),
      summary: `proposal ${verb} by ${f.author}${f.kind === "decision_countersigned" ? (f.edited ? " (edited)" : " (approved as proposed)") : ""}: ${f.decisionKey ?? f.entryTimestamp}`,
      data: {
        action: verb,
        author: f.author,
        entryTimestamp: f.entryTimestamp,
        decisionKey: f.decisionKey,
        ...(f.kind === "decision_rejected"
          ? { reason: f.reason ?? null, ...(f.supersededAdr !== undefined ? { supersededAdr: f.supersededAdr } : {}) }
          : { adr: f.adr ?? null, edit: f.edited ? "edited" : "approved_as_proposed", evidence: f.evidence ?? null }),
      },
    });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== undefined && UNWRITABLE_CODES.has(code)) throw new AuditUnwritableError(f.leadId, `could not be written (${code}): make it writable, then retry`);
    throw err;
  }
  return true;
}

export interface RejectAuditResult {
  /** This call appended the record. */
  recorded: boolean;
  /** A record of this webui for the same entry and author already existed under ANOTHER reason (a retry after a crash
   *  with a different note): it was reused, nothing was appended. `null` = it had no reason. */
  existingReason?: string | null;
}

/** Reject's record, exactly once per (kind, entry, key, author, action): the identical record is reused, and so is
 *  one with a different reason (the retry's reason is dropped and the caller says so). A line another author wrote
 *  never counts, so a forged foreign-author line still gets its own record. */
export function ensureRejectAudit(deps: DecisionAuditDeps, f: DecisionAuditFacts): RejectAuditResult {
  if (!leadFolderExists(deps, f.leadId)) return { recorded: false };
  const lines = readAuditLines(deps, f.leadId);
  if (lines.some((l) => isOwnRecord(l, f))) return { recorded: false };
  const other = lines.find((l) => isOwnRecord(l, f, true));
  if (other !== undefined) {
    const reason = parsed(other)?.data?.reason;
    return { recorded: false, existingReason: typeof reason === "string" ? normalizeReason(reason) : null };
  }
  return { recorded: ensureDecisionAudit(deps, f) };
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
    if (rec?.kind !== "decision_rejected" || typeof rec.data?.supersededAdr === "string") continue;
    const key = rec.data?.decisionKey;
    const ts = rec.data?.entryTimestamp;
    if (typeof key === "string" && key.length > 0 && typeof ts === "string") out.push({ key, entryTimestamp: ts });
  }
  return out;
}

