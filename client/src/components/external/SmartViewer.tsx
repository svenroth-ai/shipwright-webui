/*
 * SmartViewer — right-pane of the TaskDetail 3-pane body (iterate 3
 * section 04, FR-03.34).
 *
 * Extension dispatch:
 *   .md / .markdown   → MarkdownRenderer
 *   .mmd / .mermaid   → MermaidRenderer (lazy-imported)
 *   .png .jpg .jpeg .gif .svg .webp → ImageRenderer (browser-streamed)
 *   known-code exts   → CodeRenderer (rehype-highlight common bundle)
 *   everything else   → TextRenderer
 *
 * Client-side cap: text/markdown/code files > 1 MB render the
 * "File too large to preview inline" chip instead of calling into
 * react-markdown / rehype-highlight (plan § 7 G4 + O33). Images use the
 * server's 5 MB budget directly.
 */

import { useEffect, useState } from "react";
import { AlertCircle, FileQuestion, FileText } from "lucide-react";

import {
  CLIENT_FILE_TEXT_MAX_BYTES,
  FileTooLargeError,
  fetchFileText,
  ApiError,
} from "../../lib/externalApi";
import { MarkdownRenderer } from "./SmartViewer/MarkdownRenderer";
import { SmartViewerModal } from "./SmartViewer/SmartViewerModal";
import { CodeRenderer } from "./SmartViewer/CodeRenderer";
import { TextRenderer } from "./SmartViewer/TextRenderer";
import { ImageRenderer } from "./SmartViewer/ImageRenderer";
import { VideoRenderer } from "./SmartViewer/VideoRenderer";
import { MermaidRenderer } from "./SmartViewer/MermaidRenderer";
import { useDocNavigation } from "./SmartViewer/useDocNavigation";
import { PathStrip } from "./SmartViewer/PathStrip";

export type SmartViewerKind = "markdown" | "code" | "text" | "image" | "video" | "mermaid" | "unknown";

const MARKDOWN_EXTS = new Set(["md", "markdown"]);
const MERMAID_EXTS = new Set(["mmd", "mermaid"]);
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp"]);
const VIDEO_EXTS = new Set(["mp4", "m4v", "webm", "ogv", "ogg", "mov"]);
const CODE_EXTS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "c",
  "h",
  "cpp",
  "hpp",
  "json",
  "yaml",
  "yml",
  "toml",
  "sh",
  "bash",
  "zsh",
  "sql",
  "html",
  "xml",
  "css",
]);

export function resolveKind(path: string): { kind: SmartViewerKind; ext: string } {
  const dot = path.lastIndexOf(".");
  const ext = dot >= 0 ? path.slice(dot + 1).toLowerCase() : "";
  if (MARKDOWN_EXTS.has(ext)) return { kind: "markdown", ext };
  if (MERMAID_EXTS.has(ext)) return { kind: "mermaid", ext };
  if (IMAGE_EXTS.has(ext)) return { kind: "image", ext };
  if (VIDEO_EXTS.has(ext)) return { kind: "video", ext };
  if (CODE_EXTS.has(ext)) return { kind: "code", ext };
  if (ext === "txt" || ext === "log" || ext === "csv" || ext === "env" || ext === "gitignore") {
    return { kind: "text", ext };
  }
  return { kind: "unknown", ext };
}

interface Props {
  projectId: string;
  /** Project-root-relative POSIX path; null = empty state. */
  path: string | null;
  /** Show the pop-out control (default). Set false for the modal-nested
   *  instance so the expanded view renders no further pop-out button. */
  popOut?: boolean;
}

export function SmartViewer({ projectId, path, popOut = true }: Props) {
  if (!path) {
    return (
      <div
        className="flex h-full items-center justify-center p-6"
        data-testid="smart-viewer-empty"
      >
        <div
          className="flex flex-col items-center gap-2 text-[12px]"
          style={{ color: "var(--color-muted, #6b7280)" }}
        >
          <FileText size={24} aria-hidden="true" />
          <span>Select a file from the tree to preview.</span>
        </div>
      </div>
    );
  }

  const { kind, ext } = resolveKind(path);

  if (kind === "image" || kind === "video") {
    const MediaRenderer = kind === "image" ? ImageRenderer : VideoRenderer;
    return (
      <div
        className="flex h-full flex-col"
        data-testid="smart-viewer"
      >
        <PathStrip path={path} size={null} />
        <div className="min-h-0 flex-1">
          <MediaRenderer projectId={projectId} path={path} />
        </div>
      </div>
    );
  }

  if (kind === "unknown") {
    return (
      <div
        className="flex h-full flex-col"
        data-testid="smart-viewer"
      >
        <PathStrip path={path} size={null} />
        <div
          className="flex flex-1 items-center justify-center p-6 text-[12px]"
          style={{ color: "var(--color-muted, #6b7280)" }}
          data-testid="smart-viewer-unknown"
        >
          <div className="flex flex-col items-center gap-2">
            <FileQuestion size={24} aria-hidden="true" />
            <span>Unsupported file type ({ext || "no extension"}).</span>
          </div>
        </div>
      </div>
    );
  }

  return <TextFileViewer projectId={projectId} path={path} kind={kind} ext={ext} popOut={popOut} />;
}

interface TextProps {
  projectId: string;
  path: string;
  kind: Exclude<SmartViewerKind, "image" | "unknown">;
  ext: string;
  popOut: boolean;
}

function TextFileViewer({ projectId, path, kind, ext, popOut }: TextProps) {
  const nav = useDocNavigation(path); // AC8 in-pane cross-file navigation
  const [popoutOpen, setPopoutOpen] = useState(false);
  // Bumped after a successful in-app markdown edit so the preview re-fetches.
  const [reloadNonce, setReloadNonce] = useState(0);
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ok"; text: string; size: number }
    | { status: "too_large"; maxBytes: number; source: "server" | "client" }
    | { status: "error"; message: string }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetchFileText(projectId, nav.effectivePath)
      .then((res) => {
        if (cancelled) return;
        setState({ status: "ok", text: res.text, size: res.size });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof FileTooLargeError) {
          setState({
            status: "too_large",
            maxBytes: err.maxBytes,
            source: err.source,
          });
          return;
        }
        if (err instanceof ApiError) {
          setState({ status: "error", message: err.code });
          return;
        }
        setState({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
    // reloadNonce forces a fresh fetch after an in-app save; the `cancelled`
    // guard above discards any overlapping in-flight response (review #10).
  }, [projectId, nav.effectivePath, reloadNonce]);

  const size = state.status === "ok" ? state.size : null;

  const inner = (() => {
    if (state.status === "loading") {
      return (
        <div
          className="flex h-full items-center justify-center p-6 text-[12px]"
          style={{ color: "var(--color-muted, #6b7280)" }}
          data-testid="smart-viewer-loading"
        >
          Loading…
        </div>
      );
    }
    if (state.status === "too_large") {
      const mb = (state.maxBytes / (1024 * 1024)).toFixed(1);
      return (
        <div
          className="flex h-full items-center justify-center p-6"
          data-testid="smart-viewer-too-large"
        >
          <div
            className="flex max-w-md flex-col items-start gap-2 rounded-md border border-[var(--color-border,#e0dbd4)] bg-[var(--color-muted-bg,#ede8e1)] p-4 text-[12px]"
            style={{ color: "var(--color-text, #1a1a1a)" }}
          >
            <div className="flex items-center gap-2 font-medium">
              <AlertCircle
                size={14}
                style={{ color: "var(--color-warning, #D97706)" }}
                aria-hidden="true"
              />
              File too large to preview inline
            </div>
            <div style={{ color: "var(--color-muted, #6b7280)" }}>
              {state.source === "client"
                ? `Preview cap is ${mb} MB for text / markdown / code.`
                : `Server cap is ${mb} MB.`}
            </div>
            <code className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px]">
              {nav.effectivePath}
            </code>
          </div>
        </div>
      );
    }
    if (state.status === "error") {
      return (
        <div
          className="flex h-full items-center justify-center p-6 text-[12px]"
          style={{ color: "var(--color-error, #DC2626)" }}
          data-testid="smart-viewer-error"
        >
          <div className="flex flex-col items-center gap-2">
            <AlertCircle size={20} aria-hidden="true" />
            <span>Failed to load file: {state.message}</span>
          </div>
        </div>
      );
    }
    if (kind === "markdown") return <MarkdownRenderer text={state.text} onDocLinkClick={nav.navigateToDoc} scrollToFragment={nav.fragment} onPopOut={popOut ? () => setPopoutOpen(true) : undefined} projectId={projectId} path={nav.effectivePath} onSaved={popOut ? () => setReloadNonce((n) => n + 1) : undefined} />;
    if (kind === "code") return <CodeRenderer text={state.text} extension={ext} />;
    if (kind === "mermaid") return <MermaidRenderer text={state.text} />;
    return <TextRenderer text={state.text} />;
  })();

  return (
    <div className="flex h-full flex-col" data-testid="smart-viewer">
      <PathStrip path={nav.effectivePath} size={size} />
      <div className="min-h-0 flex-1 overflow-hidden">{inner}</div>
      {popOut && kind === "markdown" && (
        <SmartViewerModal
          open={popoutOpen}
          onOpenChange={setPopoutOpen}
          projectId={projectId}
          path={nav.effectivePath}
        />
      )}
    </div>
  );
}

export { CLIENT_FILE_TEXT_MAX_BYTES };
