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

/** Same contract as `fetchFileText` (413 / client cap -> FileTooLargeError). */
export function fetchSessionFileText(taskId: string, path: string): Promise<{ text: string; size: number }> {
  return fetchTextFile(sessionFileUrl(taskId, path));
}
