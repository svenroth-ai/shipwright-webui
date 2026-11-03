/*
 * terminalFileLinkProvider - an xterm ILinkProvider that makes file paths in the
 * terminal buffer clickable (FR-01.28). READ-ONLY on the xterm instance: it only
 * reads buffer cells; it never writes to the terminal, the pty or the socket.
 *
 * Wrapped rows are joined into one logical line (terminalLogicalLine: terminal soft wraps
 * always, an app's own hard wrap only when it is reliably a broken path), so one path is ONE
 * link whose range spans the rows. Only the logical line under the pointer is scanned.
 * Activation = plain click (same as the web links); ignored while the terminal
 * has a text selection, so finishing a drag-select never opens a file.
 */
import type { ILink, ILinkProvider } from "@xterm/xterm";

import type { FileRef } from "../../lib/viewerTarget";
import { findFileLinkCandidates } from "./terminalLinkMatch";
import { buildLogicalLine, type LinkTerm } from "./terminalLogicalLine";

export type { LinkTerm };

/**
 * Click filter: primary button only, not the 2nd+ click of a multi-click, and the pointer must not
 * have travelled since mousedown (a drag that copies part of a path, e.g. inside Claude's own
 * mouse-tracking screen where xterm keeps no selection, must not open it).
 */
export function createClickGuard(el: HTMLElement | undefined): { isClick: (e: MouseEvent) => boolean; dispose: () => void } {
  let down: { x: number; y: number } | null = null;
  let travelled = false; // set once the pointer leaves the 4px box, even if it comes back
  const onDown = (e: MouseEvent) => {
    down = { x: e.clientX, y: e.clientY };
    travelled = false;
  };
  const onMove = (e: MouseEvent) => {
    if (down && (Math.abs(e.clientX - down.x) > 4 || Math.abs(e.clientY - down.y) > 4)) travelled = true;
  };
  el?.addEventListener("mousedown", onDown, true);
  el?.addEventListener("mousemove", onMove, true);
  return {
    isClick: (e) => {
      if (e.button !== 0 || e.detail > 1) return false;
      if (!el) return true; // no element to watch (unit-test fakes): only the button/multi-click rules apply
      if (down === null || travelled) return false;
      return Math.abs(e.clientX - down.x) <= 4 && Math.abs(e.clientY - down.y) <= 4;
    },
    dispose: () => {
      el?.removeEventListener("mousedown", onDown, true);
      el?.removeEventListener("mousemove", onMove, true);
    },
  };
}

export function createFileLinkProvider(
  term: LinkTerm,
  onActivate: (ref: FileRef) => void,
  isClick: (e: MouseEvent) => boolean = () => true,
  /** Optional openable-check, one verdict per ref: a link whose path cannot be opened is never offered. Fail-open on a throw. */
  filter?: (refs: FileRef[]) => Promise<boolean[]>,
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback) {
      const logical = buildLogicalLine(term, bufferLineNumber - 1);
      if (!logical) return callback(undefined);
      const { text, pos } = logical;

      const links: ILink[] = [];
      const candidates: Array<{ ref: FileRef }> = [];
      for (const c of findFileLinkCandidates(text)) {
        const s = pos[c.start];
        const e = pos[c.end - 1];
        if (!s || !e || bufferLineNumber < s.y || bufferLineNumber > e.y) continue;
        candidates.push({ ref: c.ref });
        links.push({
          range: { start: { x: s.x + 1, y: s.y }, end: { x: e.x + e.w, y: e.y } },
          text: text.slice(c.start, c.end),
          activate: (event) => {
            if (!isClick(event) || term.hasSelection()) return;
            onActivate(c.ref);
          },
        });
      }
      if (!filter || links.length === 0) return callback(links.length ? links : undefined);
      // Lazy and non-blocking: xterm asks only for the row under the pointer; repeats are answered from the client cache.
      const refs = candidates.map((c) => c.ref);
      void filter(refs).then(
        (ok) => { const kept = links.filter((_, i) => ok[i] !== false); callback(kept.length ? kept : undefined); },
        () => callback(links),
      );
    },
  };
}
