/*
 * core/settings-reader.ts — read-only GlobalSettings access for server-side
 * consumers that are not the `/api/settings` route itself (Codex Light
 * §3.5's triage-promote server-side default read, and `CodexTaskWatcher`'s
 * live stall-timeout config). Mirrors `routes/settings.ts` GET's exact
 * default-merge behavior so both paths agree on what "no settings.json yet"
 * means; kept as a small, dependency-injected sibling rather than importing
 * the route module itself (which owns PUT's lock/write concerns this reader
 * has no business touching).
 */
import type { GlobalSettings } from "../types/settings.js";

export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  port: 3847,
  maxConcurrent: 3,
  heartbeatIntervalMs: 30000,
};

export interface SettingsReaderDeps {
  readFile: (path: string, encoding: string) => Promise<string>;
  existsSync: (path: string) => boolean;
}

export async function readGlobalSettings(
  settingsPath: string,
  deps: SettingsReaderDeps,
): Promise<GlobalSettings> {
  if (!deps.existsSync(settingsPath)) return { ...DEFAULT_GLOBAL_SETTINGS };
  try {
    const content = await deps.readFile(settingsPath, "utf-8");
    if (!content.trim()) return { ...DEFAULT_GLOBAL_SETTINGS };
    return { ...DEFAULT_GLOBAL_SETTINGS, ...JSON.parse(content) };
  } catch {
    return { ...DEFAULT_GLOBAL_SETTINGS };
  }
}
