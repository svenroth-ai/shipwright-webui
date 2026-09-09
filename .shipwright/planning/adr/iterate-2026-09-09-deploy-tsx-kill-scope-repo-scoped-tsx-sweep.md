# Repo-scoped tsx-watch kill sweep

## Context

`deploy-procs.mjs`'s `findTsxServerPids()` matched any process whose command
line contained `tsx` and `src/index.ts`, with no repo-identifying input. A
production deploy from one worktree therefore also killed an unrelated
project's `tsx watch` dev server, and a sibling `shipwright-webui` worktree's
dev server, even though it listened on a different port. This was inherited
verbatim from the pre-fix inline sweep (#249) and flagged independently by
both an external LLM review and the internal code review at the time.

The sweep itself is load-bearing: killing only the port listener is not
enough under `tsx watch`, because the watch parent respawns a killed child
and re-takes the port. The original bug report proposed deferring a fix
because "the tsx command line carries the entry path RELATIVELY" — this was
investigated and found FALSE. Real tsx-watch command lines (verified against
two live worktree dev servers) always carry the ABSOLUTE, checkout-specific
`node_modules/.../tsx/...` resolution path, because npm never invokes a bare
relative `tsx` — it always resolves through the repo-local `node_modules/.bin`.

## Decision

Scope the sweep to the deploying repo by matching each candidate process's
command line against an anchored `<repoRoot>/node_modules/(?:[^\s"']+/)*tsx/`
pattern (platform-aware separator/case normalization, path-boundary anchored
so a sibling checkout whose name merely *extends* repoRoot can never match).
Discovery and repo-scoping are split: `deploy-tsx-scope.js` (pure,
unit-tested) parses raw Windows CIM JSON / POSIX `ps -A` output into
`{pid, ppid, commandLine}` entries and filters them by repo; `deploy-procs.mjs`
(impure) does the actual process enumeration and kill. `ParentProcessId`/`ppid`
is captured on both platforms so the matched set can be partitioned
parents-before-children, closing a respawn race the original ordering risked.
`findTsxServerPids()` fails closed (matches nothing) on an empty/missing
`repoRoot`, never falling back to the old machine-wide match.

## Consequences

A deploy now only kills its own repo's tsx-watch parent (+ listener PIDs on
its own port); a sibling worktree's or an unrelated project's dev server
survives. Windows discovery gained BOM-stripping and an explicit
error/exit-code check so a "0 candidates" clean exit is no longer
indistinguishable from a discovery failure; `deploy-swap.mjs` now logs
raw/matched sweep counts every deploy and names a likely foreign-worktree
port-holder in its failure message instead of unconditionally blaming "the
OLD server". POSIX discovery moved from `pgrep -f` (whose `-a` flag means
"include ancestors" on macOS/BSD, not "print full command line" — silently
dropping the sweep there) to unfiltered, portable `ps -A -o pid=,ppid=,args=`
with the tsx+entry-path match done in JS instead.

## Rationale

Text-argv matching with no filesystem access at the comparison point cannot
close every theoretical gap (a symlinked checkout presenting a different
spelling on each side; a foreign process incidentally referencing this
repo's tsx path via a `--require`/`--import` argument without its own tsx
resolving from here). Three rounds of external review narrowing (bare
repoRoot → `node_modules/` → literal `tsx/` path segment) closed the
practical cases; the residual incidental-argument case cannot be closed by
flag-based rejection without breaking tsx's own legitimate self-invocation
shape (a `--require`/`--import` pointing at another checkout's tsx internals
is exactly what a real tsx supervisor's loader child looks like). This is
accepted as a documented residual risk, independently concurred by GLM
across two consecutive external-review rounds, rather than treated as an
unresolved defect.

## Rejected alternatives

- Removing the sweep entirely and relying on the port-listener kill alone:
  rejected because `tsx watch`'s parent respawns a killed child and re-takes
  the port, so the deploy would loop.
- Per-PID cwd/repo resolution via the OS (e.g. reading each process's actual
  working directory): rejected as unnecessary once the "relative entry path"
  premise was falsified — the command line itself already carries an
  absolute, checkout-specific path, so a filesystem-level cwd lookup adds
  complexity without closing any gap the argv match doesn't already close.
- Unconditional case-folding on all platforms for symmetry: rejected because
  it would cross-match two differently-cased checkouts on a case-sensitive
  POSIX filesystem — folding is now platform-gated (win32 only).
