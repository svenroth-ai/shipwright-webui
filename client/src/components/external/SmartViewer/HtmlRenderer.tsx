/*
 * HtmlRenderer — renders an .html/.htm file in a sandboxed iframe, with a
 * Preview | Source toggle (Source reuses CodeRenderer).
 *
 * Security: the file is untrusted content. The iframe is sandboxed WITHOUT
 * `allow-same-origin`, so it gets an opaque origin and can never reach the
 * webui's cookies, storage or /api. Scripts may run (boards are interactive),
 * but an injected CSP forbids fetch/XHR/WebSocket connections and form submission, so
 * a rendered page cannot save anything back to the app. It can still make outbound
 * requests (https images/fonts, navigation, popups): the origin is opaque, so only the file's own content is at stake. Links open in a new tab
 * (`allow-popups` + `allow-popups-to-escape-sandbox`, `<base target=_blank>`).
 */

import { useMemo, useState } from "react";

import { CodeRenderer } from "./CodeRenderer";

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
}

export function HtmlRenderer({ text }: Props) {
  const [mode, setMode] = useState<"preview" | "source">("preview");
  const srcDoc = useMemo(() => buildHtmlSrcDoc(text), [text]);

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
      <div role="tablist" className="flex shrink-0 gap-1 border-b border-[var(--color-border,#e0dbd4)] px-2 py-1">
        {tab("preview", "Preview")}
        {tab("source", "Source")}
      </div>
      <div className={`min-h-0 flex-1 ${mode === "preview" ? "overflow-hidden" : "overflow-auto"}`}>
        {mode === "preview" ? (
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
