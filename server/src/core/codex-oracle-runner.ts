/*
 * core/codex-oracle-runner.ts — the injection-safe bridge to `shared/
 * scripts/tools/codex_completion_oracle.py` (Codex Light §1.7).
 *
 * Mirrors `triage-cli-runner.ts`'s spawn discipline verbatim (same reason:
 * `uv run --no-project --python ">=3.11"` so the script always runs in a
 * Python that actually satisfies its own floor, never whichever of
 * python3/python/py answers `--version` first — see that module's header
 * for the incident this avoids). `--no-project` matters here too: the
 * oracle script has no `pyproject.toml` of its own (it's a plain module
 * under `shared/scripts/tools/`), so an ambient one discovered by walking
 * up from the SPAWNING PROCESS's cwd must never get silently activated.
 *
 * Unlike `grade-runner.ts` / `triage-cli-runner.ts`, the oracle CLI prints
 * its JSON payload on EVERY exit code (0-3 all carry a verdict; there is no
 * "non-JSON means engine trouble" branch) — see `codex_completion_oracle.py`
 * `main()`. This wrapper therefore always attempts to parse stdout first and
 * only falls back to an engine-unavailable/failed outcome when uv/the
 * script itself couldn't be resolved or spawned at all.
 *
 * Required-CI PR-review finding (PR #466): the spawn pattern was a
 * verbatim mirror of `triage-cli-runner.ts` (already in production), but
 * the CADENCE is new — this runs every 60s tick for as long as a task
 * stays stalled, where the triage call site fires once per user-initiated
 * transition. `execFile`'s own `timeout` only SIGTERMs the immediate `uv`
 * child; if `uv run` had already forked a Python grandchild, Node would
 * not reap that process tree on Windows by default. Fixed (not merely
 * accepted) via `cli-child-spawn.ts`'s shared tree-kill-on-timeout
 * wrapper, shared with `triage-cli-runner.ts` so the two can't re-diverge.
 */

import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { defaultCliChildSpawn } from "./cli-child-spawn.js";
import { READINESS_REPAIR_COMMAND, shipwrightCacheRoot, type RunFn } from "./readiness-probe.js";
import { resolveUv } from "./uv-runner.js";

export const CODEX_ORACLE_TIMEOUT_MS = 30_000;

/** Verbatim mirror of `codex_completion_oracle.py`'s `verdict` field. */
export type OracleVerdict = "done" | "not_done" | "delivery_pending" | "no_oracle";

export interface OracleEvidence {
  /**
   * §5.1's correction — present only on an `iterate`-phase `delivery_pending`
   * verdict. `"error"` = watch_pr_delivery.py's checks_failed/closed branch
   * (a PR exists but its delivery failed — never re-poll forever). Absent or
   * `"indeterminate"` = case 13 proper (CI/review/auto-merge still running,
   * or the watcher itself produced no verdict) — safe to keep re-polling.
   */
  delivery_state?: "error" | "indeterminate";
  [key: string]: unknown;
}

export interface OracleResult {
  verdict: OracleVerdict;
  phase: string;
  session: string;
  evidence: OracleEvidence;
}

export type OracleOutcome =
  | { kind: "ok"; result: OracleResult }
  | { kind: "engine-unavailable"; reason: string; repairCommand: string }
  | { kind: "failed"; reason: string };

export interface OracleSpawnResult {
  code: number;
  stdout: string;
  stderr: string;
  spawnError?: string;
}

export type OracleSpawnFn = (
  bin: string,
  args: string[],
  options: { timeoutMs: number; env: NodeJS.ProcessEnv },
) => Promise<OracleSpawnResult>;

export const defaultSpawnOracle: OracleSpawnFn = defaultCliChildSpawn;

export interface RunCodexOracleInput {
  projectRoot: string;
  phase: string;
  session: string;
  /** ISO-8601 with timezone — the §2.4 degradation-path floor. */
  since?: string;
}

export interface CodexOracleDeps {
  run?: RunFn;
  spawn?: OracleSpawnFn;
  existsFn?: (p: string) => boolean;
  homeDir?: string;
  scriptOverride?: string;
  timeoutMs?: number;
  baseEnv?: NodeJS.ProcessEnv;
}

/** Resolve the single cache-owned oracle CLI shipped with the Shipwright runtime. */
export function resolveCodexOracleScript(
  deps: Pick<CodexOracleDeps, "existsFn" | "homeDir" | "scriptOverride"> = {},
): string | null {
  const exists = deps.existsFn ?? existsSync;
  if (deps.scriptOverride) return exists(deps.scriptOverride) ? deps.scriptOverride : null;
  const candidate = path.join(
    shipwrightCacheRoot(deps.homeDir ?? os.homedir()),
    "shared",
    "scripts",
    "tools",
    "codex_completion_oracle.py",
  );
  return exists(candidate) ? candidate : null;
}

function cleanStderr(stderr: string): string {
  return stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).pop() ?? "";
}

const ENGINE_UNAVAILABLE_REASON = "The Codex completion oracle isn't installed.";

/**
 * Run `codex_completion_oracle.py --project-root <root> --phase <p>
 * --session <sid> [--since <iso>]` and parse its JSON verdict. Never
 * throws for an oracle failure — only a programming error would reject.
 */
export async function runCodexOracle(
  input: RunCodexOracleInput,
  deps: CodexOracleDeps = {},
): Promise<OracleOutcome> {
  const script = resolveCodexOracleScript(deps);
  if (!script) {
    return { kind: "engine-unavailable", reason: ENGINE_UNAVAILABLE_REASON, repairCommand: READINESS_REPAIR_COMMAND };
  }
  const uv = await resolveUv({ run: deps.run, homeDir: deps.homeDir, baseEnv: deps.baseEnv });
  if (!uv) {
    return {
      kind: "engine-unavailable",
      reason: "uv isn't installed — the Codex completion oracle needs it to run in a managed Python 3.11+.",
      repairCommand: READINESS_REPAIR_COMMAND,
    };
  }

  const spawn = deps.spawn ?? defaultSpawnOracle;
  const args = [
    "run",
    "--no-project",
    "--python",
    ">=3.11",
    script,
    "--project-root",
    input.projectRoot,
    "--phase",
    input.phase,
    "--session",
    input.session,
    ...(input.since ? ["--since", input.since] : []),
  ];
  const result = await spawn(uv.bin, args, {
    timeoutMs: deps.timeoutMs ?? CODEX_ORACLE_TIMEOUT_MS,
    env: uv.env,
  });

  if (result.code === -1) {
    return { kind: "engine-unavailable", reason: "uv couldn't start on this machine.", repairCommand: READINESS_REPAIR_COMMAND };
  }
  // Every other exit (0-3 documented, anything else a crash) prints JSON on
  // stdout per the script's own contract — try to parse before giving up.
  try {
    const payload = JSON.parse(result.stdout) as Partial<OracleResult>;
    if (
      (payload.verdict === "done" ||
        payload.verdict === "not_done" ||
        payload.verdict === "delivery_pending" ||
        payload.verdict === "no_oracle") &&
      typeof payload.phase === "string" &&
      typeof payload.session === "string" &&
      payload.evidence &&
      typeof payload.evidence === "object"
    ) {
      return {
        kind: "ok",
        result: {
          verdict: payload.verdict,
          phase: payload.phase,
          session: payload.session,
          evidence: payload.evidence as OracleEvidence,
        },
      };
    }
  } catch {
    /* fall through to the failed branch below */
  }
  return {
    kind: "failed",
    reason:
      result.spawnError === "timeout"
        ? "The completion oracle took too long and was stopped."
        : cleanStderr(result.stderr) || "The completion oracle returned an unrecognised response.",
  };
}
