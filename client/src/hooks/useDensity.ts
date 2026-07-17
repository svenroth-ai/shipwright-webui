/*
 * useDensity — comfortable ⇄ compact density for the list surfaces (board /
 * projects / triage), persisted across reload (A21, FR-01.65, AC5).
 *
 * A module-level store + useSyncExternalStore (same shape as useProjectFilter)
 * so the header toggle, the palette command and every surface read ONE cell —
 * flip it anywhere and all three surfaces update, no drift. The concrete
 * spacing is token-driven (styles/command-center.css `[data-density]`), NOT
 * magic numbers in components: a surface only stamps `data-density` on its
 * container.
 */

import { useCallback, useSyncExternalStore } from "react";

export type DensityMode = "comfortable" | "compact";

export const DENSITY_STORAGE_KEY = "webui.density";

function read(): DensityMode {
  if (typeof localStorage === "undefined") return "comfortable";
  try {
    return localStorage.getItem(DENSITY_STORAGE_KEY) === "compact"
      ? "compact"
      : "comfortable";
  } catch {
    return "comfortable";
  }
}

function write(value: DensityMode): void {
  try {
    localStorage.setItem(DENSITY_STORAGE_KEY, value);
  } catch {
    /* quota / disabled — ignore */
  }
}

let current: DensityMode =
  typeof window === "undefined" ? "comfortable" : read();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function getSnapshot(): DensityMode {
  return current;
}
function setCurrent(next: DensityMode) {
  if (current !== next) {
    current = next;
    write(next);
    emit();
  }
}

// Cross-tab sync.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (ev) => {
    if (ev.key === DENSITY_STORAGE_KEY) {
      setCurrent(ev.newValue === "compact" ? "compact" : "comfortable");
    }
  });
}

export interface UseDensityResult {
  density: DensityMode;
  setDensity: (value: DensityMode) => void;
  toggleDensity: () => void;
}

export function useDensity(): UseDensityResult {
  const density = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const setDensity = useCallback((value: DensityMode) => setCurrent(value), []);
  const toggleDensity = useCallback(
    () => setCurrent(current === "compact" ? "comfortable" : "compact"),
    [],
  );
  return { density, setDensity, toggleDensity };
}
