/*
 * Shipwright plugin-suite version reader (iterate-2026-09-05-nav-collapse-
 * and-version-badges).
 *
 * Reads the single suite-wide `version` stamp from the "shipwright"
 * marketplace manifest at `~/.claude/plugins/marketplaces/shipwright/
 * .claude-plugin/marketplace.json`. All 14 shipwright plugins release in
 * lockstep and share this one version (see CLAUDE.md memory: "Monorepo
 * release MUST bump all 14 plugin.json + marketplace.json stamps"), so the
 * marketplace manifest's top-level `version` is the single unambiguous
 * source for "the current plugin version" the Diagnostics page shows —
 * reading any one of the 14 per-plugin manifests would be an arbitrary pick.
 *
 * Read-only, best-effort, same shape as claude-theme-reader.ts: a missing
 * marketplace (plugin not installed), unreadable file, non-JSON body, or
 * absent/non-string `version` all resolve to `null` (never throw).
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ShipwrightPluginVersionReaderDeps {
  /** Injected for tests; defaults to fs/promises.readFile + utf-8. */
  readFile?: (path: string) => Promise<string>;
  /** Injected for tests; defaults to os.homedir(). */
  homedir?: () => string;
}

/** Absolute path to the shipwright marketplace manifest. */
export function shipwrightMarketplaceManifestPath(home: string): string {
  return join(
    home,
    ".claude",
    "plugins",
    "marketplaces",
    "shipwright",
    ".claude-plugin",
    "marketplace.json",
  );
}

/**
 * Read the shipwright plugin suite's version, or `null` when it can't be
 * determined (not installed, unreadable, malformed). Swallows every error —
 * the caller treats `null` as "unknown", never as a 500.
 */
export async function readShipwrightPluginVersion(
  deps: ShipwrightPluginVersionReaderDeps = {},
): Promise<string | null> {
  const home = (deps.homedir ?? homedir)();
  const fsRead = deps.readFile ?? ((p: string) => readFile(p, "utf-8"));
  try {
    const raw = await fsRead(shipwrightMarketplaceManifestPath(home));
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      "version" in parsed &&
      typeof (parsed as { version: unknown }).version === "string"
    ) {
      const version = (parsed as { version: string }).version.trim();
      return version.length > 0 ? version : null;
    }
    return null;
  } catch {
    return null;
  }
}
