/*
 * Codex CLI launch-command builder (Spec/codex-light-webui.md §2.1-§2.3).
 *
 * Sibling of `buildCopyCommands` (launcher.ts) — same three-shell
 * `CopyCommandForms` output, same "webui never spawns a process, only
 * builds a string" contract (CLAUDE.md rule 1 / rule 19). The launch
 * chokepoint in `external/launch/routes.ts` calls this instead of
 * `buildCopyCommands` whenever `runtimeForTask(task) === "codex"`.
 *
 * v1 launches Codex as a plain, live, interactive TUI in a pty (the same
 * mechanism Claude uses today) — never the app-server protocol (§0/§2.2).
 *
 * Resume carries the same autonomy/env-inherit flags as a fresh launch
 * (external-code-review finding, 2026-09-16): `codex resume --help`
 * accepts `-c`/`--enable`/`--yolo` identically to the top-level command
 * (verified live against the installed CLI) — §2.2's terse "Resume: `codex
 * resume <threadId>`" example is abbreviated prose, not a CLI constraint,
 * and §2.4's mitigation 1 plus AC4 both require it on every launch.
 */

import { qPs, qCmd, qPosix, toPosixPath } from "./shell-quote.js";
import { buildCdPrefix, type CopyCommandForms } from "./launcher.js";

export interface CodexLaunchArgs {
  cwd: string;
  /** Defaults to "guided" when omitted (matches AutonomyToggle's own default). */
  autonomy?: "guided" | "autonomous";
  /** true → emit `codex resume <threadId>` instead of a fresh launch. */
  resume?: boolean;
  /** Required when `resume` is true — persisted at launch (§4). */
  threadId?: string;
  phase?: string;
  description?: string;
  /**
   * §2.3 — whether the project's `AGENTS.md` already carries the Codex
   * operating contract. When true AND `phase === "iterate"`, the prompt
   * omits the SKILL.md pointer and the inlined model-pin/review-cascade
   * text (AGENTS.md already covers both for that phase). Computed by the
   * caller (a plain `existsSync` check) — this module stays pure.
   */
  hasAgentsMd?: boolean;
  /**
   * iterate-2026-09-17-codex-model-tier-parameterization — session-scoped
   * override for Codex's own top-level model (one of the confirmed catalog
   * slugs, validated by the caller). Emitted as a real `-c model=` CLI
   * flag, never prose — it is layered on top of `~/.codex/config.toml` and
   * any project config *before* Codex reads `AGENTS.md`, so it applies
   * unconditionally on `hasAgentsMd` and doesn't depend on Codex's own
   * instruction-following. Undefined → no flag, no behavior change.
   */
  implementationModel?: string;
  /**
   * iterate-2026-09-19-codex-reviewer-fields (shipwright#772) — session-
   * scoped overrides for Codex's own review subagents. Unlike
   * `implementationModel` these are NOT `-c` flags read by the top-level
   * `codex` process itself; `run_codex_review` (invoked by Codex's shell
   * tool mid-session) resolves `SHIPWRIGHT_CODEX_PLAN_REVIEW_MODEL` /
   * `SHIPWRIGHT_CODEX_REVIEW_MODEL` from its OWN process env ahead of the
   * project's `shipwright_model_config.json` fallback — so they're emitted
   * here as an env-var prefix on the command line, ahead of `codex`, and
   * reach that subprocess via `shell_environment_policy.inherit=all`
   * (already unconditional above). Undefined → no prefix, no behavior
   * change, same as `implementationModel`.
   */
  planReviewModel?: string;
  reviewModel?: string;
}

export function buildCodexCommands(args: CodexLaunchArgs): CopyCommandForms {
  return {
    powershell: renderCodex(args, qPs, "powershell"),
    cmd: renderCodex(args, qCmd, "cmd"),
    posix: renderCodex(args, qPosix, "posix"),
  };
}

function renderCodex(
  args: CodexLaunchArgs,
  q: (v: string) => string,
  shellForm: "powershell" | "cmd" | "posix",
): string {
  const cwd = shellForm === "posix" ? toPosixPath(args.cwd) : args.cwd;
  const cdPrefix = buildCdPrefix(shellForm, args.cwd);
  const envPrefix = buildReviewEnvPrefix(args, q, shellForm);

  const autonomy = args.autonomy ?? "guided";

  if (args.resume) {
    if (!args.threadId) {
      throw new Error("resume=true requires threadId");
    }
    // External-code-review finding (GLM MEDIUM, 2026-09-16): `codex resume
    // --help` accepts the same `-c`/`--enable`/`--yolo` flags as a fresh
    // launch (verified live against the installed CLI) — §2.2's literal
    // "Resume: `codex resume <threadId>`" example is abbreviated prose, not
    // a CLI constraint. Without these, a resumed Guided/Autonomous task
    // silently lost both session-identity tracking (§2.4 mitigation 1) and
    // AC4's "autonomy governs Codex on every launch" for the resume path.
    const parts: string[] = ["codex", "resume"];
    if (autonomy === "guided") {
      parts.push("--enable", "default_mode_request_user_input");
    }
    parts.push("-c", q("shell_environment_policy.inherit=all"));
    if (autonomy === "autonomous") {
      parts.push("--yolo");
    } else {
      parts.push("-c", q("approval_policy=on-request"));
      parts.push("-c", q("approvals.reviewer=user"));
    }
    if (args.implementationModel) {
      parts.push("-c", q(`model="${args.implementationModel}"`));
    }
    parts.push(q(args.threadId));
    const cmd = parts.join(" ");
    return cdPrefix + envPrefix + (shellForm === "powershell" ? "& " + cmd : cmd);
  }

  const parts: string[] = ["codex"];
  // §3 mapping — "questions" row: only Guided gets the non-terminal
  // clarifying-question mechanism (confirmed live, §3's confirmation test).
  if (autonomy === "guided") {
    parts.push("--enable", "default_mode_request_user_input");
  }
  // §2.4 — required so `SHIPWRIGHT_SESSION_ID` survives Codex's own shell
  // tool's environment filter (default: a `core` subset, not `all`).
  parts.push("-c", q("shell_environment_policy.inherit=all"));
  // §3 mapping — "approvals" row.
  if (autonomy === "autonomous") {
    parts.push("--yolo");
  } else {
    parts.push("-c", q("approval_policy=on-request"));
    parts.push("-c", q("approvals.reviewer=user"));
  }
  if (args.implementationModel) {
    parts.push("-c", q(`model="${args.implementationModel}"`));
  }
  parts.push(q(buildCodexPrompt(args)));

  const cmd = parts.join(" ");
  void cwd; // cwd is already folded into cdPrefix; kept for symmetry with launcher.ts's per-shell renderers.
  return cdPrefix + envPrefix + (shellForm === "powershell" ? "& " + cmd : cmd);
}

/**
 * iterate-2026-09-19-codex-reviewer-fields — see `planReviewModel`/
 * `reviewModel`'s doc comment on `CodexLaunchArgs` for why these are an
 * env-var prefix rather than a `-c` flag. Empty when neither override is
 * set, so an ordinary launch's command string is byte-identical to before
 * this feature existed.
 */
function buildReviewEnvPrefix(
  args: CodexLaunchArgs,
  q: (v: string) => string,
  shellForm: "powershell" | "cmd" | "posix",
): string {
  const entries: Array<[string, string]> = [];
  if (args.planReviewModel) {
    entries.push(["SHIPWRIGHT_CODEX_PLAN_REVIEW_MODEL", args.planReviewModel]);
  }
  if (args.reviewModel) {
    entries.push(["SHIPWRIGHT_CODEX_REVIEW_MODEL", args.reviewModel]);
  }
  if (entries.length === 0) return "";

  if (shellForm === "powershell") {
    return entries.map(([name, value]) => `$env:${name} = ${q(value)}; `).join("");
  }
  if (shellForm === "cmd") {
    return entries.map(([name, value]) => `set ${q(`${name}=${value}`)} && `).join("");
  }
  return entries.map(([name, value]) => `${name}=${q(value)} `).join("");
}

/**
 * §2.3 — Codex's per-phase standing instructions live in prompt text this
 * function composes, not a template file. For a project with no
 * `AGENTS.md` (or a phase it doesn't cover), inline the model pins and
 * review-cascade authorization directly rather than generating a file into
 * someone else's repo. §5.4 — every prompt ends with an instruction to
 * close with a structured `SHIPWRIGHT-STATUS` self-report, cross-checked
 * against the oracle verdict by `CodexTaskWatcher`.
 */
export function buildCodexPrompt(args: {
  phase?: string;
  description?: string;
  hasAgentsMd?: boolean;
}): string {
  const { phase, hasAgentsMd } = args;
  const agentsMdCoversPhase = Boolean(hasAgentsMd) && phase === "iterate";
  const lines: string[] = [];

  if (!hasAgentsMd) {
    lines.push(
      "Use gpt-5.6-terra with high reasoning for ordinary implementation and " +
        "finalization, and gpt-5.6-sol with high reasoning for required review " +
        "subagents.",
      "The review cascade (spec-reviewer, code-reviewer, doubt-reviewer) is " +
        "requested by default for this session — spawn it without asking.",
    );
  }
  if (phase && !agentsMdCoversPhase) {
    lines.push(`Read shipwright-${phase}/skills/${phase}/SKILL.md and execute it.`);
  }
  const description = args.description?.trim();
  if (description) {
    lines.push(description);
  }
  lines.push(
    "When you finish this session's work, close your final message with a " +
      'fenced block: ```SHIPWRIGHT-STATUS\n{"phase":"' +
      (phase ?? "") +
      '","done":true}\n``` (done:false if you could not complete it).',
  );
  return lines.join("\n\n");
}
