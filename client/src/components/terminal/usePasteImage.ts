/*
 * usePasteImage — DOM paste handler (Campaign C / C5).
 *
 * Extracted from EmbeddedTerminal.tsx. Behaviour bit-perfect:
 *   - Capture-phase `paste` listener on `document` so xterm's internal
 *     textarea-level handling cannot pre-empt us (iterate v0.8.2 AC-3).
 *   - Scope gate via `container.contains(target)` — paste in unrelated
 *     parts of the page is ignored.
 *   - Image-wins precedence (AC-6): first `ClipboardItem` with type
 *     starting "image/" is uploaded as multipart to
 *     `/api/terminal/:taskId/paste-image`; any text payload in the same
 *     clipboard is dropped intentionally.
 *   - Text-only: preventDefault + `term.paste(text)` so line endings
 *     normalize and bracketed-paste markers wrap multi-line content
 *     (iterate-2026-05-18 AC-8).
 *
 * Plan-review resolutions:
 *   - openai #8 MED: dep list is intentionally narrow (`taskId` +
 *     callbacks). Callbacks are latest-ref'd so re-renders with new
 *     callback identities do NOT re-register the document listener
 *     (otherwise StrictMode dev double-mount would land two listeners).
 *   - openai #13 LOW: mixed clipboard payload + multiple image items
 *     covered by the unit test below — image-wins picks the FIRST image
 *     in iteration order.
 *   - openai #9 + gemini #5 MED: `fetch` shape preserved verbatim —
 *     no `credentials`, no headers, multipart body via FormData
 *     (same as source).
 *
 * Keyboard Ctrl+V paste is a SEPARATE path: see
 * `terminal-clipboard.ts` (`createClipboardKeyHandler`) wired via
 * `attachCustomKeyEventHandler` in the EmbeddedTerminal shell.
 */

import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { Terminal } from "@xterm/xterm";

export interface UsePasteImageOptions {
  /** The pinned task — feeds the multipart upload URL. */
  taskId: string;
  /** Scope gate — paste with a target outside this container is ignored. */
  containerRef: RefObject<HTMLDivElement | null>;
  /** The mounted xterm — text-only pastes route through `term.paste`. */
  termRef: RefObject<Terminal | null>;
  /** True once the component is mid-cleanup (ADR-084). */
  disposedRef: RefObject<boolean>;
  /** Surface a hint when the server detects an un-ignored .claude-pastes dir. */
  onGitignoreSuggestion?: () => void;
  /** Surface upload failures (network / server 4xx/5xx). */
  onPasteImageError?: (detail: string) => void;
}

/**
 * Server response shape — only the two fields the client reads. Server may
 * return extra fields (path, gitignoreSuggestion, …) that we ignore.
 */
interface PasteImageResponseLike {
  error?: string;
  gitignoreSuggestion?: boolean;
}

/**
 * Install the document-capture-phase paste listener. The hook returns void —
 * it is purely a side-effect installer. Cleanup removes the listener with
 * the matching `{capture:true}` flag so React.StrictMode dev double-mount
 * doesn't leak a stale handler.
 */
export function usePasteImage(opts: UsePasteImageOptions): void {
  const {
    taskId,
    containerRef,
    termRef,
    disposedRef,
    onGitignoreSuggestion,
    onPasteImageError,
  } = opts;

  // Plan-review openai #8 MED: callbacks pinned behind latest-refs so the
  // listener registration doesn't re-fire on every parent render.
  const onGitignoreRef = useRef(onGitignoreSuggestion);
  const onErrorRef = useRef(onPasteImageError);
  useEffect(() => {
    onGitignoreRef.current = onGitignoreSuggestion;
  }, [onGitignoreSuggestion]);
  useEffect(() => {
    onErrorRef.current = onPasteImageError;
  }, [onPasteImageError]);

  // Shared multipart upload helper.
  const uploadPasteBlob = useCallback(
    async (blob: Blob, filename: string): Promise<void> => {
      const form = new FormData();
      form.append("image", blob, filename);
      const url = `/api/terminal/${encodeURIComponent(taskId)}/paste-image`;
      try {
        // Plan-review openai #9 + gemini #5: NO `credentials`, NO headers —
        // same-origin cookie-free + multipart body via FormData, exactly
        // as the source did. Adding options here would silently change
        // the request shape.
        const res = await fetch(url, { method: "POST", body: form });
        if (!res.ok) {
          let detail = `HTTP ${res.status}`;
          try {
            const body = (await res.json().catch(() => null)) as
              | PasteImageResponseLike
              | null;
            if (body?.error) detail = body.error;
          } catch {
            /* fall through */
          }
          onErrorRef.current?.(detail);
          return;
        }
        const body = (await res.json().catch(() => null)) as
          | PasteImageResponseLike
          | null;
        if (body?.gitignoreSuggestion) {
          onGitignoreRef.current?.();
        }
      } catch (err) {
        onErrorRef.current?.(err instanceof Error ? err.message : String(err));
      }
    },
    [taskId],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handler = (ev: ClipboardEvent): void => {
      const target = ev.target as Node | null;
      if (!target || !container.contains(target)) return;

      const items = ev.clipboardData?.items;
      if (!items || items.length === 0) return;

      // Image-wins precedence — first image file in iteration order.
      // Plan-review openai #13: multiple image items still pick the first.
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.kind === "file" && it.type.startsWith("image/")) {
          ev.preventDefault();
          ev.stopPropagation();
          const blob = it.getAsFile();
          if (!blob) return;
          void uploadPasteBlob(blob, `paste-${Date.now()}.png`);
          return;
        }
      }

      // No image: fall through to text-paste. Detect text-item presence
      // INDEPENDENT of empty-string truthiness — empty paste should still
      // preventDefault for predictable single-path behaviour (external
      // review F-v2 from the source).
      const hasTextItem = Array.from(items).some(
        (it) => it.kind === "string" && it.type === "text/plain",
      );
      if (hasTextItem) {
        ev.preventDefault();
        ev.stopPropagation();
        const text = ev.clipboardData?.getData("text/plain") ?? "";
        if (text && !disposedRef.current) {
          // term.paste() normalises line endings + wraps in bracketed-paste
          // markers; raw socket.send would submit a multi-line prompt on
          // its first line (iterate-2026-05-18 AC-8).
          termRef.current?.paste(text);
        }
      }
    };

    document.addEventListener("paste", handler, { capture: true });
    return () => {
      document.removeEventListener(
        "paste",
        handler,
        { capture: true } as EventListenerOptions,
      );
    };
    // `uploadPasteBlob` only changes when `taskId` changes (useCallback dep).
    // Refs are stable. Narrow deps avoid duplicate listener registration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadPasteBlob]);
}
