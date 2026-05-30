/*
 * prStatusApi.ts — open/merged status source for the transcript PrLinkCard
 * (iterate-2026-05-30-pr-card-status). Backed by GET /api/external/pr-status
 * (gh CLI). Split out of externalApi.ts to keep that file off the
 * bloat-ratchet ceiling. `PrState`/`PrStatus` are a verbatim mirror of the
 * server's `server/src/core/pr-status.ts` (ADR-080 — no cross-package import).
 */

import { EXTERNAL_API, httpJson } from "./externalApi";

export type PrState = "open" | "merged" | "closed" | "draft" | "unknown";

export interface PrStatus {
  state: PrState;
  merged: boolean;
}

export async function getPrStatus(prUrl: string): Promise<PrStatus> {
  return await httpJson<PrStatus>(
    `${EXTERNAL_API}/pr-status?url=${encodeURIComponent(prUrl)}`,
  );
}
