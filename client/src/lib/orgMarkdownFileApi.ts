/*
 * orgMarkdownFileApi.ts — mirrors `markdownFileApi.ts`'s exact load/save
 * shape (`loadMarkdownForEdit`/`saveMarkdown`/`MarkdownConflictError`),
 * pointed at the new `/api/org/leads/:leadId/charter` proxy instead of the
 * project-scoped `/api/external/.../file` route (iterate spec Design
 * Notes, "Markdown modal reuse — additive, not breaking"). This is the
 * ONLY browser write this iterate — AC-10 refuses every other org document
 * server-side.
 */

import { decodeApiError } from "./externalApi";
import { ORG_API } from "./orgApi";
// Reused, NOT redeclared: `MarkdownEditorModal`'s `doSave` catches conflicts
// via `err instanceof MarkdownConflictError` against THIS class — a second,
// identically-named class here would silently fail that check for every
// caller that passes this module as the injected `saveOverride`.
import { MarkdownConflictError } from "./markdownFileApi";

export interface MarkdownFileLoad {
  text: string;
  /** Bare content-hash fingerprint (quotes stripped from the ETag). */
  fingerprint: string;
}

export { MarkdownConflictError };

function stripQuotes(raw: string | null): string {
  if (!raw) return "";
  const t = raw.trim();
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;
}

function charterUrl(leadId: string): string {
  return `${ORG_API}/leads/${encodeURIComponent(leadId)}/charter`;
}

/**
 * Load a lead's `charter.md` FRESH for editing, capturing the strong-ETag
 * content hash as the `fingerprint` so a subsequent {@link saveMarkdown}
 * can use it as the `If-Match` precondition. Throws {@link ApiError} on
 * any non-2xx (via `decodeApiError`).
 *
 * NOTE: `leadId` takes the place of `markdownFileApi.ts`'s `projectId`
 * parameter — this module has no project scoping at all, since the org
 * proxy resolves `leadsRoot` server-side, not per-project.
 */
export async function loadMarkdownForEdit(leadId: string): Promise<MarkdownFileLoad> {
  // The charter proxy is a PUT-only route (see routes/org.ts) — reading the
  // current content + fingerprint goes through the same GET-capable file
  // read the shared-documents block uses, scoped to this lead's charter.
  const r = await fetch(
    `${ORG_API}/file?path=${encodeURIComponent(`${leadId}/charter.md`)}`,
    { cache: "no-store" },
  );
  if (!r.ok) throw await decodeApiError(r);
  const text = await r.text();
  return { text, fingerprint: stripQuotes(r.headers.get("etag")) };
}

/**
 * Save a lead's `charter.md` via `PUT` with an `If-Match` precondition.
 * Returns the new fingerprint on success. Throws
 * {@link MarkdownConflictError} on 409 (stale fingerprint) and
 * {@link ApiError} on every other failure.
 */
export async function saveMarkdown(
  leadId: string,
  text: string,
  fingerprint: string,
): Promise<{ fingerprint: string }> {
  const r = await fetch(charterUrl(leadId), {
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
