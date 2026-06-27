/*
 * External-launch copy-command generator.
 *
 * Produces per-shell command strings for the user to paste. Webui does
 * NOT spawn claude; the user runs it themselves so that subscription-auth,
 * plugin-dir discovery, and terminal UX stay Anthropic's problem.
 *
 * Three forms are produced regardless of host OS so the UI can offer
 * the right button set. PoC check G proved all three run cleanly across
 * real PowerShell / cmd.exe / bash with a `"AI Backup - Documents"` path.
 *
 * Terminal / VSCode / Desktop launchers are explicitly deferred to v2+
 * (variant-a narrow scope). The `LaunchAdapter` shape is kept so Sub-iterate
 * 2 can plug implementations in without rewiring callers.
 */

export interface CopyCommandForms {
  powershell: string;
  cmd: string;
  posix: string;
}

export interface LaunchArgs {
  sessionUuid: string;
  cwd: string;
  resume?: boolean;
  fork?: boolean;
  parentSessionUuid?: string;
  pluginDirs?: string[];
  /**
   * Optional task title forwarded to Claude as `-n, --name <title>`.
   * Pre-seeds the session's display name (prompt box, /resume picker,
   * terminal title). Empty / omitted → no `--name` flag emitted (Claude
   * generates its own title).
   *
   * Embedded newlines are rejected with a thrown error — they break the
   * single-line copy-paste flow and can hide injected commands inside
   * the quoted string.
   */
  title?: string;
  /**
   * iterate/multi-session-run-orchestrator-v2 — Optional trailing slash
   * command (e.g. `/shipwright-build`). Emitted as a quoted positional
   * argument AFTER all flags, matching the framework's launch contract:
   *   claude --session-id <uuid> --add-dir <root> --name '...' '/shipwright-<phase>'
   *
   * Validated against SLASH_COMMAND_PATTERN at the route layer; the
   * launcher itself just escapes per shell. Newlines / control chars
   * are rejected here as defense-in-depth.
   */
  slashCommand?: string;
}

export interface LaunchResult {
  /** Always populated; the user's fallback. */
  commands: CopyCommandForms;
  /** Future: terminal spawn pid, VSCode binding token, etc. */
  launcherUsed: "copy";
}

export type LaunchAdapter = (args: LaunchArgs) => Promise<LaunchResult> | LaunchResult;

export function buildCopyCommands(args: LaunchArgs): CopyCommandForms {
  const parts = buildArgv(args);
  return {
    powershell: renderPowershell(parts),
    cmd: renderCmd(parts),
    posix: renderPosix(parts),
  };
}

/**
 * 2026-04-23 — iterate-20260423-resume-cwd-prefix.
 *
 * Shared shell-specific cd-prefix helper, used by both the legacy
 * `buildCopyCommands` path (Resume / Fork / plain Launch fallback) and
 * the `substitutePlaceholders` `{cd.prefix}` placeholder in
 * actions-substitute.ts. Both surfaces emit identical output so a user
 * pasting a Resume link and a user pasting a Launch link both set cwd
 * the same way before invoking claude.
 *
 * Per-shell expansion:
 *   PowerShell → `Set-Location <escaped> -ErrorAction Stop; ` (PS5 lacks
 *                `&&`; `-ErrorAction Stop` upgrades the otherwise
 *                non-terminating Set-Location error to a terminating one
 *                so a wrong path surfaces as a clean cd failure rather
 *                than a confusing missing-config error from the skill).
 *   cmd.exe    → `cd /d <escaped> && ` (`/d` also changes drive letter).
 *   POSIX      → `cd <escaped> && ` (standard short-circuit).
 *
 * Empty cwd → empty string. The pasted command degrades to current
 * behaviour (runs in whatever cwd the terminal had) instead of producing
 * a syntactically broken prefix.
 *
 * Security: uses the same `qPs/qCmd/qPosix` escapers as the rest of the
 * module. Trailing-backslash-before-quote caveat from `qCmd` (line 185)
 * still applies — directory-picker paths can't end on `\` in practice.
 */
export function buildCdPrefix(shellForm: "powershell" | "cmd" | "posix", cwd: string): string {
  if (!cwd) return "";
  if (shellForm === "powershell") {
    return `Set-Location ${qPs(cwd)} -ErrorAction Stop; `;
  }
  if (shellForm === "cmd") {
    return `cd /d ${qCmd(cwd)} && `;
  }
  return `cd ${qPosix(toPosixPath(cwd))} && `;
}

export const copyLauncher: LaunchAdapter = (args) => ({
  commands: buildCopyCommands(args),
  launcherUsed: "copy",
});

// ---------- internal ----------

interface Argv {
  sessionUuid: string;
  cwd: string;
  resume: boolean;
  fork: boolean;
  parentSessionUuid?: string;
  pluginDirs: string[];
  title?: string;
  slashCommand?: string;
}

function buildArgv(args: LaunchArgs): Argv {
  const title = normalizeTitle(args.title);
  const slashCommand = normalizeSlashCommand(args.slashCommand);
  return {
    sessionUuid: args.sessionUuid,
    cwd: args.cwd,
    resume: Boolean(args.resume),
    fork: Boolean(args.fork),
    parentSessionUuid: args.parentSessionUuid,
    pluginDirs: args.pluginDirs ?? [],
    title,
    slashCommand,
  };
}

/**
 * Trim outer whitespace and reject embedded newlines. Returns undefined
 * for empty / whitespace-only input so callers can skip emitting `--name`.
 */
function normalizeTitle(raw: string | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  if (/[\r\n]/.test(raw)) {
    throw new Error("Title cannot contain newlines (would break the single-line copy-paste flow).");
  }
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Reject newlines / NUL / other control chars in slash commands; the route
 * layer additionally validates against the strict
 * `^/shipwright-(project|design|plan|build|test|security|changelog|deploy)$`
 * regex. Belt-and-suspenders.
 */
function normalizeSlashCommand(raw: string | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  for (const ch of raw) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) {
      throw new Error("slashCommand cannot contain control characters.");
    }
  }
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

function renderPowershell(a: Argv): string {
  const parts: string[] = ["claude"];
  appendSessionFlags(a, parts, qPs);
  parts.push("--add-dir", qPs(a.cwd));
  appendResumeFork(a, parts, qPs);
  appendName(a, parts, qPs);
  for (const d of a.pluginDirs) {
    parts.push("--plugin-dir", qPs(d));
  }
  appendSlashCommand(a, parts, qPs);
  return buildCdPrefix("powershell", a.cwd) + "& " + parts.join(" ");
}

function renderCmd(a: Argv): string {
  const parts: string[] = ["claude"];
  appendSessionFlags(a, parts, qCmd);
  parts.push("--add-dir", qCmd(a.cwd));
  appendResumeFork(a, parts, qCmd);
  appendName(a, parts, qCmd);
  for (const d of a.pluginDirs) {
    parts.push("--plugin-dir", qCmd(d));
  }
  appendSlashCommand(a, parts, qCmd);
  return buildCdPrefix("cmd", a.cwd) + parts.join(" ");
}

function renderPosix(a: Argv): string {
  const cwd = toPosixPath(a.cwd);
  const plugins = a.pluginDirs.map(toPosixPath);
  const parts: string[] = ["claude"];
  appendSessionFlags(a, parts, qPosix);
  parts.push("--add-dir", qPosix(cwd));
  appendResumeFork(a, parts, qPosix);
  appendName(a, parts, qPosix);
  for (const d of plugins) {
    parts.push("--plugin-dir", qPosix(d));
  }
  appendSlashCommand(a, parts, qPosix);
  // Prefix uses raw cwd; buildCdPrefix does its own toPosixPath conversion.
  return buildCdPrefix("posix", a.cwd) + parts.join(" ");
}

/**
 * Emit `--session-id <uuid>` only when the launch needs to PRE-BIND a new
 * UUID — i.e. fresh starts and forks. The resume path identifies the
 * session via `--resume <uuid>`; combining `--session-id` with `--resume`
 * (without `--fork-session`) is rejected by Claude CLI 2.1.x with
 * "--session-id can only be used with --continue or --resume if
 * --fork-session is also specified."
 */
function appendSessionFlags(a: Argv, parts: string[], q: (v: string) => string): void {
  if (a.resume && !a.fork) return;
  parts.push("--session-id", q(a.sessionUuid));
}

function appendResumeFork(a: Argv, parts: string[], q: (v: string) => string): void {
  if (a.fork) {
    // fork-session starts a new session derived from a parent; requires a parent UUID.
    if (!a.parentSessionUuid) {
      throw new Error("fork=true requires parentSessionUuid");
    }
    parts.push("--resume", q(a.parentSessionUuid), "--fork-session");
  } else if (a.resume) {
    parts.push("--resume", q(a.sessionUuid));
  }
}

function appendName(a: Argv, parts: string[], q: (v: string) => string): void {
  if (a.title) parts.push("--name", q(a.title));
}

function appendSlashCommand(
  a: Argv,
  parts: string[],
  q: (v: string) => string,
): void {
  if (a.slashCommand) parts.push(q(a.slashCommand));
}

// --- shell-specific escaping ---
//
// Iterate 3 section 03 — exported (previously module-private) so
// `core/actions-substitute.ts` can call them per target shell before
// substituting user-derived placeholders into command templates. The
// shell-escape discipline is the security boundary for command-template
// substitution (plan.md § 2.2); do not move this logic behind a different
// abstraction without updating `actions-substitute.ts`.

export function qPs(v: string): string {
  // PS single-quoted: embedded `'` → `''`.
  return `'${v.replace(/'/g, "''")}'`;
}

export function qCmd(v: string): string {
  // cmd.exe double-quoted argument, escaped per CommandLineToArgvW (the prior
  // `"${v.replace(/"/g,'\\"')}"` left backslashes unescaped — CodeQL
  // js/incomplete-sanitization #4): N `\` before an embedded `"` → 2N+1 `\`+`"`;
  // N `\` before the CLOSING quote → 2N `\` (a trailing `\` can't escape it);
  // `\` not before a quote stays literal (`C:\foo` must not become `C:\\foo`).
  // Argv layer only; cmd.exe metachar handling is out of scope on this
  // loopback tool (inputs aren't cross-user-trust; `qPs` is the default shell).
  let out = '"';
  let pendingBackslashes = 0;
  for (const ch of v) {
    if (ch === "\\") {
      pendingBackslashes += 1;
      continue;
    }
    if (ch === '"') {
      out += "\\".repeat(pendingBackslashes * 2 + 1) + '"';
    } else {
      out += "\\".repeat(pendingBackslashes) + ch;
    }
    pendingBackslashes = 0;
  }
  out += "\\".repeat(pendingBackslashes * 2) + '"';
  return out;
}

export function qPosix(v: string): string {
  // POSIX single-quoted: `'` → `'\''`.
  return `'${v.replace(/'/g, "'\\''")}'`;
}

export function toPosixPath(p: string): string {
  return p.replace(/\\/g, "/");
}

