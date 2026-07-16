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

import { MIN_NODE, compareSemver, installHint, isWindows } from "./util.mjs";

/**
 * Default runner: invoke `<cmd> --version` with shell:false and report whether
 * it actually ran. shell:false means PATHEXT is ignored on Windows, so the
 * callers pass the resolved names Node can spawn (`python`, `py`, `uv`, …).
 * @param {string} cmd @param {string[]} [args]
 * @returns {{ ok: boolean, stdout: string, stderr: string, code: number | null }}
 */
export function defaultRun(cmd, args = ["--version"]) {
  try {
    // On Windows the tools are `.cmd`/`.bat` shims (claude, npm, gh) that
    // shell:false CANNOT resolve (PATHEXT is ignored) — probing them that way
    // would report a perfectly-installed Claude as ABSENT and skip the plugin
    // phase forever. Go through the shell on Windows. cmd + args are fixed
    // internal literals (tool name + `--version`), so there is no injection
    // surface; a single joined string avoids the args-with-shell deprecation.
    const isWin = process.platform === "win32";
    // cmd is a fixed literal (claude/uv/python3/python/py/git/gh) with a fixed
    // --version arg and no user input; shell:true is the Windows-only .cmd
    // resolution branch. Semgrep false positive.
    const r = isWin
      ? spawnSync([cmd, ...args].join(" "), { encoding: "utf-8", shell: true, timeout: 8000 }) // nosemgrep: javascript.lang.security.audit.spawn-shell-true.spawn-shell-true
      : spawnSync(cmd, args, { encoding: "utf-8", shell: false, timeout: 8000 });
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

  // python — TEST-RUN probe (Store-stub trap), require >= 3.11.
  const py = resolvePython(run);
  const pyOk = py != null && compareSemver(py.version, "3.11.0") >= 0;
  checks.push({
    name: "python",
    ok: pyOk,
    detail: py ? `${py.version} (${py.bin})` : "not found (tried python3, python, py)",
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
  return lines.join("\n");
}
