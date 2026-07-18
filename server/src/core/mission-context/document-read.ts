/*
 * core/mission-context/document-read.ts — the artifact-detail endpoint's
 * document read (CONTRACT §5.2).
 *
 * Split out of `resolver.ts` in Slice 2: that file is the ORCHESTRATION of a
 * context response, while this is a single re-read on a later, unrelated
 * request. Keeping them together pushed resolver.ts past the 300-LOC rule and
 * the two have no shared state — only the guards, which live in
 * `worktree-roots.ts` either way.
 */

import { existsSync } from "node:fs";

import { docFingerprint, readBounded } from "./resolver-parts.js";
import { MAX_DOC_BYTES, resolveFirstDoc } from "./worktree-roots.js";

/**
 * Re-resolve a document for the detail endpoint. `expectFingerprint` implements
 * AC3's "changed → stale": the descriptor promised a specific revision, so a
 * rewritten file reports `changed` rather than serving different content under
 * an id the client believes points at what it was shown.
 */
export function readDocumentBody(
  root: string,
  relParts: string[],
  expectFingerprint?: string,
):
  | { ok: true; body: string }
  | { ok: false; reason: "denied" | "not_found" | "too_large" | "changed" } {
  const r = resolveFirstDoc(root, [relParts]);
  if (!r.ok) return { ok: false, reason: r.reason === "denied" ? "denied" : "not_found" };
  if (r.sizeBytes > MAX_DOC_BYTES) return { ok: false, reason: "too_large" };
  if (!existsSync(r.absolute)) return { ok: false, reason: "not_found" };
  if (expectFingerprint && docFingerprint(r.absolute) !== expectFingerprint) {
    return { ok: false, reason: "changed" };
  }
  const body = readBounded(r.absolute);
  if (body == null) return { ok: false, reason: "not_found" };
  return { ok: true, body };
}
