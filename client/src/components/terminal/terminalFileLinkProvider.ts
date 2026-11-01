/*
 * terminalFileLinkProvider - an xterm ILinkProvider that makes file paths in the
 * terminal buffer clickable (FR-01.28). READ-ONLY on the xterm instance: it only
 * reads buffer cells; it never writes to the terminal, the pty or the socket.
 *
 * Soft-wrapped rows are joined into one logical line (so a path the terminal
 * wrapped is ONE link whose range spans both rows) and string offsets are mapped
 * back to cells per code unit (wide characters occupy two cells). Only the
 * logical line under the pointer is scanned, capped at MAX_ROWS rows.
 * Activation = plain click (same as the web links); ignored while the terminal
 * has a text selection, so finishing a drag-select never opens a file.
 */
import type { ILink, ILinkProvider, Terminal } from "@xterm/xterm";

import type { FileRef } from "../../lib/viewerTarget";
import { findFileLinkCandidates } from "./terminalLinkMatch";

export type LinkTerm = Pick<Terminal, "buffer" | "cols" | "hasSelection">;

const MAX_ROWS = 40;

interface CellPos {
  /** 0-based column of the cell the code unit starts in. */
  x: number;
  /** 1-based buffer row. */
  y: number;
  /** Cell width of the character the code unit belongs to. */
  w: number;
}

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
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback) {
      const buf = term.buffer.active;
      const row0 = bufferLineNumber - 1;
      let first = row0;
      while (first > 0 && row0 - first < MAX_ROWS && buf.getLine(first)?.isWrapped) first--;
      let last = row0;
      while (last - row0 < MAX_ROWS && buf.getLine(last + 1)?.isWrapped) last++;
      if (!buf.getLine(row0) || last - first >= MAX_ROWS) return callback(undefined);

      let text = "";
      const pos: CellPos[] = [];
      for (let row = first; row <= last; row++) {
        const line = buf.getLine(row);
        if (!line) break;
        for (let x = 0; x < term.cols; x++) {
          const cell = line.getCell(x);
          if (!cell) break;
          const w = cell.getWidth();
          if (w === 0) continue;
          // An empty cell at the end of a row that soft-wraps on (a wide char that did not fit) is not a space.
          const chars = cell.getChars() || (row < last && x === term.cols - 1 ? "" : " ");
          for (let i = 0; i < chars.length; i++) pos.push({ x, y: row + 1, w });
          text += chars;
        }
      }

      const links: ILink[] = [];
      for (const c of findFileLinkCandidates(text)) {
        const s = pos[c.start];
        const e = pos[c.end - 1];
        if (!s || !e || bufferLineNumber < s.y || bufferLineNumber > e.y) continue;
        links.push({
          range: { start: { x: s.x + 1, y: s.y }, end: { x: e.x + e.w, y: e.y } },
          text: text.slice(c.start, c.end),
          activate: (event) => {
            if (!isClick(event) || term.hasSelection()) return;
            onActivate(c.ref);
          },
        });
      }
      callback(links.length ? links : undefined);
    },
  };
}
