/*
 * useLineFocus — V6: a chip such as `File.ts:98` opens the Smart Viewer AT that
 * line. The text/code renderers hand this hook their scroll host and a locator
 * for the LOGICAL line; it jumps the host there (instant, never animated, so
 * `prefers-reduced-motion` needs no special case) and exposes a mark band the
 * renderer draws over the line. With "Wrap lines" on a logical line spans several
 * visual rows, so the locators measure the line's whole box, not a row index.
 * Rendered kinds (markdown / html / mermaid) have no source lines and ignore it.
 */

import { useLayoutEffect, useState, type RefObject } from "react";

export interface LineMark {
  top: number;
  height: number;
  width: number;
}

type Locate = (host: HTMLElement, line: number) => DOMRect | null;

/** Text node + offset for a character offset inside `root` (null when past the end). */
function pointAt(root: Node, offset: number, atEnd: boolean): [Node, number] | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let acc = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const len = n.nodeValue?.length ?? 0;
    if (atEnd ? offset <= acc + len : offset < acc + len) return [n, offset - acc];
    acc += len;
  }
  return null;
}

/** Highlighted code: one `<pre><code>` whose text holds the file's lines. */
export const locateCodeLine: Locate = (host, line) => {
  const code = host.querySelector("pre code");
  if (!code) return null;
  const full = code.textContent ?? "";
  let start = 0;
  for (let i = 1; i < line; i++) {
    const nl = full.indexOf("\n", start);
    if (nl < 0) return null;
    start = nl + 1;
  }
  let end = full.indexOf("\n", start);
  if (end < 0) end = full.length;
  if (end === start) end = Math.min(full.length, start + 1); // an empty line still has a box
  const from = pointAt(code, start, false);
  const to = pointAt(code, end, true);
  if (!from || !to || typeof document.createRange !== "function") return null;
  const range = document.createRange();
  range.setStart(from[0], from[1]);
  range.setEnd(to[0], to[1]);
  return typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : null;
};

/** Plain text: one `.sv-text-line` element per logical line. */
export const locateTextLine: Locate = (host, line) =>
  host.querySelectorAll(".sv-text-line")[line - 1]?.getBoundingClientRect() ?? null;

export function useLineFocus(
  hostRef: RefObject<HTMLElement | null>,
  locate: Locate,
  line: number | undefined,
  focusKey: number | undefined,
  text: string,
  wrap: boolean,
): LineMark | null {
  const [mark, setMark] = useState<LineMark | null>(null);
  useLayoutEffect(() => {
    const host = hostRef.current;
    const rect = host && line && line > 0 ? locate(host, line) : null;
    if (!host || !rect) {
      setMark(null);
      return;
    }
    const top = rect.top - host.getBoundingClientRect().top + host.scrollTop;
    host.scrollTop = Math.max(0, top - host.clientHeight / 3);
    setMark({ top, height: rect.height, width: host.scrollWidth });
    // focusKey: re-clicking the same chip scrolls back to the line; text/wrap move the line.
  }, [hostRef, locate, line, focusKey, text, wrap]);
  return mark;
}

export function LineMarkBand({ mark, line }: { mark: LineMark | null; line?: number }) {
  if (!mark) return null;
  return (
    <div
      aria-hidden="true"
      className="sv-line-mark"
      data-testid="sv-line-mark"
      data-line={line}
      style={{ top: mark.top, height: mark.height, width: mark.width }}
    />
  );
}
