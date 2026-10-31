/*
 * sessionFileApi — client of GET /api/external/tasks/:id/session-file?path=<abs|rel>
 * (V4). Serves a file for the Smart Viewer scoped to ONE task: inside the
 * project root like the project file route, outside it only when that session
 * evidences the path. Kept out of externalApi.ts (bloat ceiling).
 */
import {
  CLIENT_FILE_TEXT_MAX_BYTES,
  EXTERNAL_API,
  FileTooLargeError,
  decodeApiError,
} from "./externalApi";

export function sessionFileUrl(taskId: string, path: string): string {
  const q = new URLSearchParams({ path });
  return `${EXTERNAL_API}/tasks/${encodeURIComponent(taskId)}/session-file?${q.toString()}`;
}

/** Same contract as `fetchFileText` (413 / client cap -> FileTooLargeError). */
export async function fetchSessionFileText(
  taskId: string,
  path: string,
): Promise<{ text: string; size: number }> {
  const r = await fetch(sessionFileUrl(taskId, path));
  if (r.status === 413) {
    let payload: Record<string, unknown> = {};
    try {
      payload = (await r.json()) as Record<string, unknown>;
    } catch {
      /* swallow */
    }
    const maxBytes = typeof payload.maxBytes === "number" ? payload.maxBytes : 5 * 1024 * 1024;
    const size = typeof payload.size === "number" ? payload.size : undefined;
    throw new FileTooLargeError(maxBytes, "server", size);
  }
  if (!r.ok) throw await decodeApiError(r);
  const text = await r.text();
  if (text.length > CLIENT_FILE_TEXT_MAX_BYTES) {
    throw new FileTooLargeError(CLIENT_FILE_TEXT_MAX_BYTES, "client", text.length);
  }
  return { text, size: text.length };
}
