# Bug: deploy-procs.mjs tsx-watch kill sweep is machine-wide

## Problem

`scripts/deploy-procs.mjs`'s `findTsxServerPids()` matches `tsx` +
`src/index.ts` in the command line of every `node.exe` process on the
machine (Windows: `Get-CimInstance`; POSIX: originally `pgrep -f`). That is
machine-wide: a production deploy from one worktree also kills an UNRELATED
project's `tsx watch` dev server, and a parallel webui git-worktree's dev
server, even though it listens on a different PORT.

The sweep itself is load-bearing and must NOT be removed: killing only the
port listener is not enough under `tsx watch`, because the watch PARENT
process respawns the killed child and re-takes the port. The fix must
narrow the SCOPE of the sweep to the deploying repo/worktree only.

## Fix

`findTsxServerPids(repoRoot)` now requires a `repoRoot` parameter (the
absolute path to the `server/` directory being deployed) and fails closed
to `[]` if it is missing — never falls back to the old machine-wide match.
Raw process discovery is unchanged in spirit (still matches the `tsx` +
`src/index.ts` markers), but the candidates are narrowed via a new pure
helper, `filterTsxEntriesByRepo()` in the new `scripts/deploy-tsx-scope.js`
(split out of `scripts/kill-targets.js` to keep both files under the
300-line convention — `kill-targets.js` keeps its original port-kill
helpers, `deploy-tsx-scope.js` owns everything tsx-repo-scoping), which
keeps only entries whose command line resolves `repoRoot`'s own
`node_modules/.../tsx/` path. This works because a `tsx watch` process's
command line always embeds the ABSOLUTE, checkout-specific
`node_modules/tsx/...` resolution path — npm never invokes a bare relative
`tsx`, it always resolves through the repo-local `node_modules/.bin` —
verified empirically against real live worktree dev servers.

The POSIX arm was changed from `pgrep -af` to `ps -Aww -o pid=,args=`
after an earlier review round caught that `pgrep`'s `-a` flag is not
portable (it means "print full command line" on Linux/procps but "include
process ancestors" on macOS/BSD, silently disabling the sweep there).

`stopOldServer()` threads a new `repoRoot` option through; `deploy-swap.mjs`'s
one call site passes `repoRoot: serverDir`.

## Acceptance

- A production deploy from one repo/worktree must not kill a different
  repo's or a sibling worktree's `tsx watch` dev server.
- The deploying repo's own `tsx watch` PARENT process must still be found
  and killed (so it cannot respawn the child and block the new server from
  taking the port).
- An empty/missing `repoRoot` must never fall back to the old machine-wide
  match (fail closed).
