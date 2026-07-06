/*
 * useTerminalAppearance — live light/dark re-theming for the embedded
 * terminal (iterate-2026-07-06-terminal-theme-modes, FR-01.44).
 *
 * The initial palette is set at Terminal creation
 * (`createEmbeddedXterm(container, resolveAppearanceNow())`) so there is no
 * flash. This hook keeps the OPEN terminal in sync afterwards — no remount,
 * WS/scrollback preserved (Architecture rule 21) — by re-resolving and, when
 * it changes, reassigning a fresh ITheme (VS Code's `_updateTheme` pattern).
 *
 * It re-resolves on four signals:
 *   1. Claude-theme fetch on mount + on window focus (the user may have run
 *      `/theme` in the terminal) — refreshes the cache that `auto` mirrors.
 *   2. Settings toggle in THIS tab (custom `TERMINAL_PREFS_CHANGED_EVENT`).
 *   3. Settings toggle in ANOTHER tab (`storage` event).
 *   4. OS light/dark change (`prefers-color-scheme` media query).
 */

import { useEffect, useRef, type RefObject } from "react";
import type { Terminal } from "@xterm/xterm";

import type { ResolvedAppearance } from "./terminal-theme";
import { buildXtermTheme } from "./xterm-theme-options";
import {
  getAppearancePref,
  getCachedClaudeTheme,
  setCachedClaudeTheme,
  TERMINAL_PREFS_CHANGED_EVENT,
} from "../../lib/terminalPrefs";
import { resolveAppearance } from "../../lib/terminalAppearance";
import { fetchClaudeTheme } from "../../lib/terminalAppearanceApi";

function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-color-scheme: dark)").matches
  );
}

/** Synchronously resolve the appearance from the current prefs + cached
 *  Claude theme + OS signal. Used at mount (before the async fetch). */
export function resolveAppearanceNow(): ResolvedAppearance {
  return resolveAppearance({
    pref: getAppearancePref(),
    claudeTheme: getCachedClaudeTheme(),
    systemPrefersDark: systemPrefersDark(),
  });
}

/** Reassign a FRESH ITheme (the WebGL addon repaints via onChangeColors);
 *  a full refresh is the belt-and-suspenders against the atlas-staleness
 *  class this codebase has fought (webgl-atlas-repaint.ts / PR #175). */
export function applyAppearance(
  term: Terminal,
  appearance: ResolvedAppearance,
): void {
  term.options.theme = buildXtermTheme(appearance);
  try {
    term.refresh(0, term.rows - 1);
  } catch {
    /* renderer not ready — a later fit/refresh will catch up */
  }
}

export function useTerminalAppearance(
  termRef: RefObject<Terminal | null>,
  disposedRef: RefObject<boolean>,
): void {
  const currentRef = useRef<ResolvedAppearance>(resolveAppearanceNow());

  useEffect(() => {
    let cancelled = false;

    const reapply = (): void => {
      const term = termRef.current;
      if (!term || disposedRef.current) return;
      const next = resolveAppearanceNow();
      if (next === currentRef.current) return;
      currentRef.current = next;
      applyAppearance(term, next);
    };

    const refreshClaudeTheme = (): void => {
      void fetchClaudeTheme().then(({ theme }) => {
        if (cancelled) return;
        setCachedClaudeTheme(theme);
        reapply();
      });
    };

    // 1) Mirror Claude Code's persisted theme.
    refreshClaudeTheme();

    // 2/3) Settings toggle — same tab (custom event) + other tabs (storage).
    const onPrefsChanged = (): void => reapply();
    const onStorage = (e: StorageEvent): void => {
      if (e.key === null || e.key.startsWith("shipwright.terminal.")) reapply();
    };
    window.addEventListener(TERMINAL_PREFS_CHANGED_EVENT, onPrefsChanged);
    window.addEventListener("storage", onStorage);

    // 4) OS light/dark change.
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onMq = (): void => reapply();
    mq?.addEventListener?.("change", onMq);

    // Re-check Claude's theme when the tab becomes visible again (the user
    // may have switched it via `/theme` in the terminal meanwhile). Gated on
    // `visibilitychange`→visible rather than raw `focus` to avoid a fetch +
    // localStorage write on every window focus (chatter with N terminals).
    const onVisible = (): void => {
      if (document.visibilityState === "visible") refreshClaudeTheme();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.removeEventListener(TERMINAL_PREFS_CHANGED_EVENT, onPrefsChanged);
      window.removeEventListener("storage", onStorage);
      mq?.removeEventListener?.("change", onMq);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [termRef, disposedRef]);
}
