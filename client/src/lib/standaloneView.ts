/*
 * Standalone view — a per-browser preference that hides the Shipwright-only
 * pages (Triage, a project's Ship's Log) for people who use the Command Center
 * as a plain Claude task board (iterate-2026-10-30-hide-shipwright-views).
 *
 * Presentational ONLY. Whether the webui may WRITE into a repo is the separate
 * per-project `standalone` flag (CLAUDE.md DO-NOT #33); this never touches it.
 *
 * Same shape as terminalPrefs: localStorage, every access guarded, and a
 * same-tab event so open consumers (sidebar, palette, route guards) re-render
 * live. `storage` covers a second tab.
 */
import { useSyncExternalStore } from "react";
import { getStored, setStored } from "./localStorage";

export const STANDALONE_VIEW_KEY = "shipwright:standalone-view";
const CHANGE_EVENT = "shipwright:standalone-view-change";

// Session fallback for when localStorage is unavailable (private mode / quota):
// the switch then still works until the tab closes instead of doing nothing.
let sessionValue: boolean | null = null;

export function isStandaloneViewEnabled(): boolean {
  return sessionValue ?? getStored<boolean>(STANDALONE_VIEW_KEY, false) === true;
}

export function setStandaloneViewEnabled(enabled: boolean): void {
  setStored(STANDALONE_VIEW_KEY, enabled);
  // Only keep the in-memory value when the write did not stick.
  sessionValue = getStored<boolean | null>(STANDALONE_VIEW_KEY, null) === enabled ? null : enabled;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === STANDALONE_VIEW_KEY) onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** Palette destination ids hidden by the Standalone view. */
export const STANDALONE_HIDDEN_DESTINATION_IDS: readonly string[] = ["triage"];

export function useStandaloneView(): boolean {
  return useSyncExternalStore(subscribe, isStandaloneViewEnabled, () => false);
}
