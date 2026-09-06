# Claim-authorized launch gets an explicit permission perimeter

## Context

leadwright's stage-2 executor launches a webui-produced command via
`spawn(command, {shell:true, detached:true, stdio:"ignore"})` — a detached
process that outlives the daemon, with full shell/git/credential access. The
command carried no `--permission-mode`, `--allowed-tools`, or `--restricted`,
so a claim-authorized launch ran with the same unrestricted authority as an
interactive human session, for a fully unattended process.

## Decision

`POST /api/external/tasks/:id/launch` now arms an explicit `--tools
Bash,Read,Write,Edit,Glob,Grep --permission-mode dontAsk` perimeter on a
launch this run's `checkClaimHolderGate` proves is claim-authorized —
never on a human/manual launch, which stays byte-for-byte unchanged.

`--allowed-tools` was empirically verified (live CLI probes on this
machine's Claude CLI, mirroring leadwright's own documented finding) to
NOT restrict Bash under any permission mode — it only pre-approves.
`--tools <list>` is an exclusive toolset replacement that genuinely
restricts. `--restricted` was deliberately rejected: it strips
plugin/settings loading the executor needs for git/npm/file work.

Two independent command-rendering pipelines exist (`core/launcher.ts`'s
argv-based `buildCopyCommands`, and `core/actions-substitute.ts`'s
template-string `substitutePlaceholders`), each needing its own arming
mechanism (`launcher-permission-flags.ts` argv-push;
`claim-executor-template-arming.ts` string-surgery on the rendered
template output, anchored on the task's own `--session-id <uuid>` and
failing closed if that anchor is missing, non-unique, or the raw
`command_template` never declares the literal `--session-id {task.uuid}`
placeholder — the last check closes a Stage-3 doubt-review finding where a
caller-supplied `description` could coincidentally contain matching text).

Because only 2 of the launch route's 6 precedence branches are ever
reachable by today's `{ claimToken }`-only leadwright body shape, a third,
centralized backstop (`claim-permission-perimeter-assert.ts`) runs AFTER
branch dispatch regardless of which branch fired: any claim-authorized
launch whose resolved commands lack the perimeter on every shell form is
refused with 409, rather than trusting per-branch opt-in wiring to stay
complete as new branches or body shapes are added later.

## Consequences

A claim-authorized executor keeps Bash/git/npm/file-write ability (it must
to do its job) but cannot use unlisted tools (Task, WebFetch, etc.)
without an interactive prompt it can never answer (`dontAsk` + a closed
allow-list). Manual/human launches are provably unchanged (tested on the
produced command STRING). This does **not** close OS-level containment: a
Bash-invoked nested `claude` with its own config is not a tool call this
perimeter can see, and Bash itself retains full shell authority — the
allow-list constrains which top-level CLI tools the outer session may
invoke, not what a shell command run through Bash can do.

## Rationale

The gate's own `claimAuthorized` boolean (not a second, independently
re-derived token-match check) is threaded through, so the "is this
claim-authorized" question has exactly one source of truth and cannot
drift. The centralized backstop exists because per-branch wiring is an
assumption about the calling daemon's current body shape, not a
code-enforced invariant, and a Stage-3 doubt review found exactly that gap
(a body combining a valid `claimToken` with `phaseTaskRef` would otherwise
reach an unarmed branch).

## Rejected alternatives

- Wiring `claimAuthorized` individually into all 6 branches instead of a
  centralized post-dispatch assertion — rejected as strictly weaker: it
  requires remembering to wire every *future* branch too, which is the
  exact failure mode the doubt review found.
- `--allowed-tools` alone — empirically proven not to restrict Bash.
- `--restricted` — strips plugin/settings the executor legitimately needs.
- Anchoring the template-arming purely on the rendered output's uniqueness
  — insufficient on its own (a caller-supplied placeholder can coincide
  with the anchor text when the template has no real anchor at all); now
  requires the literal placeholder in the raw, pre-substitution template.

## Review history

Stage 1 (spec-reviewer): REJECTED an initial version that wired only the
legacy-fallback branch, since leadwright's real launches (required
`actionId`, once-set-always-used) go through the action-substitution
branch instead — fixed.

Stage 2 (code-reviewer): HIGH — the template-arming anchor matched only
the first occurrence of `--session-id <uuid>`, so a non-unique anchor
could arm the wrong location — fixed with an `indexOf === lastIndexOf`
uniqueness check. MEDIUM — missing end-to-end test for the fail-closed 409
path — fixed.

Stage 3 (doubt-reviewer, adversarial): 3 HIGH findings, all fixed — (1) a
unique-but-fake anchor (inside a caller-controlled placeholder) could still
arm a fake location when the template has no real anchor at all — closed
by requiring the literal placeholder in the raw template; (2) a custom
template's own `{task.parameters?}` could re-declare `--tools`/
`--permission-mode` and conflict with the injected ones — closed by
failing closed when either flag is already present before arming; (3)
`claimAuthorized` reached only 2 of 6 branches with no code-enforced
guarantee — closed by the centralized post-dispatch backstop.
