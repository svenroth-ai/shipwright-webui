/*
 * fileExistsApi.ts — client wrapper for the batched existence check
 * (iterate-2026-08-30-triage-file-viewer-followups).
 *
 * Kept out of externalApi.ts deliberately: that file is already at its
 * bloat ceiling (grandfathered 862/300 lines) — a new, single-purpose
 * function belongs in its own file rather than ratcheting it further.
 */
import { EXTERNAL_API, decodeApiError } from "./externalApi";

/**
 * GET /api/external/projects/:projectId/files/exist?paths=a,b,c — resolves
 * which of the given project-root-relative paths actually exist as a real,
 * readable file. Used to decide whether a detected file mention (structured
 * `evidencePath` or a free-text regex match) should render as a clickable
 * link or plain text — a mention can point at a planned-but-not-yet-built
 * artifact or a deleted/renamed file.
 *
 * Returns an empty map for an empty `paths` input without a network call.
 */
export async function checkFilesExist(
  projectId: string,
  paths: string[],
): Promise<Record<string, boolean>> {
  if (paths.length === 0) return {};
  // Each path is percent-encoded before joining so a literal comma inside a
  // (rare but legal) filename can't be mistaken for the delimiter — the
  // server decodes each split segment back (code-review finding,
  // iterate-2026-08-30-triage-file-viewer-followups).
  const q = new URLSearchParams({ paths: paths.map(encodeURIComponent).join(",") });
  const url = `${EXTERNAL_API}/projects/${encodeURIComponent(projectId)}/files/exist?${q.toString()}`;
  const r = await fetch(url);
  if (!r.ok) {
    throw await decodeApiError(r);
  }
  const body = (await r.json()) as { exists: Record<string, boolean> };
  return body.exists;
}
