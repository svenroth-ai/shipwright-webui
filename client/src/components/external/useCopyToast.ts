/*
 * useCopyToast — clipboard copy + a short "Path copied" / "Copy failed" message
 * for the FileTree row menu. The copy is deferred one frame so the closing
 * Radix menu/sheet has released its focus trap (execCommand fallback, see
 * lib/clipboard.ts).
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { copyText } from "../../lib/clipboard";

const TOAST_MS = 2000;

export function useCopyToast(): { toast: string | null; copy: (text: string) => void } {
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true; // StrictMode re-runs effects: re-arm after the fake unmount
    return () => {
      mounted.current = false;
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  const show = useCallback((msg: string) => {
    if (!mounted.current) return;
    setToast(msg);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  const copy = useCallback(
    (text: string) => {
      window.requestAnimationFrame(() => {
        copyText(text).then(
          () => show("Path copied"),
          () => show("Copy failed"),
        );
      });
    },
    [show],
  );

  return { toast, copy };
}
