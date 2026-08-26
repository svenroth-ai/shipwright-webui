/*
 * triage-cli-runner — the Command Center's sole write bridge for triage.
 *
 * Triage reads remain native TypeScript because they are latency-sensitive and
 * have no mutual-exclusion requirement. Every transition, however, executes
 * the Python CLI via `uv run --python ">=3.11"` so its FileLock owns the
 * compare-and-swap, residence choice, schema bootstrap and record-boundary
 * handling — in a Python that actually satisfies triage_cli.py's own floor,
 * not whichever of python3/python/py happened to answer `--version` first
 * (the grade.py sibling of this bug; see `uv-runner.ts`). triage_cli.py has
 * no `pyproject.toml` of its own, so this is `--python`, not `--project`
 * (verified: `uv run --python ">=3.11" triage_cli.py --help` exits 0).
 * `--no-project` is load-bearing, not decorative (Stage-3 doubt review,
 * 2026-08-26): without it, `uv run` walks up from the SPAWNING PROCESS's cwd
 * (never from the script's own path) looking for an ambient `pyproject.toml`
 * to activate — a webui deployment nested inside another Python-tooled
 * checkout would otherwise silently run this script against an unrelated
 * project. `--no-project` makes "no ambient project" structural rather than
 * an accident of this repo currently having none. There is deliberately no
 * TypeScript append fallback: an unavailable writer disables the UI instead.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { READINESS_REPAIR_COMMAND, shipwrightCacheRoot, type RunFn } from "./readiness-probe.js";
import { resolveUv } from "./uv-runner.js";

export const TRIAGE_CLI_TIMEOUT_MS = 30_000;

export interface TriageCliSpawnResult {
  code: number;
  stdout: string;
  stderr: string;
  spawnError?: string;
}

export type TriageCliSpawn = (
  bin: string,
  args: string[],
  options: { timeoutMs: number; env: NodeJS.ProcessEnv },
) => Promise<TriageCliSpawnResult>;

export interface TriageWriteAvailability {
  available: boolean;
  /** A background probe is still resolving; callers should refresh shortly. */
  checking?: boolean;
  reason?: string;
  repairCommand?: string;
}

export type TriageCliResult =
  | { kind: "ok"; operation: string; item: Record<string, unknown> }
  | { kind: "precondition" }
  | { kind: "not-found" }
  | { kind: "store-uninitialised" }
  | { kind: "lock-timeout" }
  | { kind: "engine-unavailable"; reason: string; repairCommand: string }
  | { kind: "failed"; reason: string };

export interface RunTriageCliInput {
  projectRoot: string;
  operation: "show" | "promote" | "dismiss" | "snooze" | "amend";
  itemId: string;
  args: string[];
}

export interface TriageCliDeps {
  run?: RunFn;
  spawn?: TriageCliSpawn;
  existsFn?: (p: string) => boolean;
  homeDir?: string;
  scriptOverride?: string;
  timeoutMs?: number;
  baseEnv?: NodeJS.ProcessEnv;
}

/** Resolve the single cache-owned CLI shipped with the Shipwright runtime. */
export function resolveTriageCliScript(deps: Pick<TriageCliDeps, "existsFn" | "homeDir" | "scriptOverride"> = {}): string | null {
  const exists = deps.existsFn ?? existsSync;
  if (deps.scriptOverride) return exists(deps.scriptOverride) ? deps.scriptOverride : null;
  const candidate = path.join(
    shipwrightCacheRoot(deps.homeDir ?? os.homedir()),
    "shared",
    "scripts",
    "tools",
    "triage_cli.py",
  );
  return exists(candidate) ? candidate : null;
}

export const defaultSpawnTriageCli: TriageCliSpawn = (bin, args, options) =>
  new Promise((resolve) => {
    execFile(
      bin,
      args,
      {
        encoding: "utf-8",
        timeout: options.timeoutMs,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
        env: options.env,
      },
      (error, stdout, stderr) => {
        const out = String(stdout ?? "");
        const err = String(stderr ?? "");
        if (!error) return resolve({ code: 0, stdout: out, stderr: err });
        const e = error as NodeJS.ErrnoException & { killed?: boolean };
        if (typeof e.code === "string") return resolve({ code: -1, stdout: out, stderr: err, spawnError: e.code });
        if (e.killed) return resolve({ code: 124, stdout: out, stderr: err, spawnError: "timeout" });
        return resolve({ code: typeof e.code === "number" ? e.code : 1, stdout: out, stderr: err });
      },
    );
  });

function unavailable(reason: string): TriageWriteAvailability {
  return { available: false, reason, repairCommand: READINESS_REPAIR_COMMAND };
}

export async function triageWriteAvailability(deps: TriageCliDeps = {}): Promise<TriageWriteAvailability> {
  if (!resolveTriageCliScript(deps)) return unavailable("The triage write engine isn't installed.");
  if (!(await resolveUv({ run: deps.run, homeDir: deps.homeDir, baseEnv: deps.baseEnv }))) {
    return unavailable("uv isn't installed — triage writes need it to run in a managed Python 3.11+.");
  }
  return { available: true };
}

function cleanStderr(stderr: string): string {
  return stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).pop() ?? "";
}

/** Execute one transition with fixed argv positions and consume the CLI JSON envelope. */
export async function runTriageCli(
  input: RunTriageCliInput,
  deps: TriageCliDeps = {},
): Promise<TriageCliResult> {
  const script = resolveTriageCliScript(deps);
  if (!script) return { kind: "engine-unavailable", reason: "The triage write engine isn't installed.", repairCommand: READINESS_REPAIR_COMMAND };
  const uv = await resolveUv({ run: deps.run, homeDir: deps.homeDir, baseEnv: deps.baseEnv });
  if (!uv) {
    return {
      kind: "engine-unavailable",
      reason: "uv isn't installed — triage writes need it to run in a managed Python 3.11+.",
      repairCommand: READINESS_REPAIR_COMMAND,
    };
  }

  const spawn = deps.spawn ?? defaultSpawnTriageCli;
  const result = await spawn(
    uv.bin,
    ["run", "--no-project", "--python", ">=3.11", script, "--project-root", input.projectRoot, input.operation, input.itemId, ...input.args, "--json"],
    { timeoutMs: deps.timeoutMs ?? TRIAGE_CLI_TIMEOUT_MS, env: uv.env },
  );

  if (result.code === -1) {
    return { kind: "engine-unavailable", reason: "uv couldn't start on this machine.", repairCommand: READINESS_REPAIR_COMMAND };
  }
  if (result.code === 3) return { kind: "precondition" };
  if (result.code === 4) return { kind: "not-found" };
  if (result.code === 5) return { kind: "store-uninitialised" };
  if (result.code === 6) return { kind: "lock-timeout" };
  if (result.code !== 0) {
    return { kind: "failed", reason: result.spawnError === "timeout" ? "Triage writing took too long and was stopped." : cleanStderr(result.stderr) || "The triage write engine exited with an error." };
  }
  try {
    const payload = JSON.parse(result.stdout) as { operation?: unknown; item?: unknown };
    if (typeof payload.operation !== "string" || payload.operation !== input.operation || !payload.item || typeof payload.item !== "object" || Array.isArray(payload.item)) {
      return { kind: "failed", reason: "The triage write engine returned an unrecognised response." };
    }
    return { kind: "ok", operation: payload.operation, item: payload.item as Record<string, unknown> };
  } catch {
    return { kind: "failed", reason: "The triage write engine didn't return valid JSON." };
  }
}
