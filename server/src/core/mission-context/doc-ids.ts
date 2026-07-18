/*
 * core/mission-context/doc-ids.ts — OPAQUE artifact-document ids
 * (CONTRACT §5.2, Review-2 GPT #9).
 *
 * The client must NOT construct `/file?path=…` for a Mission artifact. If it
 * did, the path rules would exist in two places and the descriptor and the file
 * read would drift — the classic "the UI shows spec A but fetches file B" bug.
 * Instead the resolver mints an opaque, SIGNED id and the detail endpoint is
 * the only thing that turns it back into a path.
 *
 * The id is a signed capability, not a secret: it carries the binding fields
 * (task, session, project root, run, the chosen root, the relative path, and
 * the source revision) under an HMAC over a per-process key. Tampering with any
 * field invalidates the signature, so a caller cannot rewrite `relPath` to
 * point at `../../.env`.
 *
 * The signature is NOT the security boundary on its own — the detail endpoint
 * ALSO re-checks that the decoded task/session belong to the requesting
 * project and re-runs pathGuard + realPathGuard against the decoded root. The
 * HMAC is what makes those checks cheap and unambiguous; the guards are what
 * make them safe. A per-process key means ids do not survive a restart, which
 * is correct: they are request-scoped handles, not durable links.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Regenerated every boot — ids are ephemeral handles by design. */
const KEY = randomBytes(32);

export interface DocIdPayload {
  /** Binding: the task this descriptor was built for. */
  t: string;
  /** Binding: the session uuid. */
  s: string;
  /** Binding: the project root the resolve ran against. */
  p: string;
  /** The iterate run id. */
  r: string;
  /** The root the document was resolved in (project root or a worktree). */
  root: string;
  /** Known-layout relative path segments, joined with "/". */
  rel: string;
  /** Context-wide source revision at mint time. */
  rev: string;
  /**
   * PER-DOCUMENT fingerprint (`<size>:<mtimeMs>`) at mint time.
   *
   * The context-wide `rev` is not sufficient for AC3: it is derived from the
   * adopted spec + event log, so editing only the iterate document would leave
   * it unchanged and the detail endpoint would silently serve the NEW body as
   * `ok` (external code review, openai HIGH). The detail endpoint recomputes
   * this and reports `stale` on any difference.
   */
  f: string;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function sign(body: string): string {
  return b64url(createHmac("sha256", KEY).update(body).digest());
}

/** Mint an opaque id for a resolved document. */
export function mintDocId(payload: DocIdPayload): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf-8"));
  return `${body}.${sign(body)}`;
}

/**
 * Verify + decode. Returns null on ANY defect (shape, signature, JSON, missing
 * field) — the caller then 404s with a generic message rather than explaining
 * which part failed, so the endpoint is not an oracle.
 */
export function parseDocId(id: unknown): DocIdPayload | null {
  if (typeof id !== "string" || id.length === 0 || id.length > 4096) return null;
  const dot = id.lastIndexOf(".");
  if (dot <= 0 || dot === id.length - 1) return null;

  const body = id.slice(0, dot);
  const sig = id.slice(dot + 1);
  const expected = sign(body);

  // Constant-time compare — lengths must match first (timingSafeEqual throws
  // on a length mismatch, which would itself be a side channel).
  const a = Buffer.from(sig, "utf-8");
  const b = Buffer.from(expected, "utf-8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(unb64url(body).toString("utf-8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  for (const k of ["t", "s", "p", "r", "root", "rel", "rev", "f"]) {
    if (typeof o[k] !== "string" || (o[k] as string).length === 0) return null;
  }
  return o as unknown as DocIdPayload;
}
