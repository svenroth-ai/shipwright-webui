/*
 * MermaidRenderer — lazy-imports mermaid, content-hash memoizes via a
 * DOM-level data-attribute (so memo survives React.StrictMode's
 * double-mount pattern), and replaces the SVG in-place on re-render.
 *
 * Lazy import: mermaid is ~1.5 MB. We `import("mermaid")` inside an
 * effect so Vite code-splits it into its own chunk. TaskDetail's entry
 * chunk stays small; users only pay for mermaid if they open a mermaid
 * document (either a `.mmd` / `.mermaid` file via SmartViewer, or a
 * `\`\`\`mermaid` fence in any markdown rendered via MarkdownText).
 *
 * 2026-04-23 — iterate-20260423-mermaid-flicker-fix.
 * The previous implementation tracked the content-hash memo in a useRef
 * and cleared BOTH the container DOM and the ref in the effect cleanup.
 * React.StrictMode double-invokes effects in dev (mount → cleanup →
 * mount), so every first render went through a full re-render cycle:
 * loading → blank → loading → SVG. The fix stamps the hash onto the
 * container's `dataset.mermaidHash` — the same DOM node survives the
 * cleanup, so the second mount short-circuits once the first mount's
 * async commit lands. Cleanup now only flips the `disposed` flag.
 */

import { memo, useEffect, useRef, useState } from "react";
import { Loader2, Maximize2, Minimize2 } from "lucide-react";

interface Props {
  text: string;
  /** Optional override; falls back to `text` itself for memoisation. */
  contentHash?: string;
}

/**
 * Tiny non-cryptographic hash — FNV-1a-style, sufficient for memo keys.
 * We never use this for security, only for "did the content change".
 */
function hashSource(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/**
 * Is the surface the diagram sits on dark? Walks up from `el` to the first
 * ancestor with an (at least half) opaque background — the pane's own card,
 * not just <body> — and falls back to the OS preference. Mermaid's default
 * theme is light (white/yellow), unreadable on a dark surface.
 */
export function prefersDarkSurface(el: Element | null = null): boolean {
  try {
    for (let n: Element | null = el ?? document.body; n; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(bg);
      if (m && (m[4] === undefined || Number(m[4]) >= 0.5)) {
        return (0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3]) / 255 < 0.5;
      }
    }
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  } catch {
    return false;
  }
}

function MermaidRendererImpl({ text, contentHash }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Wide diagrams (e.g. `flowchart LR` with many subgraphs) render at natural
  // size and scroll; "fit" squeezes them into the pane width instead.
  const [fit, setFit] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let disposed = false;
    const hash = contentHash ?? hashSource(text);
    const el = containerRef.current;
    if (!el) return;

    // DOM-level memo: if the container already holds a committed SVG
    // whose hash matches, nothing to do. This is the StrictMode
    // short-circuit — the second mount sees the first mount's committed
    // DOM and skips re-rendering.
    const existing = el.querySelector("svg");
    if (existing && el.dataset.mermaidHash === hash) {
      if (loading) setLoading(false);
      if (error) setError(null);
      return () => {
        disposed = true;
      };
    }

    // Fresh content (or first-ever render). Do NOT pre-clear the
    // container — innerHTML-assignment at the end replaces any prior
    // SVG in a single atomic swap, which avoids a visible "blank" frame
    // between the previous SVG and the new one. On the first render
    // the container is already empty so there's nothing to clear.
    if (!loading) setLoading(true);
    if (error) setError(null);

    const renderId = `mermaid-${hash}-${Date.now().toString(36)}`;
    void import("mermaid")
      .then(async (mod) => {
        if (disposed) return;
        const mermaid = mod.default;
        try {
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            theme: prefersDarkSurface(el) ? "dark" : "default",
            // Natural size: max-width:100% shrank wide graphs to unreadable specks.
            flowchart: { useMaxWidth: false },
            sequence: { useMaxWidth: false },
            gantt: { useMaxWidth: false },
            er: { useMaxWidth: false },
            state: { useMaxWidth: false },
            class: { useMaxWidth: false },
          });
          const { svg } = await mermaid.render(renderId, text);
          if (disposed || !containerRef.current) return;
          containerRef.current.innerHTML = svg;
          containerRef.current.dataset.mermaidHash = hash;
          setLoading(false);
        } catch (err) {
          if (disposed) return;
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      })
      .catch((err) => {
        if (disposed) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });

    // Minimal cleanup — only cancel the pending async. Crucially, do
    // NOT wipe the container or the dataset.mermaidHash: doing so would
    // force the StrictMode twin mount to re-render from scratch,
    // which is exactly the flicker this iterate fixes.
    return () => {
      disposed = true;
    };
    // `loading` and `error` are intentionally NOT in the dep array —
    // they're internal state this effect manages, not inputs. Including
    // them would cause the effect to re-fire on every state flip and
    // re-trigger a mermaid render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, contentHash]);

  return (
    <div
      className="smart-viewer-mermaid h-full overflow-auto p-1"
      style={{ background: "var(--color-surface, #ffffff)" }}
      data-testid="smart-viewer-mermaid"
    >
      {loading && !error && (
        <div
          className="flex items-center gap-2 text-[12px]"
          style={{ color: "var(--color-muted, #6b7280)" }}
          data-testid="smart-viewer-mermaid-loading"
        >
          <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          Rendering diagram…
        </div>
      )}
      {error && (
        <div
          className="rounded-md border border-[var(--color-error,#DC2626)]/40 bg-[var(--color-error,#DC2626)]/10 p-3 text-[12px]"
          style={{ color: "var(--color-error, #DC2626)" }}
          data-testid="smart-viewer-mermaid-error"
        >
          Mermaid failed to render: {error}
        </div>
      )}
      {!loading && !error && (
      <button
        type="button"
        onClick={() => setFit((v) => !v)}
        className="mb-2 inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px]"
        style={{ color: "var(--color-muted, #6b7280)", borderColor: "currentColor" }}
        aria-pressed={fit}
        data-testid="smart-viewer-mermaid-fit"
      >
        {fit ? <Minimize2 size={12} aria-hidden="true" /> : <Maximize2 size={12} aria-hidden="true" />}
        Fit to width
      </button>
      )}
      <div
        ref={containerRef}
        data-testid="smart-viewer-mermaid-svg"
        className={fit ? "[&_svg]:h-auto [&_svg]:max-w-full" : "[&_svg]:!max-w-none"}
      />
    </div>
  );
}

// 2026-04-23 — iterate-20260423-mermaid-render-loop-fix.
// Defensive React.memo. If the parent (MarkdownText inside a poll-driven
// TaskDetailPage) ever re-renders with an identical `text` prop,
// MermaidRenderer skips its body entirely. Together with the hoisted
// components object in MarkdownText, this breaks the permanent-flicker
// loop caused by the 1-Hz transcript polling cadence.
export const MermaidRenderer = memo(MermaidRendererImpl);
