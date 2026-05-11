/*
 * headless-probe.ts — Iterate C (ADR-087, MEDIUM-B2 fix).
 *
 * Boot-time pre-probe of `@xterm/headless` + `@xterm/addon-serialize`
 * via dynamic import. Returns a structured result so the boot path can
 * downgrade `headlessMirrorEnabled=false` on failure WITHOUT crashing.
 *
 * Background: Iterate B (ADR-089) wired both packages via static ESM
 * imports in `server/src/index.ts` + `server/src/terminal/headless-mirror.ts`.
 * If either package is missing/corrupt at runtime (broken `node_modules`,
 * monorepo hoist mishap, partial `npm install`), the server crashed at
 * boot — there was no graceful fallback to "no snapshot, still serve".
 *
 * Decision: pre-probe via dynamic import at boot. On failure log a
 * structured warn, set `headlessMirrorEnabled=false`, continue server
 * start. The legacy chunked path is now retired so a probe failure
 * means "no replay at all" (per the plan's stated trade-off in ADR-087:
 * "Failure mode (snapshot write fails): Client falls back to 'no replay'
 * (blank terminal with live shell)").
 */

export interface HeadlessProbeResult {
  ok: boolean;
  /** Resolved `@xterm/headless` version when ok; null otherwise. */
  terminalVersion: string | null;
  /** Reason the probe failed (free-form, log-friendly). null when ok. */
  reason: string | null;
}

export type DynamicImportFn = (specifier: string) => Promise<unknown>;

/**
 * Probe both packages by dynamically importing them + reading the
 * `version` field from `@xterm/headless`'s package.json. Two-step
 * verification:
 *
 *   1. import `@xterm/headless` — verifies the package loads + exports
 *      a usable `Terminal` constructor.
 *   2. import `@xterm/addon-serialize` — verifies the addon package
 *      loads + exports `SerializeAddon`.
 *
 * Each step in its own try/catch so the diagnostic is precise: "headless
 * import failed" vs. "addon import failed".
 *
 * The default `importer` is the native `import(...)` expression. Tests
 * inject a custom importer that returns/throws synthetic modules.
 */
export async function probeHeadlessDeps(
  importer: DynamicImportFn = (s) => import(/* @vite-ignore */ s),
): Promise<HeadlessProbeResult> {
  // Step 1 — @xterm/headless.
  let headlessMod: unknown;
  try {
    headlessMod = await importer("@xterm/headless");
  } catch (err) {
    return {
      ok: false,
      terminalVersion: null,
      reason: `@xterm/headless import failed: ${(err as Error).message}`,
    };
  }
  // Headless ships CJS; ESM consumers get a wrapper with .default.
  const headlessDefault =
    (headlessMod as { default?: unknown })?.default ?? headlessMod;
  const TerminalCtor = (headlessDefault as { Terminal?: unknown })?.Terminal;
  if (typeof TerminalCtor !== "function") {
    return {
      ok: false,
      terminalVersion: null,
      reason:
        "@xterm/headless does not export a `Terminal` constructor (corrupt package?)",
    };
  }

  // Step 2 — @xterm/addon-serialize.
  let addonMod: unknown;
  try {
    addonMod = await importer("@xterm/addon-serialize");
  } catch (err) {
    return {
      ok: false,
      terminalVersion: null,
      reason: `@xterm/addon-serialize import failed: ${(err as Error).message}`,
    };
  }
  const addonDefault = (addonMod as { default?: unknown })?.default ?? addonMod;
  const SerializeAddonCtor =
    (addonDefault as { SerializeAddon?: unknown })?.SerializeAddon;
  if (typeof SerializeAddonCtor !== "function") {
    return {
      ok: false,
      terminalVersion: null,
      reason:
        "@xterm/addon-serialize does not export a `SerializeAddon` constructor",
    };
  }

  // Step 3 — read terminalVersion from the package.json. Use the same
  // dynamic-import path so a probe-induced failure mirrors the runtime.
  // Best-effort: success without a version is still ok (the snapshot
  // writer's own resolver does a separate fs read).
  let terminalVersion: string | null = null;
  try {
    const pkgMod = await importer("@xterm/headless/package.json");
    const pkg =
      (pkgMod as { default?: { version?: string } })?.default ??
      (pkgMod as { version?: string });
    if (pkg && typeof pkg.version === "string" && pkg.version.length > 0) {
      terminalVersion = pkg.version;
    }
  } catch {
    /* non-fatal — fs fallback exists in snapshot-store */
  }

  return { ok: true, terminalVersion, reason: null };
}
