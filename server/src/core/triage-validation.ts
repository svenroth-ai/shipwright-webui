/*
 * triage-validation.ts — request-body validators for the Triage routes.
 * Extracted out of routes/triage.ts (iterate-2026-08-05-triage-deferred-
 * envelope) purely to keep that already-bloat-baselined file from ratcheting
 * past its recorded ceiling; no behavior changed by the move.
 */

import type { TriagePriority, TriageSeverity } from "../types/triage.js";
import { validateAmendEvent } from "./triage-amend.js";
import { parseRevisitDate, utcToday } from "./triage-defer.js";

const TRIAGE_ID_RE = /^trg-[0-9a-fA-F]{8}$/;
const PRIORITY_VALUES: ReadonlySet<TriagePriority> = new Set([
  "P0",
  "P1",
  "P2",
  "P3",
]);
const COMPLEXITY_VALUES: ReadonlySet<string> = new Set([
  "small",
  "medium",
  "large",
]);
const MAX_TAG_LEN = 100;
const MAX_TAGS = 32;
const MAX_DOMAIN_LEN = 200;
const MAX_REASON_LEN = 500;

export interface PromoteBody {
  triageId: string;
  priority: TriagePriority;
  domain: string;
  complexityHint?: "small" | "medium" | "large";
  tags: string[];
}

export interface DismissSnoozeBody {
  triageId: string;
  reason: string | null;
  /** Present only on a `snoozed` flip — see `parseDismissSnoozeBody`. */
  revisitAt?: string;
}

export type Validated<T> =
  | { ok: true; value: T }
  | { ok: false; error: { error: string; field?: string } };

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function containsControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

export function parsePromoteBody(body: unknown): Validated<PromoteBody> {
  if (!isPlainObject(body)) return { ok: false, error: { error: "body_not_object" } };
  const triageId = body.triageId;
  if (typeof triageId !== "string" || !TRIAGE_ID_RE.test(triageId)) {
    return { ok: false, error: { error: "invalid_triageId", field: "triageId" } };
  }
  const priority = body.priority;
  if (typeof priority !== "string" || !PRIORITY_VALUES.has(priority as TriagePriority)) {
    return { ok: false, error: { error: "invalid_priority", field: "priority" } };
  }
  const domainRaw = body.domain;
  if (typeof domainRaw !== "string") {
    return { ok: false, error: { error: "invalid_domain", field: "domain" } };
  }
  const domain = domainRaw.trim();
  if (!domain) return { ok: false, error: { error: "domain_empty", field: "domain" } };
  if (domain.length > MAX_DOMAIN_LEN) {
    return { ok: false, error: { error: "domain_too_long", field: "domain" } };
  }
  let complexityHint: "small" | "medium" | "large" | undefined;
  if (body.complexityHint !== undefined) {
    if (
      typeof body.complexityHint !== "string" ||
      !COMPLEXITY_VALUES.has(body.complexityHint)
    ) {
      return {
        ok: false,
        error: { error: "invalid_complexityHint", field: "complexityHint" },
      };
    }
    complexityHint = body.complexityHint as "small" | "medium" | "large";
  }
  const tagsRaw = body.tags;
  if (!Array.isArray(tagsRaw)) {
    return { ok: false, error: { error: "invalid_tags", field: "tags" } };
  }
  const tagsValidated: string[] = [];
  const seen = new Set<string>();
  for (const t of tagsRaw) {
    if (typeof t !== "string") {
      return { ok: false, error: { error: "invalid_tag_type", field: "tags" } };
    }
    if (containsControlChar(t)) {
      return { ok: false, error: { error: "tag_control_char", field: "tags" } };
    }
    const trimmed = t.trim();
    if (!trimmed) continue;
    if (trimmed.length > MAX_TAG_LEN) {
      return { ok: false, error: { error: "tag_too_long", field: "tags" } };
    }
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      tagsValidated.push(trimmed);
    }
  }
  if (tagsValidated.length > MAX_TAGS) {
    return { ok: false, error: { error: "tags_too_many", field: "tags" } };
  }
  return {
    ok: true,
    value: { triageId, priority: priority as TriagePriority, domain, complexityHint, tags: tagsValidated },
  };
}

/**
 * `newStatus` decides whether `revisitAt` is even legal on this body — park
 * semantics apply ONLY to a `snoozed` flip, mirroring the monorepo's
 * `mark_status` validation (`revisit_at is park semantics and is accepted
 * only on a snoozed flip`). A non-future date (today or past) is rejected
 * too: it would resolve straight back to `status: "triage"` on the very
 * next read, defeating the point of parking it (iterate-2026-08-05-triage-
 * deferred-envelope plan review, AC7).
 */
export function parseDismissSnoozeBody(
  body: unknown,
  newStatus: "dismissed" | "snoozed",
): Validated<DismissSnoozeBody> {
  if (!isPlainObject(body)) return { ok: false, error: { error: "body_not_object" } };
  const triageId = body.triageId;
  if (typeof triageId !== "string" || !TRIAGE_ID_RE.test(triageId)) {
    return { ok: false, error: { error: "invalid_triageId", field: "triageId" } };
  }
  let reason: string | null = null;
  if (body.reason !== undefined && body.reason !== null) {
    if (typeof body.reason !== "string") {
      return { ok: false, error: { error: "invalid_reason", field: "reason" } };
    }
    if (containsControlChar(body.reason)) {
      return { ok: false, error: { error: "reason_control_char", field: "reason" } };
    }
    const trimmed = body.reason.trim();
    if (trimmed.length > MAX_REASON_LEN) {
      return { ok: false, error: { error: "reason_too_long", field: "reason" } };
    }
    reason = trimmed || null;
  }
  let revisitAt: string | undefined;
  if (body.revisitAt !== undefined && body.revisitAt !== null) {
    if (newStatus !== "snoozed") {
      return { ok: false, error: { error: "revisitAt_not_permitted", field: "revisitAt" } };
    }
    const parsed = parseRevisitDate(body.revisitAt);
    if (parsed === null) {
      return { ok: false, error: { error: "invalid_revisitAt", field: "revisitAt" } };
    }
    if (parsed <= utcToday(new Date())) {
      return { ok: false, error: { error: "revisitAt_not_future", field: "revisitAt" } };
    }
    revisitAt = parsed;
  }
  return { ok: true, value: { triageId, reason, revisitAt } };
}

export interface AmendBody {
  triageId: string;
  title?: string;
  detail?: string;
  severity?: TriageSeverity;
}

/**
 * Validates a `POST /api/triage/:projectId/amend` body: a DELTA, never a
 * rewrite — any subset of title/detail/severity, at least one present
 * (contentless → 400 before any write, mirrors `check_amend_fields`'s
 * writer-side precondition in `lib/triage_amend.py`). Field-level validity
 * (non-blank title, string detail, known severity) reuses
 * `triage-amend.ts`'s `validateAmendEvent` — the SAME check the reader
 * applies to a stored line, so a body that would pass here is guaranteed to
 * resolve on the very next read (no accepted-but-silently-ignored amend).
 * `kind` is deliberately NOT accepted here — the Edit UI only offers
 * title/detail/severity (filing-card decision); the wire format itself
 * still supports a `kind` amend for parity with any future producer.
 */
export function parseAmendBody(body: unknown): Validated<AmendBody> {
  if (!isPlainObject(body)) return { ok: false, error: { error: "body_not_object" } };
  const triageId = body.triageId;
  if (typeof triageId !== "string" || !TRIAGE_ID_RE.test(triageId)) {
    return { ok: false, error: { error: "invalid_triageId", field: "triageId" } };
  }
  const candidate: Record<string, unknown> = {};
  if (body.title !== undefined) candidate.title = body.title;
  if (body.detail !== undefined) candidate.detail = body.detail;
  if (body.severity !== undefined) candidate.severity = body.severity;
  if (Object.keys(candidate).length === 0) {
    return { ok: false, error: { error: "amend_contentless" } };
  }
  if (!validateAmendEvent(candidate)) {
    return { ok: false, error: { error: "invalid_amend_field" } };
  }
  // Node refuses NUL bytes in execFile arguments. Keep newlines valid in an
  // amend detail, but reject the one character that could otherwise turn this
  // well-formed HTTP request into an opaque process-spawn failure.
  if (
    (typeof candidate.title === "string" && candidate.title.includes("\0")) ||
    (typeof candidate.detail === "string" && candidate.detail.includes("\0"))
  ) {
    return { ok: false, error: { error: "invalid_amend_field" } };
  }
  return {
    ok: true,
    value: {
      triageId,
      ...(candidate.title !== undefined ? { title: candidate.title as string } : {}),
      ...(candidate.detail !== undefined ? { detail: candidate.detail as string } : {}),
      ...(candidate.severity !== undefined
        ? { severity: candidate.severity as TriageSeverity }
        : {}),
    },
  };
}
