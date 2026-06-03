/*
 * mediaApi — URL builder for the Range-streaming video route
 * (iterate-2026-06-03-smartviewer-video-view).
 *
 * Lives in its own module (not externalApi.ts, which is at the bloat
 * ceiling). Like `fileUrl`, this is a pure URL builder — the <video>
 * element streams the bytes directly (with Range requests), so there is
 * no fetch here.
 */

import { EXTERNAL_API } from "./externalApi";

/**
 * Build the `GET …/media?path=` URL for a project-root-relative POSIX
 * path. Used by `VideoRenderer` as `<video src={mediaUrl(...)}>`.
 */
export function mediaUrl(projectId: string, path: string): string {
  const q = new URLSearchParams({ path });
  return `${EXTERNAL_API}/projects/${encodeURIComponent(projectId)}/media?${q.toString()}`;
}
