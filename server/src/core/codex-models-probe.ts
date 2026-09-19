/*
 * codex-models-probe — the "codex debug models" catalog PROBE
 * (iterate-2026-09-19-codex-model-catalog, follow-up to shipwright#471/#473).
 *
 * Replaces the withdrawn hardcoded model-slug enum (shipwright#771) with a
 * live probe of the Codex CLI's own catalog, so the New Iterate combobox
 * never lags the provider's own model lineup. Reuses `defaultRunShim` from
 * `readiness-probe-run.ts` — `codex` installs as a Windows `.cmd` PATHEXT
 * shim (no `codex.exe`), which `execFile(cmd, args, {shell:false})` cannot
 * invoke directly (see that module's own doc comment); `defaultRunShim`
 * already solves this for the readiness probe's `codex --version` check, and
 * this is the same binary.
 *
 * Runs with NO extra flags — deliberately not `--bundled` ("skip refresh,
 * dump only the catalog shipped with this binary"): empirically, `--bundled`
 * returns a visibly OLDER catalog (verified during this iterate's Confidence
 * Calibration — missing a newly-listed model, carrying stale entries the
 * refreshed call no longer lists). The whole point of this probe is to stay
 * ahead of a hand-maintained list, so the default (refreshing) invocation is
 * the only one that serves that goal.
 *
 * Verified during this iterate: `codex debug models` requires NO
 * authentication (re-ran with an empty `CODEX_HOME` — no `auth.json` — and
 * it still exited 0 with the full catalog), so this probe has no
 * auth-specific degraded path to handle.
 */

import { CODEX_MODEL_SLUG_PATTERN } from "../external/launch/parse-body.js";
import { defaultRunShim, type RunFn } from "./readiness-probe-run.js";

export interface CodexModelCatalogEntry {
  slug: string;
  display_name: string;
}

export interface CodexModelsProbeResult {
  ok: boolean;
  models: CodexModelCatalogEntry[];
}

export interface CodexModelsProbeDeps {
  run?: RunFn;
}

/**
 * Run `codex debug models` and reduce its raw catalog (which also carries
 * per-model reasoning-level metadata and multi-KB prompt text this codebase
 * has no use for) down to the `{slug, display_name}` pairs a launch-form
 * combobox needs. Never throws.
 *
 * Filters to entries that are objects with a `slug` matching the existing
 * `CODEX_MODEL_SLUG_PATTERN` (the same syntactic gate `parse-body.ts` applies
 * to a launch request — imported directly here since this is an intra-server
 * import, not the cross-package case DO-NOT #7 forbids) and a non-empty
 * string `display_name`, with `visibility === "list"` (excludes
 * internal/reserved entries like `codex-auto-review`). A single malformed
 * entry is dropped, not fatal to the rest of the list — this is untrusted
 * external-process output whose shape this codebase does not control.
 * (external review fix, both reviewers, 2026-09-19 architecture review.)
 *
 * Gates on `result.code === 0`, NOT `result.ok` — `readiness-probe-run.ts`'s
 * shared `ok` heuristic (`!error && /\d+\.\d+/.test(stdout+stderr)`) was
 * written for `--version` probes and requires a dotted version number
 * somewhere in the output. A real catalog containing only integer-suffixed
 * slugs (no dotted version anywhere in the JSON) would trip that heuristic to
 * `false` despite a clean exit and fully valid JSON — exactly the false
 * `unavailable` gap `RunResult.code`'s own doc comment already names `code`
 * as the fix for (code-review finding, 2026-09-19). `code` can be `null` on
 * ENOENT/timeout, hence the strict `=== 0`.
 *
 * De-duplicates on `slug`, first-wins — the CLI's own catalog shape is
 * untrusted external-process output (same reasoning as the per-entry
 * shape checks above), and a duplicate slug would otherwise reach the
 * client as two `<option>`s sharing one React key (doubt-review finding,
 * 2026-09-19).
 */
export async function runCodexModelsProbe(deps: CodexModelsProbeDeps): Promise<CodexModelsProbeResult> {
  const run = deps.run ?? defaultRunShim;
  let result;
  try {
    result = await run("codex", ["debug", "models"]);
  } catch {
    // `defaultRunShim`/`defaultRun` never reject (execFile's callback always
    // resolves a RunResult) — this guards a rejecting `run` override, so the
    // "never throws" contract this docstring promises actually holds for any
    // caller's `deps.run`, not just the two shipped implementations
    // (external code-review finding, 2026-09-19).
    return { ok: false, models: [] };
  }
  if (result.code !== 0) return { ok: false, models: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return { ok: false, models: [] };
  }

  const rawModels = (parsed as { models?: unknown } | null)?.models;
  if (!Array.isArray(rawModels)) return { ok: false, models: [] };

  const bySlug = new Map<string, CodexModelCatalogEntry>();
  for (const entry of rawModels) {
    if (!entry || typeof entry !== "object") continue;
    const { slug, display_name, visibility } = entry as Record<string, unknown>;
    if (visibility !== "list") continue;
    if (typeof slug !== "string" || !CODEX_MODEL_SLUG_PATTERN.test(slug)) continue;
    if (typeof display_name !== "string" || display_name.trim() === "") continue;
    if (!bySlug.has(slug)) bySlug.set(slug, { slug, display_name });
  }
  return { ok: true, models: [...bySlug.values()] };
}
