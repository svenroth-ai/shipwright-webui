/*
 * grade-runner — the injection-safe, READ-ONLY bridge to the `shipwright-grade`
 * plugin's `grade.py` tool (A09b, FR-01.53). The Intent-Wizard's Grade door
 * renders the plugin's real `ReportModel`; this module produces it. Target
 * validation + plugin resolution live in `grade-target.ts`; this owns the spawn
 * + the outcome mapping.
 *
 * ── IO / injection boundary (the reason A09 was split) ──────────────────────
 * `grade.py <target> --format json` is spawned with **shell:false** and a
 * **fixed-literal python binary** (resolved by TEST-RUN, python3→python→py,
 * reusing `readiness-probe.resolvePython`). The target is passed as a **fixed
 * argv position** — never interpolated into a shell string, so no shell
 * metacharacter in a user-entered path/URL can reach a shell (there is none).
 * Mirrors the ADR-044 #9 / `pr-status.ts` spawn discipline. Must NOT trip
 * Semgrep `spawn-shell-true`.
 *
 * READ-ONLY: grade is a pure read of a repo. It registers no project, writes
 * nothing to the graded repo, and never touches `~/.claude/projects/**`,
 * `shipwright_run_config.json` or `run_loop_state.json` (CLAUDE.md rules 1/12).
 * A remote URL is shallow-cloned into a throwaway tempdir *by grade.py* and
 * purged when it exits — webui does not clone.
 *
 * Every grade.py outcome maps to an HONEST state (never a fabricated grade):
 *   exit 0 + JSON            → report-ready (raw model; the CLIENT reportShape
 *                              guard is the cross-repo contract check, ADR-045)
 *   exit 2 (TargetError)     → grade-failed        ("couldn't grade that repo")
 *   exit 3 (EngineUnavail.)  → engine-unavailable  (reuse the readiness repair)
 *   python/script missing    → engine-unavailable
 *   non-JSON stdout          → shape-unrecognised
 *   other non-zero / timeout → grade-failed
 *
 * Pure over its injected seams (`run`, `spawn`, `statDir`, fs) so every branch
 * is unit-testable without a real toolchain / a real clone (CI mocks the
 * subprocess — no live grade.py).
 */

import { execFile } from "node:child_process";

import {
  defaultRun,
  READINESS_REPAIR_COMMAND,
  resolvePython,
  type RunFn,
} from "./readiness-probe.js";
import {
  defaultStatDir,
  ENV_COMPLIANCE_ROOT,
  resolveComplianceRoot,
  resolveGradeScript,
  validateGradeTarget,
  type PluginResolveDeps,
} from "./grade-target.js";

/** grade.py can shallow-clone + read a whole history; a remote target needs
 *  headroom over a local one. Generous, but bounded (a hung clone is killed). */
export const DEFAULT_GRADE_TIMEOUT_MS = 120_000;

/** The honest outcome states — a superset mapped to the client's GradeReportState. */
export type GradeStatus =
  | "report-ready"
  | "grade-failed"
  | "engine-unavailable"
  | "shape-unrecognised";

export interface GradeOutcome {
  status: GradeStatus;
  /** Present ONLY for report-ready: the raw parsed ReportModel JSON. The client
   *  validates its shape (reportShape.ts) — the server never fabricates or
   *  reshapes it (AC5: render only what grade.py returned). */
  model?: unknown;
  /** Human, plain-language reason for a non-ready outcome. */
  reason?: string;
  /** engine-unavailable only: the one command that installs the grade engine. */
  repairCommand?: string;
}

/* ── The spawn ───────────────────────────────────────────────────────────── */

export interface SpawnResult {
  /** grade.py exit code; -1 for a spawn failure (python vanished), 124 timeout. */
  code: number;
  stdout: string;
  stderr: string;
  /** Set on a spawn failure (ENOENT) or a timeout kill — not a clean exit. */
  spawnError?: string;
}

export interface SpawnGradeOptions {
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}

export type SpawnGradeFn = (
  bin: string,
  args: string[],
  opts: SpawnGradeOptions,
) => Promise<SpawnResult>;

/**
 * Default spawn — `execFile` (shell:false) so no shell process exists and the
 * event loop is never blocked while grade.py reads a history / clones. The
 * target is `args[1]` (a fixed argv position), never a shell string.
 */
export const defaultSpawnGrade: SpawnGradeFn = (bin, args, opts) =>
  new Promise((resolve) => {
    execFile(
      bin,
      args,
      {
        encoding: "utf-8",
        timeout: opts.timeoutMs,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
        env: opts.env,
      },
      (error, stdout, stderr) => {
        const out = String(stdout ?? "");
        const err = String(stderr ?? "");
        if (!error) {
          resolve({ code: 0, stdout: out, stderr: err });
          return;
        }
        const e = error as NodeJS.ErrnoException & { killed?: boolean };
        if (typeof e.code === "string") {
          // ENOENT / EACCES — python failed to start.
          resolve({ code: -1, stdout: out, stderr: err, spawnError: e.code });
          return;
        }
        if (e.killed) {
          resolve({ code: 124, stdout: out, stderr: err, spawnError: "timeout" });
          return;
        }
        resolve({ code: typeof e.code === "number" ? e.code : 1, stdout: out, stderr: err });
      },
    );
  });

/* ── The runner ──────────────────────────────────────────────────────────── */

export interface RunGradeInput {
  /** The repo path or URL, as entered by the user. */
  target: string;
}

export interface RunGradeDeps {
  /** `--version` runner used by resolvePython (test seam). */
  run?: RunFn;
  /** grade.py spawn (test seam — CI mocks it; no live grade.py). */
  spawn?: SpawnGradeFn;
  /** Directory-existence check for a local target (test seam). */
  statDir?: (p: string) => boolean;
  homeDir?: string;
  existsFn?: (p: string) => boolean;
  readdirFn?: (p: string) => string[];
  scriptOverride?: string;
  complianceOverride?: string;
  timeoutMs?: number;
  /** Base env inherited by the child (defaults to process.env). */
  baseEnv?: NodeJS.ProcessEnv;
}

const ENGINE_UNAVAILABLE_REASON = "The grade engine isn't installed.";

function cleanStderr(stderr: string): string {
  // grade.py prefixes its own errors with "shipwright-grade: " — strip it for a
  // plain-language card; keep the human reason.
  const line = stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() ?? "";
  return line.replace(/^shipwright-grade:\s*/i, "").trim();
}

/**
 * Validate → resolve engine → spawn `grade.py <target> --format json` → map the
 * outcome to an honest {@link GradeOutcome}. Never throws for a grade failure;
 * only a programming error would reject.
 */
export async function runGrade(
  input: RunGradeInput,
  deps: RunGradeDeps = {},
): Promise<GradeOutcome> {
  const statDir = deps.statDir ?? defaultStatDir;
  const run = deps.run ?? defaultRun;
  const spawn = deps.spawn ?? defaultSpawnGrade;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_GRADE_TIMEOUT_MS;
  const resolveDeps: PluginResolveDeps = {
    homeDir: deps.homeDir,
    existsFn: deps.existsFn,
    readdirFn: deps.readdirFn,
  };

  // 1 — validate the target (shape + existence) BEFORE any spawn.
  const v = validateGradeTarget(input.target, statDir);
  if (!v.ok) return { status: "grade-failed", reason: v.reason };
  const target = input.target.trim();

  // 2 — resolve the engine: grade.py + a working python. Either missing is an
  //     honest "engine unavailable — run npx …" (reuse the readiness repair).
  const script = resolveGradeScript({ ...resolveDeps, scriptOverride: deps.scriptOverride });
  if (!script) {
    return {
      status: "engine-unavailable",
      reason: ENGINE_UNAVAILABLE_REASON,
      repairCommand: READINESS_REPAIR_COMMAND,
    };
  }
  const py = await resolvePython(run);
  if (!py) {
    return {
      status: "engine-unavailable",
      reason: "No working Python (3.11+) was found.",
      repairCommand: READINESS_REPAIR_COMMAND,
    };
  }

  // 3 — spawn. The compliance root is passed via env so grade.py's engine loads
  //     in the versioned cache layout (its default sibling-resolution fails there).
  const complianceRoot = resolveComplianceRoot({
    ...resolveDeps,
    complianceOverride: deps.complianceOverride,
  });
  const baseEnv = deps.baseEnv ?? process.env;
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  if (complianceRoot) env[ENV_COMPLIANCE_ROOT] = complianceRoot;

  // Fixed argv: options first, then a `--` END-OF-OPTIONS separator, then the
  // target as the sole positional. shell:false already blocks shell injection;
  // the `--` additionally blocks ARGUMENT injection — a target like `--no-clone`
  // or `--allow-network-private` is treated as a path, never a grade.py flag
  // (mirrors the pr-status.ts `--` discipline; verified against argparse).
  const args = [script, "--format", "json", "--", target];
  const r = await spawn(py.bin, args, { env, timeoutMs });

  // 4 — map the outcome.
  if (r.code === -1) {
    return {
      status: "engine-unavailable",
      reason: "Python couldn't start on this machine.",
      repairCommand: READINESS_REPAIR_COMMAND,
    };
  }
  if (r.code === 3) {
    return {
      status: "engine-unavailable",
      reason: cleanStderr(r.stderr) || ENGINE_UNAVAILABLE_REASON,
      repairCommand: READINESS_REPAIR_COMMAND,
    };
  }
  if (r.code === 2) {
    return { status: "grade-failed", reason: cleanStderr(r.stderr) || "Couldn't grade that repo." };
  }
  if (r.code !== 0) {
    return {
      status: "grade-failed",
      reason:
        r.spawnError === "timeout"
          ? "Grading took too long and was stopped."
          : cleanStderr(r.stderr) || "The grade tool exited with an error.",
    };
  }

  // exit 0 — parse the JSON. A non-JSON / non-object payload is a shape the card
  // can't render safely → the honest "report shape not recognised" state.
  let model: unknown;
  try {
    model = JSON.parse(r.stdout);
  } catch {
    return { status: "shape-unrecognised", reason: "The grade output wasn't valid JSON." };
  }
  if (model === null || typeof model !== "object" || Array.isArray(model)) {
    return { status: "shape-unrecognised", reason: "The grade output wasn't a report object." };
  }
  return { status: "report-ready", model };
}
