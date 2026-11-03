/*
 * useTerminalFileLinks - registers the file-path link provider on the embedded
 * terminal's xterm instance (FR-01.28). Must be called AFTER the mount effect
 * that creates `termRef.current` (effects run in declaration order). The provider
 * is registered once (EmbeddedTerminal creates its xterm exactly once per mount, in a [] effect, and
 * a new terminal always means a new mount, so there is no "replaced instance" to follow); the latest props are read through a ref, so a context
 * change never re-registers anything or touches the terminal lifecycle.
 *
 * Click -> same resolution as the Mission chat chips (`resolveViewerTarget`):
 * inside the project -> `open(target)` (project file route); outside -> first ask
 * the session-file route; 403 -> the "Not part of this session" notice, else open.
 */
import { useEffect, useRef, type MutableRefObject } from "react";
import type { Terminal } from "@xterm/xterm";

import type { FileOpenValue } from "../external/FileOpenContext";
import { isRefusedBySession } from "../../lib/sessionFileApi";
import { COARSE_POINTER_QUERY } from "../../hooks/useIsCompactViewport";
import { peekProbe, probePath } from "../../lib/pathProbe";
import { resolveViewerTarget, type FileRef } from "../../lib/viewerTarget";
import { createClickGuard, createFileLinkProvider } from "./terminalFileLinkProvider";
import type { ClipboardNoticeKind } from "./terminal-clipboard";

export async function openTerminalFileLink(
  ref: FileRef,
  taskId: string,
  fileOpen: FileOpenValue | undefined,
  notify: (kind: ClipboardNoticeKind) => void,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  if (!fileOpen || fileOpen.ready === false) return;
  const target = resolveViewerTarget(ref, fileOpen.projectRoot, fileOpen.cwd ?? null);
  if (!target) return;
  if (target.outside) {
    const refused = await isRefusedBySession(taskId, target.path);
    if (!isCurrent()) return; // a newer click or another task won while the check ran
    if (refused) return notify("link-not-in-session");
  }
  fileOpen.open(target);
}

/**
 * One verdict per ref: false only when the server says the Viewer cannot open it (unknown / not ready / no target = keep).
 *
 * `optimistic` (touch devices): a tap fires mousemove -> mousedown -> mouseup within milliseconds with no hover
 * before it, so waiting for the probe round trip would leave xterm without a link at mouseup and the FIRST tap on
 * a path would do nothing. There the answer comes from the cache only (a fresh "no" hides the link, anything
 * else keeps it) and an unknown path is probed in the background for the next look; a dead path then opens the
 * Viewer, which reports the real state (the same fail-open as an unknown probe answer).
 */
export async function probeTerminalRefs(
  refs: FileRef[],
  taskId: string,
  fileOpen: FileOpenValue | undefined,
  optimistic = false,
): Promise<boolean[]> {
  if (!fileOpen || fileOpen.ready === false) return refs.map(() => true);
  return Promise.all(
    refs.map(async (ref) => {
      const target = resolveViewerTarget(ref, fileOpen.projectRoot, fileOpen.cwd ?? null);
      if (!target) return true;
      if (optimistic) {
        const known = peekProbe(taskId, target.path);
        if (!known) void probePath(taskId, target.path);
        return known !== "no";
      }
      return (await probePath(taskId, target.path)) !== "no";
    }),
  );
}

function isCoarsePointer(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(COARSE_POINTER_QUERY).matches;
}

export function useTerminalFileLinks(
  termRef: MutableRefObject<Terminal | null>,
  taskId: string,
  fileOpen: FileOpenValue | undefined,
  notify: (kind: ClipboardNoticeKind) => void,
): void {
  const latest = useRef({ taskId, fileOpen, notify });
  latest.current = { taskId, fileOpen, notify };
  const seq = useRef(0);
  useEffect(() => {
    seq.current++; // any task transition (even A -> B -> A) invalidates probes still in flight
  }, [taskId]);
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    const guard = createClickGuard(term.element);
    const sub = term.registerLinkProvider(
      createFileLinkProvider(
        term,
        (ref) => {
          const c = latest.current;
          const mine = ++seq.current;
          void openTerminalFileLink(ref, c.taskId, c.fileOpen, c.notify, () => mine === seq.current && latest.current.taskId === c.taskId);
        },
        guard.isClick,
        (refs) => {
          const c = latest.current;
          return probeTerminalRefs(refs, c.taskId, c.fileOpen, isCoarsePointer());
        },
      ),
    );
    return () => {
      // The mount effect's cleanup (declared earlier) may already have disposed the terminal; xterm
      // tolerates disposing a provider subscription afterwards (6.0.0: it only removes a list entry).
      seq.current++; // a probe still in flight must not act on a torn-down terminal
      sub.dispose();
      guard.dispose();
    };
  }, [termRef]);
}
