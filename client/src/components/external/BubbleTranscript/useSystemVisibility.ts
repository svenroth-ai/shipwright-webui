/*
 * useSystemVisibility — Campaign-C C3 BubbleTranscript split (2026-05-26).
 *
 * Global toggle state for "system" event visibility. Persists to
 * localStorage so the preference survives reloads and applies across
 * every transcript viewer in the app (single default — not per-task,
 * per plan §3 section 01 + external review O16).
 *
 * Extracted bit-perfect from the legacy `BubbleTranscript.tsx` shell.
 */

import { useEffect, useState } from "react";

const SYSTEM_VISIBILITY_KEY = "webui.transcript.showSystem";

export function useSystemVisibility(): [
  boolean,
  (next: boolean | ((prev: boolean) => boolean)) => void,
] {
  const [visible, setVisibleState] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(SYSTEM_VISIBILITY_KEY) === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    // Cross-tab sync: if another tab flips the flag, reflect it here.
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === SYSTEM_VISIBILITY_KEY) {
        setVisibleState(ev.newValue === "true");
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setVisible = (next: boolean | ((prev: boolean) => boolean)) => {
    setVisibleState((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      try {
        window.localStorage.setItem(SYSTEM_VISIBILITY_KEY, resolved ? "true" : "false");
      } catch {
        // ignore quota/denied — in-memory flip still applies for this session.
      }
      return resolved;
    });
  };

  return [visible, setVisible];
}
