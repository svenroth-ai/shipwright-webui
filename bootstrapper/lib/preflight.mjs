/**
 * preflight.mjs — AC1a, the prerequisite gate (the THIRD silent death).
 *
 * The plugins do NOT run on Node alone: their hooks shell out to `uv` (159
 * `uv run` call sites across the installed hooks.json files), which resolves a
 * Python. Without uv + a WORKING Python every hook dies at session start while
 * `claude plugin list` still shows a cheerful checkmark. So preflight is a
 * loud, actionable gate, not a warning buried above "Command Center running".
 *
 * The Windows trap this file exists to dodge: `python3` is usually the
 * Microsoft-Store App-Execution-Alias stub — `command -v`/`where` FINDS it, but
 * running it does nothing. We therefore probe by TEST-RUNNING `--version` and
 * accept the first candidate that actually reports one (ported from
 * `scripts/verify-setup.sh`), never by mere presence on PATH.
 */

import { spawnSync } from "node:child_process";
import os from "node:os";

import { MIN_NODE, compareSemver, installHint, isWindows } from "./util.mjs";
import { probeEnv, resolvePosixBin } from "./probe-path.mjs";
import { resolveSpawn } from "./win32-spawn.mjs";

/**
 * Default runner: invoke `<cmd> --version` with `shell: false` and report
 * whether it actually ran.
 *
 * On Windows some of these tools are `.cmd`/`.bat` shims (`claude` from an npm
 * install) that a bare `shell: false` spawn CANNOT reach — probing them that way
 * would report a perfectly-installed Claude as ABSENT and skip the plugin phase
 * forever. That used to be answered with `shell: true`; `resolveSpawn` now finds
 * the real file via PATHEXT and routes a shim through an explicit
 * `cmd.exe /d /s /c` instead (see lib/win32-spawn.mjs).
 *
 * CALLER INVARIANT, still load-bearing: `cmd` is a fixed internal literal
 * (claude / uv / python3 / python / py / git / gh) and `args` is a fixed internal
 * literal too — `["--version"]` for every probe, plus the one `["python",
 * "find", ">=3.11"]` uv-can-supply-Python predicate. NO caller passes user input.
 * NOTHING here validates that — `defaultRun` is exported from a published `lib/`
 * and reaches the cmd.exe wrap with no charset gate of its own (unlike
 * `claude-cli.mjs`, which has `SAFE_ARG`). Only `runPreflight`'s call sites
 * honour it. A caller passing user input must gate it first.
 *
 * An unresolvable name yields `ok: false` — exactly the verdict the old shell
 * path produced via a non-zero exit. Note what "unresolvable" now means: a bare
 * name that PATHEXT cannot place falls back to a direct `CreateProcess` spawn
 * rather than being abandoned, because `realpath` cannot follow a Windows
 * App-Execution-Alias at all — so a genuinely INSTALLED Microsoft-Store Python
 * would otherwise be reported absent. The Store STUB is still rejected, by the
 * unchanged `\d+\.\d+` output requirement below rather than by failing to
 * resolve. Both verified on Windows 11, 2026-07-31.
 * @param {string} cmd @param {string[]} [args]
 * @returns {{ ok: boolean, stdout: string, stderr: string, code: number | null }}
 */
export function defaultRun(cmd, args = ["--version"], deps = {}) {
  const platform = deps.platform ?? process.platform;
  const homedir = deps.homedir ?? os.homedir();
  const env = probeEnv(platform, homedir, deps.env ?? process.env);
  try {
    // Windows resolves shims via PATHEXT against the augmented `env`; POSIX
    // resolves the absolute path itself so the augmented PATH actually applies.
    const plan =
      platform === "win32"
        ? resolveSpawn([cmd, ...args], { platform, env })
        : { command: resolvePosixBin(cmd, env), args };
    // UNREACHABLE as of iterate-2026-07-31 (win32-spawn divergence 5: an
    // unresolvable bare name comes back as itself). `spawnSync` does NOT throw
    // for a missing binary — it returns `{ error: ENOENT, status: null }` — so
    // the failure is carried by the `!r.error` term in `ok` below and never
    // reaches the catch. (An earlier version of this comment said "lands in the
    // catch"; Stage-3 doubt review disproved it. The verdict was always right,
    // the stated mechanism was not.) Kept as contract insurance.
    if (!plan) return { ok: false, stdout: "", stderr: "", code: null };
    const r = spawnSync(plan.command, plan.args, {
      encoding: "utf-8",
      shell: false,
      timeout: 8000,
      env,
      windowsVerbatimArguments: plan.windowsVerbatimArguments,
    });
    const stdout = (r.stdout ?? "").toString();
    const stderr = (r.stderr ?? "").toString();
    // A real interpreter/tool exits 0 AND prints a version somewhere. The MS
    // Store python3 stub exits non-zero (or prints its "not found" nag), so
    // requiring both status 0 and a digit-bearing line rejects it.
    const ok = r.status === 0 && !r.error && /\d+\.\d+/.test(stdout + stderr);
    return { ok, stdout, stderr, code: r.status ?? null };
  } catch {
    return { ok: false, stdout: "", stderr: "", code: null };
  }
}

/** First `\d+.\d+(.\d+)?` token in a `--version` blob, or "". */
export function extractVersion(out) {
  const m = /(\d+\.\d+(?:\.\d+)?)/.exec(String(out ?? ""));
  return m ? m[1] : "";
}

/**
 * Resolve ONE working Python by test-running `--version` (python3 → python →
 * py). Returns `{ bin, version }` or `null`. The MS-Store stub fails the
 * `run().ok` test and is skipped — the whole reason this is not `command -v`.
 * @param {(cmd: string, args?: string[]) => ReturnType<typeof defaultRun>} run
 */
export function resolvePython(run) {
  for (const bin of ["python3", "python", "py"]) {
    const r = run(bin, ["--version"]);
    if (r.ok) return { bin, version: extractVersion(r.stdout + r.stderr) };
  }
  return null;
}

/**
 * Run the full preflight. Pure over its injected seams (`run`, `nodeVersion`,
 * `platform`) so every branch is unit-testable without a real toolchain.
 *
 * @param {{
 *   run?: (cmd: string, args?: string[]) => ReturnType<typeof defaultRun>,
 *   nodeVersion?: string,
 *   platform?: NodeJS.Platform,
 * }} [deps]
 */
export function runPreflight(deps = {}) {
  const { run = defaultRun, nodeVersion = process.version, platform = process.platform } = deps;
  /** @type {{name:string, ok:boolean, detail:string, hint?:string, hard:boolean, optional?:boolean}[]} */
  const checks = [];

  // claude — its own gate: absent → skip plugins + loud warning + non-zero exit.
  const claude = run("claude", ["--version"]);
  checks.push({
    name: "claude",
    ok: claude.ok,
    detail: claude.ok ? extractVersion(claude.stdout + claude.stderr) : "not found",
    hint: claude.ok ? undefined : installHint("claude", platform),
    hard: true,
  });

  // uv — hard requirement for every plugin hook.
  const uv = run("uv", ["--version"]);
  checks.push({
    name: "uv",
    ok: uv.ok,
    detail: uv.ok ? extractVersion(uv.stdout + uv.stderr) : "not found",
    hint: uv.ok ? undefined : installHint("uv", platform),
    hard: true,
  });

  // python — the stack runs every hook via `uv run`, which resolves a
  // uv-MANAGED interpreter. So a working system python3 >= 3.11 satisfies the
  // gate, but so does uv being able to PROVIDE 3.11+ — the common Mac case where
  // `uv python install 3.11` left system `python3` at 3.9. System probe first
  // (TEST-RUN, Store-stub trap); only fall through to uv when it is short.
  const py = resolvePython(run);
  const sysOk = py != null && compareSemver(py.version, "3.11.0") >= 0;
  let pyOk = sysOk;
  let pyDetail = py ? `${py.version} (${py.bin})` : "not found (tried python3, python, py)";
  if (!pyOk && uv.ok) {
    // `uv python find` locates an installed 3.11+ WITHOUT downloading — a clean,
    // side-effect-free predicate for "uv can supply Python for the hooks".
    const uvPy = run("uv", ["python", "find", ">=3.11"]);
    // Gate on EXIT CODE, not defaultRun's version-shaped `ok`: `uv python find`
    // prints a PATH, and a resolved interpreter whose path carries no decimal
    // (e.g. a `/usr/local/bin/python3` symlink) would fail the `\d+\.\d+` output
    // test despite a clean exit — re-introducing the very false "not found" this
    // change removes. uv exits 0 on a hit, 2 on a miss (verified 2026-08-22).
    if (uvPy.code === 0) {
      pyOk = true;
      pyDetail = `${extractVersion(uvPy.stdout + uvPy.stderr) || "3.11+"} (uv-managed)`;
    }
  }
  checks.push({
    name: "python",
    ok: pyOk,
    detail: pyDetail,
    hint: pyOk ? undefined : installHint("python", platform),
    hard: true,
  });

  // node — assert the packaged server's minimum.
  const nodeOk = compareSemver(nodeVersion, MIN_NODE) >= 0;
  checks.push({
    name: "node",
    ok: nodeOk,
    detail: nodeOk ? nodeVersion : `${nodeVersion} (need >= ${MIN_NODE})`,
    hint: nodeOk ? undefined : installHint("node", platform),
    hard: true,
  });

  // git — needed by the SDLC plugins.
  const git = run("git", ["--version"]);
  checks.push({
    name: "git",
    ok: git.ok,
    detail: git.ok ? extractVersion(git.stdout + git.stderr) : "not found",
    hint: git.ok ? undefined : installHint("git", platform),
    hard: true,
  });

  // gh — optional (PRs). A soft note, never a failure.
  const gh = run("gh", ["--version"]);
  checks.push({
    name: "gh",
    ok: gh.ok,
    detail: gh.ok ? extractVersion(gh.stdout + gh.stderr) : "not found (optional — needed for PRs)",
    hard: false,
    optional: true,
  });

  const hardFailures = checks.filter((c) => c.hard && !c.ok);
  // The plugin phase needs claude + uv + python (hook runtime) AND git —
  // `claude plugin marketplace add` clones the marketplace over git, and the
  // SDLC plugins are git-based. Node is NOT gated here: it gates the SERVER
  // (and npx already blocks a too-old engine), not the plugin install.
  const pluginPhaseOk = claude.ok && uv.ok && pyOk && git.ok;

  return {
    checks,
    python: py,
    hasClaude: claude.ok,
    hasUv: uv.ok,
    hasPython: pyOk,
    hasNode: nodeOk,
    hasGit: git.ok,
    /** Plugins can only be installed when claude + uv + python are all real. */
    pluginPhaseOk,
    /** Non-zero exit when any hard prerequisite is missing (AC1a). */
    exitCode: hardFailures.length,
    isWindows: isWindows(platform),
  };
}

/** Render the one honest verdict block a `doctor`-style tool prints. */
export function renderVerdict(result, mark) {
  const lines = ["Prerequisites:"];
  for (const c of result.checks) {
    const glyph = c.ok ? mark.pass : c.optional ? mark.skip : mark.fail;
    lines.push(`  ${glyph} ${c.name}: ${c.detail}`);
    if (!c.ok && c.hint) lines.push(`        -> ${c.hint}`);
  }
  // A just-installed tool lands in ~/.local/bin but the running shell's PATH was
  // captured before the install — so "not found" here is often really "not on
  // PATH yet". Say so, once, OS-aware, whenever a hard prerequisite is missing.
  if (result.checks.some((c) => c.hard && !c.ok)) {
    lines.push("");
    lines.push(
      result.isWindows
        ? "  Note: if you JUST installed one of these, open a NEW terminal so it lands on your PATH, then re-run."
        : "  Note: if you JUST installed one of these, open a new terminal (or `source ~/.zshrc` / `~/.bashrc`) so it lands on your PATH, then re-run.",
    );
  }
  return lines.join("\n");
}
