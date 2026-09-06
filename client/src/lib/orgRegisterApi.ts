/*
 * orgRegisterApi.ts — the beat-register release fetcher (FR-04.41's release
 * action, browser-reachable as of iterate-2026-09-06-org-lead-staleness-
 * register). Split into its own module rather than growing `orgApi.ts`
 * further — same rationale as `orgMarkdownFileApi.ts` — that file's line
 * count is additionally bound by `org-schema-sync.test.ts`'s hardcoded
 * `CLIENT_PATH`, so new fetchers belong here, not there.
 */
import { ApiError } from "./externalApi";
import { ORG_API } from "./orgApi";

export type BeatRegisterReleaseResult =
  | { ok: true; recovered: true; residualLockWarning: string }
  | { ok: true; recovered: false }
  | { ok: false; reason: "not-found" | "fault"; detail: string };

/**
 * `POST /api/org/leads/:leadId/beat-register/release` — mirrors the
 * secret-gated route's contract exactly (same `performRelease` core on the
 * server, see `routes/org.ts`). Throws {@link ApiError} on every failure
 * this result shape doesn't itself carry — `beat_register_locked` (409, a
 * real second writer holds the lock), `beat_register_invalid` (502,
 * corrupt file), `symlink_forbidden` (403), `sessionId_invalid`/
 * `reason_invalid` (400), `unknown_lead` (403). The body is read exactly
 * once (a `Response` body cannot be read twice) — never call
 * `decodeApiError` here, it would re-read an already-consumed stream.
 */
export async function releaseBeatRegisterEntry(
  leadId: string,
  sessionId: string,
  reason: string,
): Promise<BeatRegisterReleaseResult> {
  const r = await fetch(`${ORG_API}/leads/${encodeURIComponent(leadId)}/beat-register/release`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, reason }),
  });
  let body: Record<string, unknown> = {};
  try {
    body = (await r.json()) as Record<string, unknown>;
  } catch {
    body = { error: `HTTP ${r.status}` };
  }
  if (r.status === 404 || (r.status === 409 && body.reason === "fault")) {
    return {
      ok: false,
      reason: body.reason === "fault" ? "fault" : "not-found",
      // External-review fix (Branch A/GLM, low): fall back to the HTTP
      // status rather than an empty string when the body carries no
      // `detail` — an unparseable 404 (e.g. a proxy/routing miss, not the
      // route's own not-found) would otherwise render as a bare "Could not
      // release: ", reading like a confirmed server verdict instead of an
      // unknown one.
      detail: typeof body.detail === "string" ? body.detail : `HTTP ${r.status}`,
    };
  }
  if (!r.ok) {
    const code = typeof body.error === "string" ? body.error : `http_${r.status}`;
    throw new ApiError(code, r.status, body);
  }
  return body as BeatRegisterReleaseResult;
}
