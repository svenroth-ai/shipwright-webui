/*
 * markdownFileApi.ts — client wrappers for the SmartViewer markdown editor's
 * load + save round-trip (iterate-2026-06-03-smartviewer-markdown-editor, FR-01.34).
 *
 * Kept in its OWN module (not `externalApi.ts`, which is at its bloat ceiling —
 * see project memory) and imports the shared `fileUrl` + `ApiError` helpers.
 *
 * Optimistic concurrency: `loadMarkdownForEdit` captures the GET response's
 * strong content-hash `ETag`; `saveMarkdown` echoes it back as `If-Match`. A
 * 409 (the file changed on disk since load — e.g. a Claude session edited it in
 * the embedded terminal) surfaces as a typed {@link MarkdownConflictError} so
 * the editor modal can block + offer reload instead of silently clobbering.
 */

import { decodeApiError, fileUrl } from "./externalApi";

export interface MarkdownFileLoad {
  text: string;
  /** Bare content-hash fingerprint (quotes stripped from the ETag). */
  fingerprint: string;
}

/** Thrown by {@link saveMarkdown} on a 409 fingerprint mismatch. */
export class MarkdownConflictError extends Error {
  readonly currentFingerprint: string | null;
  constructor(currentFingerprint: string | null) {
    super("fingerprint_mismatch");
    this.name = "MarkdownConflictError";
    this.currentFingerprint = currentFingerprint;
  }
}

function stripQuotes(raw: string | null): string {
  if (!raw) return "";
  const t = raw.trim();
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;
}

/**
 * Load a markdown file FRESH for editing, capturing the strong-ETag content
 * hash as the `fingerprint` so a subsequent {@link saveMarkdown} can use it as
 * the `If-Match` precondition. Throws {@link ApiError} on any non-2xx.
 */
export async function loadMarkdownForEdit(
  projectId: string,
  path: string,
): Promise<MarkdownFileLoad> {
  const r = await fetch(fileUrl(projectId, path), { cache: "no-store" });
  if (!r.ok) throw await decodeApiError(r);
  const text = await r.text();
  return { text, fingerprint: stripQuotes(r.headers.get("etag")) };
}

/**
 * Save markdown via `PUT` with an `If-Match` precondition. Returns the new
 * fingerprint on success. Throws {@link MarkdownConflictError} on 409 (stale
 * fingerprint) and {@link ApiError} on every other failure (415/413/400/…).
 */
export async function saveMarkdown(
  projectId: string,
  path: string,
  text: string,
  fingerprint: string,
): Promise<{ fingerprint: string }> {
  const r = await fetch(fileUrl(projectId, path), {
    method: "PUT",
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "If-Match": `"${fingerprint}"`,
    },
    body: text,
  });
  if (r.status === 409) {
    let current: string | null = null;
    try {
      const j = (await r.json()) as Record<string, unknown>;
      if (typeof j.currentFingerprint === "string") current = j.currentFingerprint;
    } catch {
      /* ignore body parse failure — still a conflict */
    }
    throw new MarkdownConflictError(current);
  }
  if (!r.ok) throw await decodeApiError(r);
  const j = (await r.json()) as { fingerprint?: string };
  return { fingerprint: typeof j.fingerprint === "string" ? j.fingerprint : "" };
}
