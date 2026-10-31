/*
 * SmartViewer — right-pane of the TaskDetail 3-pane body (iterate 3
 * section 04, FR-03.34).
 *
 * Extension dispatch:
 *   .md / .markdown   → MarkdownRenderer
 *   .mmd / .mermaid   → MermaidRenderer (lazy-imported)
 *   .html / .htm      → HtmlRenderer (sandboxed iframe, read-only; Source toggle)
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
import { HtmlRenderer } from "./SmartViewer/HtmlRenderer";
import { MermaidRenderer } from "./SmartViewer/MermaidRenderer";
import { useDocNavigation } from "./SmartViewer/useDocNavigation";
import { OutsideProjectHeader } from "./SmartViewer/OutsideProjectHeader";
import { TooLargeNotice } from "./SmartViewer/TooLargeNotice";
import { fetchSessionFileText } from "../../lib/sessionFileApi";

/** Outside files have no project to navigate: swallow relative-link clicks (no full page load). */
const NO_DOC_NAV = () => undefined;

export type SmartViewerKind = "markdown" | "code" | "text" | "image" | "video" | "mermaid" | "html" | "unknown";

const MARKDOWN_EXTS = new Set(["md", "markdown"]);
const MERMAID_EXTS = new Set(["mmd", "mermaid"]);
const HTML_EXTS = new Set(["html", "htm"]);
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp"]);
const VIDEO_EXTS = new Set(["mp4", "m4v", "webm", "ogv", "ogg", "mov"]);
const CODE_EXTS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rb", "go", "rs", "java", "kt",
  "c", "h", "cpp", "hpp", "json", "yaml", "yml", "toml", "sh", "bash", "zsh",
  "sql", "xml", "css",
]);

export function resolveKind(path: string): { kind: SmartViewerKind; ext: string } {
  const dot = path.lastIndexOf(".");
  const ext = dot >= 0 ? path.slice(dot + 1).toLowerCase() : "";
  if (MARKDOWN_EXTS.has(ext)) return { kind: "markdown", ext };
  if (MERMAID_EXTS.has(ext)) return { kind: "mermaid", ext };
  if (HTML_EXTS.has(ext)) return { kind: "html", ext };
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
  /** Set for a file OUTSIDE the project (V6): `path` is then absolute and is
   *  served by the task-scoped session-file route; a header names the scope. */
  sessionTaskId?: string;
}

export function SmartViewer({ projectId, path, popOut = true, sessionTaskId }: Props) {
  if (path && sessionTaskId) {
    return (
      <div className="flex h-full flex-col">
        <OutsideProjectHeader path={path} />
        <div className="min-h-0 flex-1">
          <SmartViewerBody projectId={projectId} path={path} popOut={popOut} sessionTaskId={sessionTaskId} />
        </div>
      </div>
    );
  }
  return <SmartViewerBody projectId={projectId} path={path} popOut={popOut} />;
}

function SmartViewerBody({ projectId, path, popOut = true, sessionTaskId }: Props) {
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
        <div className="min-h-0 flex-1">
          <MediaRenderer projectId={projectId} path={path} sessionTaskId={sessionTaskId} />
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

  return <TextFileViewer projectId={projectId} path={path} kind={kind} ext={ext} popOut={popOut} sessionTaskId={sessionTaskId} />;
}

interface TextProps {
  sessionTaskId?: string;
  projectId: string;
  path: string;
  kind: Exclude<SmartViewerKind, "image" | "unknown">;
  ext: string;
  popOut: boolean;
}

function TextFileViewer({ projectId, path, kind, ext, popOut, sessionTaskId }: TextProps) {
  const nav = useDocNavigation(path); // AC8 in-pane cross-file navigation
  // An outside file has no project root: no cross-file nav, edit or sibling-stylesheet inlining.
  const scopedProjectId = sessionTaskId ? undefined : projectId;
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
    (sessionTaskId
      ? fetchSessionFileText(sessionTaskId, nav.effectivePath)
      : fetchFileText(projectId, nav.effectivePath)
    )
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
  }, [projectId, sessionTaskId, nav.effectivePath, reloadNonce]);

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
      return <TooLargeNotice maxBytes={state.maxBytes} source={state.source} path={nav.effectivePath} />;
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
    if (kind === "markdown") return <MarkdownRenderer text={state.text} onDocLinkClick={sessionTaskId ? NO_DOC_NAV : nav.navigateToDoc} scrollToFragment={nav.fragment} onPopOut={popOut ? () => setPopoutOpen(true) : undefined} projectId={scopedProjectId} path={nav.effectivePath} onSaved={() => setReloadNonce((n) => n + 1)} />;
    if (kind === "code") return <CodeRenderer text={state.text} extension={ext} />;
    if (kind === "html") return <HtmlRenderer text={state.text} projectId={scopedProjectId} path={nav.effectivePath} onPopOut={popOut ? () => setPopoutOpen(true) : undefined} />;
    if (kind === "mermaid") return <MermaidRenderer text={state.text} />;
    return <TextRenderer text={state.text} />;
  })();

  return (
    <div className="flex h-full flex-col" data-testid="smart-viewer">
      <div className="min-h-0 flex-1 overflow-hidden">{inner}</div>
      {popOut && (kind === "markdown" || kind === "html") && (
        <SmartViewerModal
          open={popoutOpen}
          onOpenChange={setPopoutOpen}
          projectId={projectId}
          path={nav.effectivePath}
          sessionTaskId={sessionTaskId}
        />
      )}
    </div>
  );
}

export { CLIENT_FILE_TEXT_MAX_BYTES };
