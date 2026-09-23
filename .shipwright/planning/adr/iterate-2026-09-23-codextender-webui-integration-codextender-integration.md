# Codextender integration mode for Codex-runtime tasks

## Context

Codex Light (a prior iterate) added Codex CLI as an alternate task runtime.
Some users don't run the real `codex` CLI at all — they run "Codextender", a
local LiteLLM proxy that lets an ordinary `claude` process draw on a
Codex-plan subscription. WebUI needed to support that path through the same
task model and the same New Iterate/model-tier UI, without conflating it
with Codex Light or requiring webui to spawn anything itself (CLAUDE.md
architecture rule 1 is unconditional).

## Decision

Added a global `codexIntegrationMode: "light" | "codextender"` setting,
orthogonal to `task.runtime`. A Codextender-mode Codex-runtime task's
launch/fork reuses the already-built plain-Claude `CopyCommandForms` and
prepends an env-var block (`ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`/
`ANTHROPIC_MODEL`/`CODEXTENDER_ACTIVE`/`CODEXTENDER_MODEL`) pointed at the
local proxy (`core/launcher-codextender.ts`), instead of building a
`codex ...` command. Availability is gated by a new liveness probe
(`GET /health/liveliness`, no auth) in `runtime-chokepoint.ts`'s
`checkCodextenderProxyAvailable`, kept separate from the model-catalog probe
(`GET /v1/models`, which the proxy requires `Authorization: Bearer <token>`
for). AC7/AC9's Codex Light campaign/new-pipeline blocks are bypassed for
Codextender mode, since it drives ordinary `claude` and has the same
pipeline/resume machinery a Claude-runtime task does. The client's
`ModelTierOverrideFields`/`CodexModelOverrideFields` gained an
`isCodextender` branch: Codextender-only placeholders, a
`GET /api/codextender-models` catalog hook, and a static `sol`/`astra`
fallback when the proxy is unreachable (Codex Light's own empty-list
behavior is unchanged).

## Consequences

- New global setting surface (`Settings → Codex` gains an integration-mode
  select + a Codextender-port input), new read surface (the two proxy
  endpoints), new route (`GET /api/codextender-models`).
- `fork.ts` cannot call the shared chokepoint (pre-existing constraint,
  §2.1), so its own Codextender branch duplicates the mode check and reuses
  the same error-message builders via a new shared
  `runtime-chokepoint-errors.ts` file.
- A `CodextenderCwdMismatchError` is now a real, user-facing 500
  (`codextender_cwd_mismatch`) rather than a silent double-`cd`-prefix, for
  the case where a custom action's commands were built from `project.path`
  instead of `task.cwd` (see Rejected alternatives).

## Rationale

Reusing the plain-Claude `CopyCommandForms` (rather than building a fresh
Codextender-specific command from scratch) keeps every existing Claude
launch/resume/fork code path as the single source of truth for the actual
`claude` invocation shape; Codextender only ever adds an env-var prefix in
front of it. Splitting the liveness probe from the model-catalog probe
follows directly from the proxy's own two different auth requirements
(verified live against a running Codextender instance during this run's
spec-review round) — collapsing them into one probe would have made the
AC8-equivalent preflight either always fail (if it required auth) or the
model catalog always 500 (if it didn't).

## Rejected alternatives

1. **Silently fall back to prepending the env-var block when the `cd`-prefix
   doesn't match `cwd`** (the original implementation) — rejected after
   Stage-3 doubt review: this produces an ambiguous, double-`cd`-prefixed
   command with no error, which can launch in the wrong directory
   undetected. Replaced with a typed `CodextenderCwdMismatchError` and a
   fail-loud 500.
2. **A single combined proxy-availability probe reused for both AC8
   preflight and model catalog** — rejected by the spec-reviewer's first
   round (Stage-1 hard-gate REJECT): the two endpoints have different real
   auth requirements, and this shape reads as passing spec review only by
   accident of which endpoint happened to be probed.
3. **Reading `codexIntegrationMode` from an independent `useSettings()` call
   inside `ModelTierOverrideFields`** — rejected by code review in favor of
   threading it down as a prop from the same `form.codexIntegrationMode`
   value its sibling `RuntimeFieldFragment` already receives, avoiding a
   second settings read for the same value.
4. **Leaving the `codexRuntimeDefault` -> `runtimeDefault` rename
   (`server`/`client`'s `types/settings.ts`) with no back-compat path** —
   rejected by the F11 local PR-review preflight (Tier-3, same gate as the
   required CI check): a pre-existing `settings.json` written before the
   rename would silently lose its configured default (the parsed value sits
   under a key nothing reads anymore) rather than erroring. Fixed with a
   read-side-only `migrateLegacyRuntimeDefault()` (`core/settings-reader.ts`,
   reused by `routes/settings.ts` GET and PUT's read-merge-write) — a plain
   PUT with the new field name completes the migration on disk on next save.
5. **Leaving `ANTHROPIC_AUTH_TOKEN`/the probe's `Authorization` header as an
   unconditional hardcoded constant** (`CODEXTENDER_AUTH_TOKEN_PLACEHOLDER`,
   the documented `codextender` README example) — rejected by the same
   preflight, in TWO rounds. Round 1 kept the constant as a fallback default
   behind a `process.env.CODEXTENDER_AUTH_TOKEN` override; re-run, the
   preflight blocked again — an externally-contributed change that hardcodes
   a bearer-shaped string AND suppresses the secret scanner for it reads as
   unsafe regardless of the value's actual local-only nature or whether it
   is reachable as a fallback. Round 2: `resolveCodextenderAuthToken()` has
   NO built-in fallback at all — it reads `CODEXTENDER_AUTH_TOKEN` from the
   environment only and returns `undefined` when unset/blank.
   `buildCodextenderCommands`'s `authToken` became a required field (a
   caller that skips resolving it is a compile error, not a silent empty/
   placeholder token); `probeCodextenderModels` degrades to `{ok: false}`
   without calling `fetch` at all when unconfigured; the launch chokepoint
   and the fork route both gained a preflight (`getCodextenderAuthToken()`)
   returning a new `codextender_auth_token_missing` 400
   (`runtime-chokepoint-errors.ts`) before either would otherwise build a
   command. The `.gitleaks.toml` entry for the placeholder string was
   removed — it no longer appears in source at all.
6. **Leaving `useEditTaskForm.ts`'s `runtime` state seeded only on the `open`
   false-to-true edge** — a third preflight round found this pre-existing
   race (unrelated to the Codextender feature itself, but reachable through
   the same `runtimeAvailability` gating this iterate widened): `useSettings()`
   can resolve, or `codexAvailability` can change, while the modal is already
   open, and the fixed pill would then show the forced runtime while the
   submitted patch still held the task's stale one. Fixed by mirroring
   `useNewIssueFormState.ts`'s 2026-09-16 fix for the create forms: a
   `runtimeTouchedRef` guarding a re-seed effect keyed on
   `[open, neverStarted, runtimeAvailability]`, so a user's own interactive
   pick (only reachable under `availability === "both"`) is never clobbered.
   The same round also flagged (non-blocking comment)
   `CodexSettingsCard.tsx`'s port input accepting fractional/out-of-range
   values; fixed by validating `Number.isInteger` plus the 1-65535 TCP range
   in `changePort` before it saves.
7. **Leaving the `codextender-models` route's TTL cache/failure state keyed
   globally rather than per-port, and defaulting the settings' `runtimeDefault`
   only implicitly (via client-side `?? "claude"` fallbacks) rather than in
   `DEFAULT_GLOBAL_SETTINGS`/`DEFAULT_SETTINGS` themselves** — a fourth
   preflight round BLOCKED on both. (a) Changing `codextenderPort` in
   Settings kept serving the previous proxy's model catalog for up to the
   5-minute `ttlMs`/30-second `failureTtlMs` windows, because `cache`/
   `lastFailureAt` carried no memory of which port produced them. Fixed by
   resolving `getPort()` once per request (moved out of the lazy `inflight`
   closure) and scoping `cache`/`lastFailure`/`inflight` to `{port, ...}`, so
   a port change is treated as a cold miss even mid-TTL. (b) A fresh install
   (no `settings.json` yet) returned a payload with no `runtimeDefault` key
   at all rather than the explicit renamed default; fixed by adding
   `runtimeDefault: "claude"` to both default-settings constants — a
   behavior-preserving change (every consumer already treated a missing
   value as `"claude"`), made explicit so the rename reads as complete at
   the settings surface itself, not just in the migration shim.
8. **Trusting `codextenderPort` as an already-safe `number` everywhere it's
   used** — a fifth preflight round BLOCKED: the value flows from
   unvalidated JSON (a PUT body, or a hand-edited `settings.json`) through
   to `http://127.0.0.1:${port}/...` template interpolation, so a crafted
   value like `"4000@attacker.example"` changes the URL's authority via
   userinfo confusion, redirecting the server-side request off localhost —
   an SSRF-shaped risk introduced by this iterate's new network boundary.
   Fixed with `isValidCodextenderPort()` (`core/codextender-proxy-probe.ts`,
   integer 1-65535) enforced at BOTH ends: the two probes reject an invalid
   port before ever building a URL (the actual point of use — defends even
   a value that reached disk some other way), and `PUT /api/settings` now
   rejects a present-but-invalid `codextenderPort` with
   `400 invalid_codextender_port` before it's ever merged/persisted.

9. **Leaving `authToken` as a literal value in the generated command** — the
   F11 local PR-review preflight BLOCKED twice on this (round 7: the token
   is visible in terminal input/scrollback even after round 7's own
   env-cleanup fix; round 8, after an initial disclose-rather-than-fix
   write-up: rejected outright — "the implementation explicitly acknowledges
   the exposure without mitigating it"). A hidden pty-environment write was
   considered and rejected (conflicts with CLAUDE.md rule 19 — auto-execute
   must be built exclusively as a copyable command string, never a
   server-side `pty.write`). Fixed instead with a private, per-launch temp
   file (`0o600`, random name, `os.tmpdir()`): the token is written once in
   `writeCodextenderAuthTokenFile`, and each shell reads it back via its own
   no-echo idiom — PowerShell `Get-Content -LiteralPath ... -Raw`, cmd
   `set /p VAR=<file`, posix `$(cat file)` — confirmed empirically against
   real `cmd.exe`/`powershell.exe` (not just read) that each correctly sets
   the var for a child process without ever printing the file's contents.
   `buildCodextenderEnvCleanupSuffix` deletes it unconditionally after the
   `claude` invocation on all three shells; a thrown `CodextenderCwdMismatchError`
   also deletes it before propagating, so only a killed pty (not a normal
   error path) can orphan the file — a materially smaller, shorter-lived
   exposure than the permanent scrollback record it replaces.

   **Round 10 (post-merge-attempt): the required CI `PR Review` gate BLOCKed
   a third time on the SAME finding class** — `deliver_pr.py`'s own
   non-converging guard fired (two consecutive BLOCKs sharing a finding),
   correctly refusing to auto-merge on a third patch attempt and handing the
   decision to the operator instead: "if the pty is killed, or execution
   fails before the cleanup suffix runs, the credential remains on disk
   indefinitely." Sven's own decision (asked directly, in plain language,
   given three concrete options): add bounded, automatic cleanup rather than
   accept the residual risk or redesign the proxy's auth model. Implemented
   as `core/codextender-auth-file-sweep.ts` — an age-gated sweep (10 min
   default, `sweepOrphanCodextenderAuthFiles`) mirroring
   `terminal/snapshot-tmp-sweep.ts`'s shape exactly (same injectable-deps,
   best-effort, never-throws posture), wired into `index.ts` on boot and a
   short periodic interval (NOT the 24h scrollback/snapshot cadence — a
   stranded credential shouldn't wait a day to be reclaimed). This closes
   the gap independently of whether the launch command ever runs, is
   copied out instead, or the pty is killed before its own cleanup fires.

## Testing

Server: `codextender-auth-file-sweep.test.ts` (round 10, new — boundary
probe over real files/mtime: reclaims an aged orphan credential file while
preserving a fresh one and an unrelated file; missing-dir no-op; exact-cutoff
boundary preserved; non-ENOENT readdir failure surfaced vs. benign ENOENT
silent; a per-file unlink failure counted but doesn't stop the sweep),
`codextender-proxy-probe.test.ts` (both probes, plus the no-fetch-
when-unconfigured degrade), `launcher-codextender.test.ts` (env-prefix
injection + cwd-mismatch throw, now also cleaning up its own temp file +
`resolveCodextenderAuthToken` env-override/blank/unset-returns-undefined;
round 8 additions: the token never appears literally in any of the 3
command strings, all 3 reference the same temp file, each shell's own
no-echo read idiom actually resolves it for a child process, and the temp
file is deleted on both the normal cleanup-suffix path and the
cwd-mismatch throw path), `settings-reader.test.ts` +
`routes/settings.test.ts` (legacy-key migration, both the GET path and PUT's
read-merge-write, plus the fresh-install-defaults-use-only-the-renamed-field
case), `runtime-chokepoint.codextender.test.ts` (chokepoint branch + AC7/AC9
bypass + cwd-mismatch 500 + `codextender_auth_token_missing` 400 with the
proxy reachable), `fork.codextender.test.ts` (fork inheritance + TOCTOU
regression + the same missing-token 400 with no orphan child row),
`codextender-models.test.ts` (added: re-probes immediately on a port change
even within the TTL, and a stale-port failure never masks with a different
port's cached list), `codextender-proxy-probe.test.ts` (added:
`isValidCodextenderPort` + both probes never call `fetch` with an
authority-confusion string/fractional/out-of-range/NaN port),
`routes/settings.test.ts` (added: PUT rejects an invalid `codextenderPort`
with 400 and never persists it; accepts a valid one).
Client: `ModelTierOverrideFields.codextender.test.tsx`,
`EditTaskModal.runtime-availability-race.test.tsx` (forced-runtime submit on
late settings resolution + a user's own pick under "both" surviving an
unrelated re-render), `CodexSettingsCard.test.tsx` (added case: a fractional
or out-of-range port is rejected, no PUT sent). E2E:
`client/e2e/flows/codextender-integration.spec.ts` (3 tests — Codextender
placeholders/catalog, static fallback + unreachable caption, light-mode
non-regression), run via the isolated stack, F0.5 surface_verification
`web` surface, `tests_run: 3`, exit 0.

## Internal Plan Review

Ran: yes (retroactively, at F11 — see the iterate spec's `## Internal Plan
Review` section for full detail and why it ran late). Status: 2 fixed
(HIGH env-var persistent-shell leak in `launcher-codextender.ts`; HIGH
`codexIntegrationMode` not pinned across Resume in `routes.ts`, fixed via
new `resolveCodexIntegrationModeForLaunch()`), 6 medium + 3 low disclosed
(untriaged this session, findings text not retained). New/updated tests:
`launcher-codextender.test.ts` (env cleanup suffix, both mutating shells),
`runtime-chokepoint.test.ts` (`resolveCodexIntegrationModeForLaunch` pin/
fallback/undefined cases).
