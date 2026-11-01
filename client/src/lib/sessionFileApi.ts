/*
 * sessionFileApi — client of GET /api/external/tasks/:id/session-file?path=<abs|rel>
 * (V4). Serves a file for the Smart Viewer scoped to ONE task: inside the
 * project root like the project file route, outside it only when that session
 * evidences the path. Kept out of externalApi.ts (bloat ceiling).
 */
import { EXTERNAL_API } from "./externalApi";
import { fetchTextFile } from "./fetchTextFile";

export function sessionFileUrl(taskId: string, path: string): string {
  const q = new URLSearchParams({ path });
  return `${EXTERNAL_API}/tasks/${encodeURIComponent(taskId)}/session-file?${q.toString()}`;
}

/**
 * Cheap pre-check for a terminal link: does the session-file route refuse this path as
 * "not part of this session" (403: unevidenced or sensitive)? Only the status is read; the
 * body is cancelled. Anything else (including a network failure) is "not refused": the Viewer
 * shows its own not-found / too-large / error state. The server stays the sole authority.
 */
export async function isRefusedBySession(taskId: string, path: string): Promise<boolean> {
  try {
    const r = await fetch(sessionFileUrl(taskId, path));
    if (r.status !== 403) {
      void r.body?.cancel().catch(() => undefined);
      return false;
    }
    // A scan that hit its window is "could not check", not "refused": let the Viewer report it.
    const body = (await r.json().catch(() => ({}))) as { detail?: unknown };
    return body.detail !== "evidence_window_truncated";
  } catch {
    return false;
  }
}

/** Same contract as `fetchFileText` (413 / client cap -> FileTooLargeError). */
export function fetchSessionFileText(taskId: string, path: string): Promise<{ text: string; size: number }> {
  return fetchTextFile(sessionFileUrl(taskId, path));
}
