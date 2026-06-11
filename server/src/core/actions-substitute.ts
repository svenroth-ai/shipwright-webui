/*
 * Command-template placeholder substitution with per-shell escaping.
 *
 * Iterate 3 section 03 / plan.md § 2.2 — the SECURITY BOUNDARY for
 * command-template substitution. The placeholder allowlist is NOT the
 * security boundary on its own: it only guards template-shape
 * corruption. Actual protection against shell injection comes from the
 * per-shell escape discipline in this module (qPs / qCmd / qPosix,
 * re-exported from launcher.ts).
 *
 * Contract:
 *   substitutePlaceholders(template, ctx, shellForm) → string
 *     - Replaces every `{placeholder}` / `{placeholder?}` token with its
 *       shell-escaped substitution.
 *     - Unknown placeholder → throws InvalidPlaceholderError.
 *     - A task description spanning multiple lines is FLATTENED — each
 *       newline run collapses to a single space — so it survives as a
 *       single-line `claude` argument. The launch command must stay one
 *       physical line (copy-paste + embedded-terminal auto-execute both
 *       break on an embedded newline). A multi-line brief — common for
 *       triage-promoted tasks — is flattened, never rejected.
 *     - `{task.phase}` that does NOT match ctx.allowedPhaseIds → throws
 *       UnknownPhaseError.
 *     - Unsupported shell form → throws UnsupportedShellError.
 *
 * Optional-suffix semantics:
 *   `{task.description?}` / `{task.autonomy_flag?}` wrap in a ` \\\n    `
 *   leading continuation prefix when the value is non-empty, and emit
 *   the empty string when the value is absent. The prefix is part of
 *   the replacement, NOT of the template — this is how the three-form
 *   output stays byte-identical to the mockup.
 *
 * Security:
 *   User-derived placeholders (`{task.title}`, `{task.description?}`,
 *   `{task.phase_label}`, `{project.path}`) are always shell-escaped.
 *   Server-generated literals (`{task.uuid}`, `{project.id}`,
 *   `{task.phase}`) pass through unquoted — they are UUIDs or allowlist
 *   ids and safe as raw tokens.
 *
 *   `{plugin.dirs}` expands into a space-joined sequence of
 *   `--plugin-dir <escaped>` pairs.
 */

import { qPs, qCmd, qPosix, toPosixPath, buildCdPrefix } from "./launcher.js";
import type { ResolvedParam } from "../types/action-schema.js";

export type ShellForm = "powershell" | "cmd" | "posix";

export interface SubstitutionContext {
  project: {
    id: string;
    path: string;
  };
  task: {
    uuid: string;
    title: string;
    description?: string;
    phase: string;
    phase_label: string;
    autonomy?: "guided" | "autonomous";
    /**
     * Pre-resolved CLI parameters from the route handler. Empty array
     * and `undefined` are treated identically (no flags emitted).
     * The substituter trusts cli_flag has been validated against the
     * allowlist; values are still per-shell escaped here.
     */
    parameters?: ResolvedParam[];
  };
  pluginDirs: string[];
  /**
   * Allowlist of valid `{task.phase}` ids. Validated against the
   * resolved `actions.phases[].id` set by the caller (route handler).
   * When provided, substitutePlaceholders throws UnknownPhaseError on
   * a mismatch.
   */
  allowedPhaseIds: Set<string>;
  /**
   * The action id being substituted — used only for error reporting
   * (so InvalidPlaceholderError can surface actionId alongside the
   * offending placeholder).
   */
  actionId: string;
  /**
   * iterate-2026-06-11-custom-action-slash-command — a CUSTOM action's declared
   * slash command (action-schema `slash_command`, e.g. `/content-orchestrator`).
   * Lets `{task.initial_prompt}` fuse slash + description into ONE positional
   * for non-builtin ids. Ignored for builtins; absent/malformed → UnknownActionError.
   */
  slashCommand?: string;
}

export class InvalidPlaceholderError extends Error {
  readonly placeholder: string;
  readonly actionId: string;
  readonly template: string;
  constructor(placeholder: string, actionId: string, template: string) {
    super(
      `Unknown placeholder {${placeholder}} in action "${actionId}" template`,
    );
    this.name = "InvalidPlaceholderError";
    this.placeholder = placeholder;
    this.actionId = actionId;
    this.template = template;
  }
}

export class InvalidTitleError extends Error {
  constructor() {
    super(
      "task.title cannot contain newlines (breaks single-line copy-paste)",
    );
    this.name = "InvalidTitleError";
  }
}

export class InvalidParameterError extends Error {
  readonly cli_flag: string;
  constructor(cli_flag: string, reason: string) {
    super(`Invalid parameter value for ${cli_flag}: ${reason}`);
    this.name = "InvalidParameterError";
    this.cli_flag = cli_flag;
  }
}

export class UnknownActionError extends Error {
  readonly actionId: string;
  constructor(actionId: string) {
    super(
      `Action id "${actionId}" is not one of the bundled actions ("new-task", "new-iterate", "new-pipeline") and has no valid "slash_command". A custom action whose command_template uses {task.initial_prompt} must declare a "slash_command" matching ${SLASH_COMMAND_PATTERN.source} (e.g. "/content-orchestrator"). Alternatively, use the {task.description?} placeholder instead of {task.initial_prompt}.`,
    );
    this.name = "UnknownActionError";
    this.actionId = actionId;
  }
}

export class UnknownPhaseError extends Error {
  readonly phase: string;
  constructor(phase: string) {
    super(`Unknown phase id "${phase}" — not in actions.phases[].id allowlist`);
    this.name = "UnknownPhaseError";
    this.phase = phase;
  }
}

export class UnsupportedShellError extends Error {
  readonly shellForm: string;
  constructor(shellForm: string) {
    super(`Unsupported shell form: ${shellForm}`);
    this.name = "UnsupportedShellError";
    this.shellForm = shellForm;
  }
}

/**
 * Canonical placeholder names. Anything not on this list is rejected.
 * The allowlist is NOT a security boundary — it prevents typos and
 * template-shape corruption. The real security guard is the escaping
 * discipline below.
 */
const ALLOWED_PLACEHOLDERS = new Set([
  "project.id",
  "project.path",
  "task.uuid",
  "task.title",
  "task.session_name",
  "task.description?",
  "task.phase",
  "task.phase_label",
  "task.autonomy_flag?",
  "task.parameters?",
  "task.initial_prompt",
  "plugin.dirs",
  "cd.prefix",
]);

/**
 * iterate/fix-adopt-prompt-shape § 1 — slash-command shapes per bundled
 * actionId. The substituter's {task.initial_prompt} branch dispatches on
 * ctx.actionId. Custom actions outside this set must NOT use the
 * placeholder (UnknownActionError).
 *
 * iterate-2026-05-21-triage-fix-now-and-phase-slash — workaround for
 * Claude Code skill resolution: four bundled slash commands fail to
 * resolve in the bare `/shipwright-<plugin>` form and must be emitted
 * as the explicit `<plugin>:<skill>` namespaced form. The four flagged
 * empirically (Sven 2026-05-21):
 *   - `/shipwright-plan`     → `/shipwright-plan:plan`
 *   - `/shipwright-test`     → `/shipwright-test:test`
 *   - `/shipwright-security` → `/shipwright-security:security`
 *   - `/shipwright-run`      → `/shipwright-run:run`
 * Every other phase (`build`, `design`, `deploy`, `changelog`, `compliance`,
 * `adopt`, `project`) AND `/shipwright-iterate` work in the bare form, so
 * the workaround is intentionally narrow. If more phases break the same
 * way in future, add them to `NAMESPACED_PHASES`.
 *
 * This belongs in webui because Claude Code skill registration is owned
 * upstream; aligning the plugin names there has been attempted multiple
 * times without success. Treat as a local compatibility shim.
 */
const NAMESPACED_PHASES = new Set(["plan", "test", "security"]);

// iterate-2026-06-11-custom-action-slash-command — the three bundled action
// ids whose slash command is hardcoded in `buildSlashCommand`. Any OTHER id is
// "custom" and supplies its slash via the action-schema `slash_command` field
// (SubstitutionContext.slashCommand). Builtins always win. SSoT for the
// validator's "which actions require slash_command" decision.
export const BUILTIN_INITIAL_PROMPT_ACTIONS: ReadonlySet<string> = new Set([
  "new-task",
  "new-iterate",
  "new-pipeline",
]);

// Allowlist for a custom action's `slash_command` (leading-slash skill token,
// e.g. `/content-orchestrator`). Still q()-escaped at substitution time; this
// pattern rejects garbage at load and is reused by `validateActionsSchema`.
export const SLASH_COMMAND_PATTERN = /^\/[A-Za-z][A-Za-z0-9:_-]*$/;

function buildSlashCommand(
  actionId: string,
  phase: string,
  slashCommand?: string,
): string | null {
  if (actionId === "new-task") {
    return NAMESPACED_PHASES.has(phase)
      ? `/shipwright-${phase}:${phase}`
      : `/shipwright-${phase}`;
  }
  if (actionId === "new-iterate") return `/shipwright-iterate`;
  if (actionId === "new-pipeline") return `/shipwright-run:run`;
  // Custom (non-builtin) action: fall back to the declared slash_command when
  // present + well-formed; else null → UnknownActionError (fail-loud backstop;
  // the schema validator catches missing/invalid earlier). Trim so a padded
  // value (" /content-orchestrator ") matches the validator (which also trims).
  const sc = slashCommand?.trim();
  if (sc && SLASH_COMMAND_PATTERN.test(sc)) {
    return sc;
  }
  return null;
}

/**
 * iterate/fix-adopt-prompt-shape § 1 — render a single ResolvedParam
 * RAW (no shell escape) for use INSIDE {task.initial_prompt}. The outer
 * `q()` wraps the entire prompt and handles all per-shell escaping in one
 * place; nested escaping would corrupt the result.
 */
function formatParameterRaw(p: ResolvedParam): string {
  if (p.value === undefined) return ` ${p.cli_flag}`;
  if (p.separator === "equals") return ` ${p.cli_flag}=${p.value}`;
  if (p.separator === "none") return ` ${p.cli_flag}${p.value}`;
  return ` ${p.cli_flag} ${p.value}`;
}

function pickEscaper(shellForm: ShellForm): (v: string) => string {
  if (shellForm === "powershell") return qPs;
  if (shellForm === "cmd") return qCmd;
  if (shellForm === "posix") return qPosix;
  throw new UnsupportedShellError(shellForm);
}

/**
 * Flatten a task description into a single physical line: every newline
 * run (LF / CR / CRLF), together with any spaces or tabs hugging it,
 * collapses to one space, and outer whitespace is trimmed. The launch
 * command must stay one line — copy-paste and the embedded-terminal
 * auto-execute (which sends `command + "\r"`) both treat an embedded
 * newline as a premature Enter. Multi-line briefs (typical for
 * triage-promoted tasks) are flattened here rather than rejected, so
 * every action's description placeholder is launch-safe. Returns "" for
 * undefined / whitespace-only input.
 */
function flattenDescription(raw: string | undefined): string {
  if (!raw) return "";
  return raw.replace(/[ \t]*[\r\n]+[ \t]*/g, " ").trim();
}

/**
 * Render a single ResolvedParam to its shell-token form. Always begins
 * with a leading space so the join() in the `task.parameters?` branch
 * stays clean — adjacent placeholders like `{plugin.dirs}{task.parameters?}`
 * collapse correctly via the post-substitute whitespace pass.
 *
 * Format per separator:
 *   none  + no value           → ` <flag>`            (boolean)
 *   space + value              → ` <flag> <q(value)>` (most flags)
 *   equals + value             → ` <flag>=<q(value)>` (q wraps the VALUE only)
 *   none  + value              → ` <flag><q(value)>`  (positional `@<file>`)
 *
 * Pre-flight throws InvalidParameterError on \n / \r in the value to
 * preserve the single-line copy-paste invariant (analog to
 * task.description? handling).
 */
function formatParameter(
  p: ResolvedParam,
  q: (v: string) => string,
): string {
  const value = p.value;
  if (value !== undefined && /[\r\n]/.test(value)) {
    throw new InvalidParameterError(p.cli_flag, "value cannot contain newlines");
  }

  if (value === undefined) {
    // Boolean / valueless flag.
    return ` ${p.cli_flag}`;
  }

  const escaped = q(value);
  if (p.separator === "equals") return ` ${p.cli_flag}=${escaped}`;
  if (p.separator === "none") return ` ${p.cli_flag}${escaped}`;
  // Default and "space".
  return ` ${p.cli_flag} ${escaped}`;
}

function transformPath(shellForm: ShellForm, p: string): string {
  // POSIX form converts Windows separators to forward slashes (matches
  // launcher.ts behaviour). The other two forms pass paths through as-is.
  return shellForm === "posix" ? toPosixPath(p) : p;
}

/**
 * Build the substitution for a single placeholder key. Returns the
 * replacement string (may be empty when the `?` suffix is absent).
 * Callers are responsible for validating the placeholder exists in
 * ALLOWED_PLACEHOLDERS first.
 */
function substituteOne(
  key: string,
  ctx: SubstitutionContext,
  shellForm: ShellForm,
): string {
  const q = pickEscaper(shellForm);

  switch (key) {
    case "project.id":
      return ctx.project.id;
    case "project.path":
      return q(transformPath(shellForm, ctx.project.path));
    case "task.uuid":
      return ctx.task.uuid;
    case "task.title":
      return q(ctx.task.title);
    case "task.session_name": {
      // iterate-2026-05-19-fix-launch-name-quoting — composes the Claude
      // session display name (the `--name` value) and shell-escapes it
      // ONCE. Templates MUST use bare `--name {task.session_name}`, never
      // `--name "{task.session_name}"`: the result is already a single
      // shell-quoted token. The previous bundled templates wrapped a
      // q()-escaped `{task.title}` in literal double-quotes, so Claude
      // received a name with stray inner quotes (`--name "'My Task'"`).
      //
      // Per-action prefix mirrors the historical bundled names; the
      // three bundled actionId strings below are a contract with
      // default-actions.json. Unlike {task.initial_prompt} (which throws
      // UnknownActionError for non-bundled actions — a slash command is
      // bundled-mode-only), a session NAME is meaningful for every
      // action, so a non-bundled / custom actionId deliberately falls
      // back to the bare title rather than throwing.
      const title = ctx.task.title;
      let composed: string;
      if (ctx.actionId === "new-pipeline") {
        composed = `Pipeline: ${title}`;
      } else if (ctx.actionId === "new-iterate") {
        composed = `Iterate: ${title}`;
      } else if (ctx.actionId === "new-task") {
        const label = ctx.task.phase_label.trim();
        composed = label ? `${label}: ${title}` : title;
      } else {
        composed = title;
      }
      return q(composed);
    }
    case "task.phase":
      if (!ctx.allowedPhaseIds.has(ctx.task.phase)) {
        throw new UnknownPhaseError(ctx.task.phase);
      }
      return ctx.task.phase;
    case "task.phase_label":
      return q(ctx.task.phase_label);
    case "task.description?": {
      // Multi-line briefs are flattened to one line (see flattenDescription)
      // rather than rejected — the launch command must stay single-line.
      const d = flattenDescription(ctx.task.description);
      if (!d) return "";
      // ` \\\n    ` leading continuation prefix — the optional-suffix
      // semantics covered in the header comment.
      return ` \\\n    ${q(d)}`;
    }
    case "task.autonomy_flag?": {
      if (ctx.task.autonomy === "autonomous") {
        return ` \\\n    --autonomous`;
      }
      return "";
    }
    case "task.parameters?": {
      const params = ctx.task.parameters;
      if (!params || params.length === 0) return "";
      return params.map((p) => formatParameter(p, q)).join("");
    }
    case "task.initial_prompt": {
      // iterate/fix-adopt-prompt-shape § 1 — build slash + autonomy +
      // params + description as ONE raw inner string, then shell-quote
      // the whole thing as a single argument. Skill flags belong INSIDE
      // this quoted prompt (Claude treats it as the user's first
      // message in interactive mode), not as Claude CLI flags.
      //
      // Phase validation: new-task uses {ctx.task.phase} in the slash;
      // an unknown phase would silently emit /shipwright-<garbage>. The
      // legacy `task.phase` placeholder branch already throws
      // UnknownPhaseError; we re-do the check here because the new
      // placeholder bypasses that branch entirely.
      if (
        ctx.actionId === "new-task" &&
        ctx.task.phase &&
        !ctx.allowedPhaseIds.has(ctx.task.phase)
      ) {
        throw new UnknownPhaseError(ctx.task.phase);
      }
      const slash = buildSlashCommand(
        ctx.actionId,
        ctx.task.phase,
        ctx.slashCommand,
      );
      if (!slash) {
        throw new UnknownActionError(ctx.actionId);
      }
      let inner = slash;
      if (ctx.task.autonomy === "autonomous") {
        inner += " --autonomous";
      }
      if (ctx.task.parameters && ctx.task.parameters.length > 0) {
        for (const p of ctx.task.parameters) {
          inner += formatParameterRaw(p);
        }
      }
      // Flattened to one line — see flattenDescription. The whole prompt
      // is shell-quoted once by q() below, so a multi-line brief must
      // already be single-line here or the quoted argument would break
      // the single-line launch-command invariant.
      const desc = flattenDescription(ctx.task.description);
      if (desc) {
        inner += ` ${desc}`;
      }
      return q(inner);
    }
    case "plugin.dirs": {
      const dirs = ctx.pluginDirs;
      if (!dirs || dirs.length === 0) return "";
      return dirs
        .map((d) => `--plugin-dir ${q(transformPath(shellForm, d))}`)
        .join(" ");
    }
    case "cd.prefix": {
      // 2026-04-23 — iterate-20260423-launch-cwd-prefix.
      //
      // `--add-dir <path>` only grants Claude tool-access to that
      // directory; it does NOT change the shell's working directory.
      // When the user pastes the copy command in a terminal parked in
      // $HOME, the skill runs with `pwd === $HOME`, fails to find
      // shipwright_run_config.json, and exits immediately. The cd.prefix
      // placeholder expands to a shell-specific `cd` command + separator
      // so the slash command runs with the project as cwd regardless of
      // where the terminal happened to be.
      //
      // Form per shell:
      //   PowerShell — `Set-Location <escaped> -ErrorAction Stop; `
      //                (PS5 lacks `&&`; `-ErrorAction Stop` upgrades the
      //                otherwise non-terminating `Set-Location` error to a
      //                terminating one so the user sees the actual cd
      //                failure rather than a confusing missing-config
      //                error from the skill)
      //   cmd.exe    — `cd /d <escaped> && ` (`/d` flag is required to
      //                also change drive letter on Windows)
      //   POSIX      — `cd <escaped> && ` (standard short-circuit)
      //
      // Empty project.path → empty string. The pasted command degrades
      // to current behavior (runs in whatever cwd the terminal had);
      // surfacing the empty-path case as a UI/server error is out of
      // scope for this iterate.
      //
      // Security: the same `qPs/qCmd/qPosix` escapers used for
      // `{project.path}` are reused here. The `qCmd` trailing-backslash
      // assumption (launcher.ts:185-189) still applies — directory-picker
      // paths cannot end on `\` in practice, so the assumption holds.
      // `cd.prefix` is the first place a server-trusted path gets
      // injected at the START of the command line, which widens the blast
      // radius if that assumption ever breaks.
      //
      // 2026-04-23 — iterate-20260423-resume-cwd-prefix extracted the
      // shell-specific formatting into `buildCdPrefix` in launcher.ts so
      // the legacy `buildCopyCommands` (Resume / Fork) path emits
      // byte-identical prefixes. `buildCdPrefix` already handles empty
      // cwd and the POSIX `toPosixPath` transform internally.
      return buildCdPrefix(shellForm, ctx.project.path);
    }
    default:
      // This branch is unreachable when callers pre-validate via
      // ALLOWED_PLACEHOLDERS; guarded here so a misuse fails loudly.
      throw new InvalidPlaceholderError(key, ctx.actionId, "");
  }
}

/**
 * Substitute placeholders in `template` for a given shell form. Throws
 * on unknown placeholders, title newlines, parameter newlines, unknown
 * phase ids, and unsupported shell forms. A multi-line task description
 * is flattened (not rejected) — see flattenDescription.
 */
export function substitutePlaceholders(
  template: string,
  ctx: SubstitutionContext,
  shellForm: ShellForm,
): string {
  // Validate shell form up front so a template with no placeholders
  // still rejects "fish".
  pickEscaper(shellForm);

  // Note: a multi-line `ctx.task.description` is NOT rejected — the
  // description placeholder branches flatten it via flattenDescription.

  // Pre-flight reject of title newlines (analog to parameters below).
  // iterate-2026-05-19-fix-launch-name-quoting — the title feeds
  // {task.title} and {task.session_name} (the `--name` value); an
  // interior newline would break the single-line copy-paste / WS
  // auto-execute invariant. The PATCH /tasks handler already rejects
  // title newlines; the create route only trims — so the substituter
  // is the fail-closed backstop on the launch path.
  if (/[\r\n]/.test(ctx.task.title)) {
    throw new InvalidTitleError();
  }

  // Pre-flight reject of parameter newlines (analog to description). The
  // route layer should have caught these already, but this makes the
  // substituter fail-safe regardless of upstream discipline.
  if (ctx.task.parameters) {
    for (const p of ctx.task.parameters) {
      if (p.value !== undefined && /[\r\n]/.test(p.value)) {
        throw new InvalidParameterError(
          p.cli_flag,
          "value cannot contain newlines",
        );
      }
    }
  }

  // Regex matches `{anything-up-to-closing-brace}` with no nesting. The
  // `?` is part of the placeholder key for optional tokens.
  const substituted = template.replace(/\{([^}]+)\}/g, (_match, rawKey: string) => {
    const key = rawKey.trim();
    if (!ALLOWED_PLACEHOLDERS.has(key)) {
      throw new InvalidPlaceholderError(key, ctx.actionId, template);
    }
    return substituteOne(key, ctx, shellForm);
  });

  // 2026-04-23 — iterate-20260423-shell-line-continuations.
  //
  // The bundled command_template AND the optional-suffix renderers emit
  // POSIX `\<newline>    ` continuations for readability. Those are ONLY
  // valid in POSIX shells — PowerShell and cmd.exe treat the backslash as
  // a literal token, drop everything after the newline, and the user ends
  // up pasting just `claude /shipwright-<phase>` with a stray `\`. The
  // safest cross-shell form is a single line (every shell parses a long
  // one-line command identically). We therefore collapse every
  // `<ws>\<newline><ws>` sequence to a single space AFTER substitution.
  // Trailing whitespace is trimmed so an empty optional suffix at the
  // end of the template doesn't leave a dangling blank.
  return substituted.replace(/[ \t]*\\\r?\n[ \t]*/g, " ").replace(/[ \t]+$/, "");
}

/**
 * Parallel evaluation across all three shell forms. Useful for the
 * launch route which returns `{powershell, cmd, posix}` to the client.
 * Each form is evaluated independently so an escape-drift bug in one
 * can't corrupt the others.
 */
export function substituteAllForms(
  template: string,
  ctx: SubstitutionContext,
): { powershell: string; cmd: string; posix: string } {
  return {
    powershell: substitutePlaceholders(template, ctx, "powershell"),
    cmd: substitutePlaceholders(template, ctx, "cmd"),
    posix: substitutePlaceholders(template, ctx, "posix"),
  };
}

/**
 * Convenience wrapper: the route layer's single entry point for producing
 * the 3 shell forms from a command template + context. Delegates directly
 * to substituteAllForms but reads better at the call site.
 */
export function buildExternalLaunchCommand(args: {
  template: string;
  ctx: SubstitutionContext;
}): { powershell: string; cmd: string; posix: string } {
  return substituteAllForms(args.template, args.ctx);
}

/**
 * Dry-run validator used by the actions route to verify every
 * `command_template` is substitution-safe at load time. Constructs a
 * synthetic context with representative values and re-runs all three
 * shell forms. Returns the first error encountered, or null on success.
 *
 * Does NOT raise UnknownPhaseError — the validator's job is to catch
 * placeholder typos and shape corruption, not to fail-close when a
 * phase allowlist is empty (e.g. during initial setup). The actual
 * phase check runs at launch time with the real task state.
 */
export function validateTemplate(
  template: string,
  actionId: string,
  phaseIds: string[],
  slashCommand?: string,
): InvalidPlaceholderError | null {
  const ctx: SubstitutionContext = {
    project: { id: "dry-run-project", path: "/tmp/dry-run" },
    task: {
      uuid: "00000000-0000-0000-0000-000000000000",
      title: "dry run",
      phase: phaseIds[0] ?? "dry-run-phase",
      phase_label: "Dry Run",
      // Synthetic parameters so {task.parameters?} doesn't render as a
      // no-op during validation — exercises the substituter branch.
      parameters: [
        { cli_flag: "--dry-flag", value: "x", separator: "space" },
      ],
    },
    pluginDirs: [],
    allowedPhaseIds: new Set([...phaseIds, "dry-run-phase"]),
    actionId,
    // Pass slash_command so a custom {task.initial_prompt} template dry-runs
    // without throwing UnknownActionError (a GET /actions 500). Builtins ignore it.
    slashCommand,
  };
  try {
    substituteAllForms(template, ctx);
    return null;
  } catch (err) {
    if (err instanceof InvalidPlaceholderError) return err;
    // Other error classes (UnsupportedShellError, UnknownPhaseError,
    // InvalidTitleError) do not apply to the dry-run context because we
    // supply clean values.
    throw err;
  }
}
