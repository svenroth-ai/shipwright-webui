/*
 * HtmlRenderer — renders an .html/.htm file in a sandboxed iframe, with a
 * Preview | Source toggle (Source reuses CodeRenderer).
 *
 * Security: the file is untrusted content. The iframe is sandboxed WITHOUT
 * `allow-same-origin`, so it gets an opaque origin and can never reach the
 * webui's cookies, storage or /api. Scripts may run (boards are interactive),
 * but an injected CSP forbids fetch/XHR/WebSocket connections and form
 * submission, so a rendered page cannot save anything back to the app. It can
 * still make outbound requests (https images/fonts, navigation, popups), and the
 * resources the viewer embeds for it (below) are readable by its scripts: what
 * is at stake is the page's own content PLUS the images / stylesheets / fonts it
 * names in its own folder tree (accepted residual risk, ADR of
 * iterate-2026-11-02-smartviewer-html-images). Links open in
 * a new tab (`allow-popups` + `allow-popups-to-escape-sandbox`,
 * `<base target=_blank>`).
 *
 * Resources: the srcdoc has no base URL, so a relative stylesheet or image can
 * never load. With `path` and a `projectId` (project file) or `sessionTaskId`
 * (file outside the project) the page's relative stylesheets, images and the
 * `url()` / `@import` inside its CSS are read through the file API and inlined
 * (inlineHtmlResources); the iframe is held until that finishes so it loads
 * once, already complete. `onPopOut` adds the Pop out control (the
 * modal-nested instance omits it).
 */

import { useEffect, useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";

import { fileUrl } from "../../../lib/externalApi";
import { sessionFileUrl } from "../../../lib/sessionFileApi";
import { CodeRenderer } from "./CodeRenderer";
import { createResourceLoader } from "./htmlResourceLoader";
import { inlineHtmlResources } from "./inlineHtmlResources";

const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src data: https://fonts.gstatic.com; img-src data: blob: https:; media-src data: blob:; " +
  "connect-src 'none'; form-action 'none'";

/** Prepends the CSP meta + `<base target=_blank>` so they precede any author markup. */
export function buildHtmlSrcDoc(text: string): string {
  // A doctype must stay FIRST or the iframe falls into quirks mode; it carries
  // no script, so emitting it ahead of the CSP is safe.
  const doctype = /^\uFEFF?\s*<!doctype[^>]*>/i.exec(text);
  if (doctype) text = text.slice(doctype[0].length);
  const head = (doctype ? doctype[0].replace(/^\uFEFF?\s*/, "") : "") +
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">` +
    `<base target="_blank">`;
  return head + text;
}

interface Props {
  text: string;
  /** With `path`: relative stylesheets / images are loaded from the project and inlined. */
  projectId?: string;
  /** Alternative to `projectId` for a file OUTSIDE the project: `path` is then absolute. */
  sessionTaskId?: string;
  path?: string;
  /** Open the centered in-app pop-out modal (omitted inside the modal). */
  onPopOut?: () => void;
}

export function HtmlRenderer({ text, projectId, sessionTaskId, path, onPopOut }: Props) {
  const [mode, setMode] = useState<"preview" | "source">("preview");
  const [inlined, setInlined] = useState<{
    scope: string;
    path: string;
    html: string;
  } | null>(null);
  // Which file API the page's resources come from; a different scope or file is never shown from a stale result.
  const scope = projectId ? `p:${projectId}` : sessionTaskId ? `t:${sessionTaskId}` : "";
  const wantsInline = Boolean(scope && path);

  useEffect(() => {
    if (!scope || !path) return;
    let cancelled = false;
    const done = (html: string) => {
      if (!cancelled) setInlined({ scope, path, html });
    };
    const loader = createResourceLoader((p) => (projectId ? fileUrl(projectId, p) : sessionFileUrl(sessionTaskId ?? "", p, path)));
    inlineHtmlResources(text, path, loader)
      .then(done)
      .catch(() => done(text));
    return () => {
      cancelled = true;
      loader.dispose(); // the page was replaced: stop fetching for it
    };
  }, [text, scope, projectId, sessionTaskId, path]);

  // Hold the iframe until the stylesheets are inlined: one load, no unstyled
  // flash, and the page's scripts run once. A result for ANOTHER project/file
  // is never shown; when only `text` changed (same project + file) the previous
  // frame stays up until the fresh result arrives, so it does not flash.
  const sameTarget = inlined?.scope === scope && inlined?.path === path;
  const showFrame = !wantsInline || sameTarget;
  const srcDoc = useMemo(
    () => buildHtmlSrcDoc(wantsInline && sameTarget && inlined ? inlined.html : text),
    [text, inlined, wantsInline, sameTarget],
  );

  const tab = (value: "preview" | "source", label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === value}
      onClick={() => setMode(value)}
      data-testid={`smart-viewer-html-${value}`}
      className={`rounded px-2.5 py-0.5 text-[12px] font-semibold ${mode === value ? "bg-[var(--color-muted-bg,#ede8e1)] text-[var(--color-text,#1a1a1a)]" : "text-[var(--color-muted,#6b7280)]"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex h-full flex-col" data-testid="smart-viewer-html">
      <div className="flex shrink-0 items-center gap-1 border-b border-[var(--color-border,#e0dbd4)] px-2 py-1">
        <div role="tablist" className="flex gap-1">
          {tab("preview", "Preview")}
          {tab("source", "Source")}
        </div>
        {onPopOut && (
          <button
            type="button"
            onClick={onPopOut}
            className="ml-auto inline-flex items-center gap-1 rounded-[6px] px-2 py-0.5 text-[11px] font-medium text-[var(--color-muted,#6b7280)] hover:bg-[var(--color-muted-bg,#ede8e1)]"
            data-testid="smart-viewer-popout"
            title="Expand to a larger view"
          >
            <ExternalLink size={12} aria-hidden="true" />
            Pop out
          </button>
        )}
      </div>
      <div className={`min-h-0 flex-1 ${mode === "preview" ? "overflow-hidden" : "overflow-auto"}`}>
        {mode === "preview" && !showFrame ? (
          <div className="flex h-full items-center justify-center text-[12px] text-[var(--color-muted,#6b7280)]" data-testid="smart-viewer-html-loading">
            Loading…
          </div>
        ) : mode === "preview" ? (
          <iframe
            title="HTML preview"
            sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
            srcDoc={srcDoc}
            referrerPolicy="no-referrer"
            className="h-full w-full border-0 bg-white"
            data-testid="smart-viewer-html-frame"
          />
        ) : (
          <CodeRenderer text={text} extension="html" />
        )}
      </div>
    </div>
  );
}
