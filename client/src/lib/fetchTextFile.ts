/*
 * fetchTextFile — the ONE text-read contract shared by the project file route
 * (`fetchFileText`) and the task-scoped session-file route (`fetchSessionFileText`):
 * a 413 or a client-side > 1 MB body becomes a FileTooLargeError, any other
 * non-2xx an ApiError. Kept out of externalApi.ts (bloat ceiling).
 */
import { CLIENT_FILE_TEXT_MAX_BYTES, FileTooLargeError, decodeApiError } from "./externalApi";

export async function fetchTextFile(url: string): Promise<{ text: string; size: number }> {
  const r = await fetch(url);
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
