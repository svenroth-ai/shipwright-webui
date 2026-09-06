/*
 * external/launch/claim-executor-permissions.ts — FR-04.22 permission
 * perimeter, single source of truth (iterate-2026-09-06-claim-launch-
 * permission-perimeter).
 *
 * WHY THIS EXISTS: leadwright's stage-2 executor (`lib/lead-task-launch.ts`)
 * runs the command this repo hands back via a real shell, detached and
 * unref'd — that process outlives the daemon beat that started it and holds
 * a shell, git, and the machine's credentials. Until this change, that
 * command carried no `--permission-mode` and no tool allow-list: the
 * full-authority form. leadwright's own spec (§8) names a residual risk —
 * "a nested `claude` process with its own config writes out of P2" — that
 * PRESUPPOSES a perimeter is armed and merely bypassable by a nested
 * process. It was not armed at all; this module is that perimeter.
 *
 * THE MECHANISM, EMPIRICALLY VERIFIED against a real `claude` CLI 2.1.263
 * (iterate-2026-09-06, this run — not assumed from --help text alone),
 * exactly like leadwright verified its own beat-spawn mechanism
 * (`lib/lead-spawn.ts`, iterate-2026-08-30-lead-spawn-contract):
 *
 *   - `--allowed-tools` alone does NOT restrict anything — leadwright
 *     already proved this (5 permission modes probed, Bash executed every
 *     time) and this run did not re-litigate it.
 *   - `--tools <names>` (a comma-separated allow-list) DOES genuinely
 *     restrict the model's function set: a live probe with
 *     `--tools "Bash,Read,Edit,Write,Glob,Grep" --permission-mode dontAsk`
 *     produced a session whose own `init` event lists exactly
 *     `["Bash","Edit","Glob","Grep","Read","Write"]` — WebFetch/Task/
 *     WebSearch/NotebookEdit are structurally ABSENT from the model's tool
 *     set, not merely unapproved, so there is nothing to prompt for or
 *     bypass. A second probe naming ONLY `Read,Edit` (no Bash) produced a
 *     session that could not invoke Bash at all ("the Bash tool isn't
 *     available in this session" — never attempted, never refused, simply
 *     not offered).
 *   - Deliberately WITHOUT `--restricted`: unlike leadwright's beat (which
 *     never needs a shell), THIS executor's own legitimate job — running a
 *     `/shipwright-iterate` — needs git, npm and file writes, i.e. Bash.
 *     `--restricted`'s own `--help` text says it additionally ignores
 *     user/project/local settings files and unloads every marketplace
 *     plugin; a live probe confirmed this (`"plugins":[]` in the init event
 *     under `--restricted`, vs. the project's full plugin roster loaded
 *     normally under plain `--tools`). Shipwright's own hooks and plugins
 *     (CLAUDE.md rule 9: `--plugin-dir` must be re-passed every launch) are
 *     load-bearing for an iterate run, so `--restricted` would break the
 *     very job this executor exists to do — the card's own point (e).
 *     `--tools` alone, verified above, restricts the toolset just as
 *     genuinely without that collateral damage.
 *   - `--permission-mode dontAsk` (leadwright's own choice, re-verified
 *     here): a tool named in `--tools` runs with NO prompt and NO entry in
 *     `permission_denials`; nothing outside that list can be prompted for
 *     in the first place, since the model never sees it as a function.
 *     This resolves the specific worry the originating card names — "a run
 *     acquires tools through the interactive dialog and looks compliant
 *     anyway" — because there is no dialog to acquire anything through: the
 *     detached, `stdio:"ignore"` executor process has no terminal to show
 *     one on, and `dontAsk` never tries.
 *
 * WHAT THIS DOES NOT CLOSE (leadwright spec §8, still true): this is not OS
 * sandboxing. `Task` is deliberately excluded from the allow-list below —
 * matching leadwright's own Trap #4 finding that a nested `claude`/subagent
 * process writes past any perimeter the same way a shell would — but `Bash`
 * itself stays allowed (this executor's whole job needs it), and a `claude`
 * binary invoked directly as a shell command is not a tool call this
 * perimeter can see or stop. That is the residual risk leadwright's spec
 * already names; this module makes the REST of the surface (WebFetch,
 * Task-as-a-tool-call, an unbounded permission dialog) genuinely closed
 * instead of merely undocumented.
 */

/**
 * Exactly the toolset already granted to this codebase's own autonomous
 * build/iterate/test agents (`shipwright-build:section-builder`,
 * `shipwright-iterate:sub-iterate-runner`, `shipwright-test:test-runner` —
 * see their `.claude/agents` tool lists): Read, Write, Edit, Bash, Glob,
 * Grep. That precedent is the "considered allow-list" the originating card
 * asks for, not a guess — it is the toolset this project already trusts an
 * unattended agent doing iterate-shaped work with, on this same machine.
 * `Task` (nested subagent spawn) and network tools (`WebFetch`,
 * `WebSearch`) are deliberately excluded — none of those three agents
 * carry them either.
 */
export const CLAIM_EXECUTOR_ALLOWED_TOOLS: readonly string[] = [
  "Bash",
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
];

/**
 * Verified live (this module's own header comment): a tool named in
 * `CLAIM_EXECUTOR_ALLOWED_TOOLS` runs with no prompt under this mode, and
 * nothing outside that list is ever offered to prompt for. Matches
 * leadwright's own `spawnLeadBeat` default (`lib/lead-spawn-types.ts`).
 */
export const CLAIM_EXECUTOR_PERMISSION_MODE = "dontAsk";

export interface ClaimExecutorLaunchOverrides {
  toolsAllowlist: readonly string[];
  permissionMode: string;
}

/**
 * The single call site every claim-authorized launch branch reads its
 * perimeter from — one place a future operator changes what a claimed
 * executor may do, per the originating card's requirement (d).
 */
export function claimExecutorLaunchOverrides(): ClaimExecutorLaunchOverrides {
  return {
    toolsAllowlist: CLAIM_EXECUTOR_ALLOWED_TOOLS,
    permissionMode: CLAIM_EXECUTOR_PERMISSION_MODE,
  };
}
