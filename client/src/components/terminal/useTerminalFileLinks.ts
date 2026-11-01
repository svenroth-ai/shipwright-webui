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
