/*
 * campaign-readiness.ts — the READ-ONLY bridge to the monorepo scheduler's
 * `loop_claim.py readiness` (contract `loop-readiness-1.0`, see
 * `campaign-readiness-schema.ts`). The DAG view and the launch guard render /
 * enforce THIS verdict; the WebUI never computes readiness itself.
 *
 * Where it runs: a campaign lives in its own worktree
 * (`campaign-worktree-root.ts`), so both `--state` and `--campaign-worktree`
 * point there — the batch base is resolved from that cwd. A legacy campaign
 * (no worktree) falls back to the project root, and only when that root's loop
 * state actually contains this campaign's units. A missing state file is
 * "no loop running", not an error.
 *
 * Spawn discipline mirrors `triage-cli-runner.ts`: `uv run --no-project
 * --python ">=3.11"`, shell:false, fixed argv positions, honest
 * engine-unavailable when uv / the script is absent — never a silent python
 * fallback. The command is read-only (no lock, no claim, no state write) but
 * may run `git fetch origin` once per call, so results are cached and
 * concurrent callers share one in-flight call. NEVER put this on the 3 s
 * campaigns poll.
 */

import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { campaignSlugFromSpecPath } from "./campaign-loop-state.js";
import { loopStatePathFor, resolveCampaignStateRoot } from "./campaign-worktree-root.js";
import {
  parseReadinessReport,
  readinessMajor,
  SUPPORTED_READINESS_MAJOR,
  type ReadinessReport,
} from "./campaign-readiness-schema.js";
import { defaultCliChildSpawn, type CliChildSpawnFn } from "./cli-child-spawn.js";
import { READINESS_REPAIR_COMMAND, shipwrightCacheRoot, type RunFn } from "./readiness-probe.js";
import { resolveUv } from "./uv-runner.js";

/** `readiness` may `git fetch origin` (≤60 s) then re-check ancestry. */
export const READINESS_CLI_TIMEOUT_MS = 90_000;
/** How long a computed outcome is served before the next call recomputes. */
export const READINESS_CACHE_TTL_MS = 15_000;
/** A failed / unavailable outcome is retried sooner. */
const READINESS_ERROR_TTL_MS = 5_000;

export type ReadinessOutcome =
  | { status: "report"; report: ReadinessReport }
  | { status: "no-loop" }
  | { status: "unsupported-version"; version: string }
  | { status: "engine-unavailable"; reason: string; repairCommand: string }
  | { status: "failed"; reason: string };

export interface ReadinessDeps {
  run?: RunFn;
  spawn?: CliChildSpawnFn;
  existsFn?: (p: string) => boolean;
  readFileFn?: (p: string) => string;
  homeDir?: string;
  baseEnv?: NodeJS.ProcessEnv;
  scriptOverride?: string;
  timeoutMs?: number;
  now?: () => number;
}

/** The cache-owned scheduler CLI shipped with the Shipwright runtime
 *  (`SHIPWRIGHT_LOOP_CLAIM_SCRIPT` overrides the location). */
export function resolveLoopClaimScript(
  deps: Pick<ReadinessDeps, "existsFn" | "homeDir" | "scriptOverride"> = {},
): string | null {
  const exists = deps.existsFn ?? existsSync;
  const candidate =
    deps.scriptOverride ??
    // Operator override (isolated E2E stacks run with an ephemeral HOME, so the
    // plugin cache is not at the default location there).
    process.env.SHIPWRIGHT_LOOP_CLAIM_SCRIPT ??
    path.join(shipwrightCacheRoot(deps.homeDir ?? os.homedir()), "shared", "scripts", "lib", "loop_claim.py");
  return exists(candidate) ? candidate : null;
}

/** True when a legacy (project-root) loop state holds units of `slug`. */
function stateBelongsToSlug(statePath: string, slug: string, read: (p: string) => string): boolean {
  try {
    const parsed = JSON.parse(read(statePath)) as { kind?: unknown; units?: unknown };
    if (parsed?.kind !== "sub_iterate" || !Array.isArray(parsed.units)) return false;
    return parsed.units.some(
      (u: { spec_path?: unknown }) =>
        typeof u?.spec_path === "string" && campaignSlugFromSpecPath(u.spec_path) === slug,
    );
  } catch {
    return false;
  }
}

function lastLine(text: string): string {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() ?? "";
}

/** Run `readiness` once for one campaign (uncached). */
export async function computeReadiness(
  input: { projectRoot: string; slug: string },
  deps: ReadinessDeps = {},
): Promise<ReadinessOutcome> {
  const exists = deps.existsFn ?? existsSync;
  const read = deps.readFileFn ?? ((p: string) => readFileSync(p, "utf-8"));
  const stateRoot = resolveCampaignStateRoot(input.projectRoot, input.slug);
  const statePath = loopStatePathFor(stateRoot.root);
  if (!exists(statePath)) return { status: "no-loop" };
  if (!stateRoot.worktree && !stateBelongsToSlug(statePath, input.slug, read)) {
    return { status: "no-loop" };
  }

  const script = resolveLoopClaimScript(deps);
  const unavailable = (reason: string): ReadinessOutcome => ({
    status: "engine-unavailable",
    reason,
    repairCommand: READINESS_REPAIR_COMMAND,
  });
  if (!script) return unavailable("The campaign scheduler isn't installed.");
  const uv = await resolveUv({ run: deps.run, homeDir: deps.homeDir, baseEnv: deps.baseEnv });
  if (!uv) return unavailable("uv isn't installed — readiness needs it to run in a managed Python 3.11+.");

  const spawn = deps.spawn ?? defaultCliChildSpawn;
  const result = await spawn(
    uv.bin,
    [
      "run", "--no-project", "--python", ">=3.11", script, "readiness",
      "--state", statePath, "--campaign-worktree", stateRoot.root, "--json",
    ],
    { timeoutMs: deps.timeoutMs ?? READINESS_CLI_TIMEOUT_MS, env: uv.env },
  );

  if (result.code === -1) return unavailable("uv couldn't start on this machine.");
  if (result.code !== 0) {
    if (/only valid for kind/.test(result.stderr)) return { status: "no-loop" };
    return {
      status: "failed",
      reason:
        result.spawnError === "timeout"
          ? "Checking readiness took too long and was stopped."
          : lastLine(result.stderr) || "The campaign scheduler exited with an error.",
    };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    return { status: "failed", reason: "The campaign scheduler didn't return valid JSON." };
  }
  const major = readinessMajor((payload as { schema_version?: unknown } | null)?.schema_version);
  if (major !== null && major !== SUPPORTED_READINESS_MAJOR) {
    return { status: "unsupported-version", version: String((payload as { schema_version: string }).schema_version) };
  }
  const report = parseReadinessReport(payload);
  if (!report) return { status: "failed", reason: "The campaign scheduler returned an unrecognised response." };
  return { status: "report", report };
}

/* ── Cache + in-flight coalescing ────────────────────────────────────────── */

interface CacheEntry {
  at: number;
  outcome: ReadinessOutcome;
}
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<ReadinessOutcome>>();

/** Test seam: forget every cached / in-flight result. */
export function resetReadinessCache(): void {
  cache.clear();
  inflight.clear();
}

export interface GetReadinessOptions {
  /** Serve a cached outcome no older than this. Default {@link READINESS_CACHE_TTL_MS}. */
  maxAgeMs?: number;
  /** Bound the wait; on expiry resolve `"timeout"` (the call keeps running and lands in the cache). */
  maxWaitMs?: number;
}

/**
 * Cached, coalesced readiness. `"timeout"` only when `maxWaitMs` elapsed first
 * — the launch guard reads that as "readiness not checked" (fail open, loudly).
 */
export async function getReadiness(
  input: { projectRoot: string; slug: string },
  deps: ReadinessDeps = {},
  opts: GetReadinessOptions = {},
): Promise<ReadinessOutcome | "timeout"> {
  const now = deps.now ?? Date.now;
  const key = `${input.projectRoot}\u0000${input.slug}`;
  const maxAge = opts.maxAgeMs ?? READINESS_CACHE_TTL_MS;
  const hit = cache.get(key);
  if (hit) {
    const ttl = hit.outcome.status === "report" || hit.outcome.status === "no-loop" ? maxAge : Math.min(maxAge, READINESS_ERROR_TTL_MS);
    if (now() - hit.at <= ttl) return hit.outcome;
  }

  let pending = inflight.get(key);
  if (!pending) {
    pending = computeReadiness(input, deps)
      .then((outcome) => {
        cache.set(key, { at: now(), outcome });
        return outcome;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  if (opts.maxWaitMs === undefined) return pending;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), opts.maxWaitMs);
  });
  try {
    return await Promise.race([pending, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
