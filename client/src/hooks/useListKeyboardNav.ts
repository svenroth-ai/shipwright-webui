/*
 * useListKeyboardNav — `j`/`k` (and ArrowDown/ArrowUp) selection over a list
 * surface (A21, FR-01.65, AC4). ONE hook, dropped into board / triage /
 * projects / inbox; each surface only marks its rows with the item selector.
 *
 * It gates on the SAME `isTypingContext()` fence as the global map (imported
 * from useKeyboardMap) so it is inert inside the terminal / text entry / an
 * open dialog. Moving selection also moves DOM focus to the item, so the
 * item's OWN Enter handler opens it (real binding, native `Tab` order intact)
 * — this hook never hijacks Enter or `preventDefault`s a key it will not use.
 *
 * Per-surface QUICK ACTIONS (AC4): a single letter that matches a
 * `[data-nav-action="<key>"]` control INSIDE the selected item clicks it (e.g.
 * `l` = launch on a board row, `a` = answer on an inbox card). Only keys that
 * resolve to a real control fire — an unmatched key is left untouched, so the
 * surface declares its own quick actions and nothing is a secret handler.
 */

import { useEffect, useRef, type RefObject } from "react";
import { isTypingContext } from "./useKeyboardMap";

export interface ListKeyboardNavOptions {
  containerRef: RefObject<HTMLElement | null>;
  /** Selector for the navigable items, scoped to the container. */
  itemSelector: string;
  /** Default true. When false the hook is dormant. */
  enabled?: boolean;
  /** Attribute stamped on the selected item (CSS ring hook). */
  selectedAttr?: string;
}

const MOVE_DOWN = new Set(["j", "arrowdown"]);
const MOVE_UP = new Set(["k", "arrowup"]);

export function useListKeyboardNav(opts: ListKeyboardNavOptions): void {
  const {
    containerRef,
    itemSelector,
    enabled = true,
    selectedAttr = "data-nav-selected",
  } = opts;
  const indexRef = useRef<number>(-1);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    const items = (): HTMLElement[] => {
      const c = containerRef.current;
      if (!c) return [];
      return Array.from(c.querySelectorAll<HTMLElement>(itemSelector));
    };

    const apply = (list: HTMLElement[], next: number) => {
      for (let i = 0; i < list.length; i++) {
        if (i === next) list[i].setAttribute(selectedAttr, "true");
        else list[i].removeAttribute(selectedAttr);
      }
      const el = list[next];
      if (el) {
        indexRef.current = next;
        // Move DOM focus so the item's own Enter handler opens it, and the
        // native focus ring shows. preventScroll:false lets it scroll in.
        try {
          el.focus({ preventScroll: false });
        } catch {
          /* non-focusable — the ring attribute still marks it */
        }
        el.scrollIntoView({ block: "nearest" });
      }
    };

    const handler = (ev: KeyboardEvent) => {
      // Never fight a modifier chord (palette Ctrl/⌘+K etc.).
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      // THE FENCE — inert inside terminal / text entry / open dialog.
      if (ev.isComposing || isTypingContext(ev.target)) return;

      const key = ev.key.toLowerCase();
      const down = MOVE_DOWN.has(key);
      const up = MOVE_UP.has(key);

      // Quick action: a single letter matching a [data-nav-action] control
      // inside the currently-selected item clicks it. Only fires on a real
      // match — otherwise the key is left completely untouched.
      if (!down && !up) {
        if (key.length !== 1) return;
        const c = containerRef.current;
        const selected = c?.querySelector<HTMLElement>(`[${selectedAttr}="true"]`);
        if (!selected) return;
        const action = selected.querySelector<HTMLElement>(
          `[data-nav-action="${CSS.escape(key)}"]`,
        );
        if (!action) return;
        // Click the control itself, or its first interactive descendant when
        // the annotated element is a wrapper (e.g. a span around a button).
        const clickTarget = action.matches("button,a,[role='button']")
          ? action
          : action.querySelector<HTMLElement>("button,a,[role='button']") ?? action;
        ev.preventDefault();
        clickTarget.click();
        return;
      }

      const list = items();
      if (list.length === 0) return;

      // Anchor on the currently-focused item when it is one of ours, else the
      // last-remembered index, else the ends.
      let cur = indexRef.current;
      const active = document.activeElement;
      const activeIdx = active ? list.indexOf(active as HTMLElement) : -1;
      if (activeIdx !== -1) cur = activeIdx;
      if (cur < 0 || cur >= list.length) cur = down ? -1 : list.length;

      const next = down
        ? Math.min(list.length - 1, cur + 1)
        : Math.max(0, cur - 1);

      ev.preventDefault();
      apply(list, next);
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [containerRef, itemSelector, enabled, selectedAttr]);
}
