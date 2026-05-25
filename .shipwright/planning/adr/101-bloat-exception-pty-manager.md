# ADR-101: Bloat exception — `server/src/terminal/pty-manager.ts` raised to 1198-LOC

<!-- Filed under Campaign C, sub-iterate C8. This ADR transitions the
     baseline entry for pty-manager.ts from `state=grandfathered`
     (anonymous TODO) to `state=exception` (named accepted decision).
     No code change to pty-manager.ts itself — the whole point of C8
     is to formally accept the current shape as a deep module. -->

- **Status:** accepted
- **Date:** 2026-05-25
- **Re-Review-Date:** 2026-08-25 _(3 months out. The reviewer at that
  date checks whether the deep-module argument still holds — in
  particular, whether an auth layer has been added that genuinely
  separates concerns, or whether any of the responsibilities listed
  under "Ousterhout Argument" have been removed.)_
- **Incident Reference:** Campaign C, sub-iterate C8 — loop_id
  `sub_iterate-20260525-213548`, branch
  `iterate/campaign-C-C8-pty-manager-exception`, PR (assigned at F11).

## Context

`server/src/terminal/pty-manager.ts` is the single owner of the embedded
terminal's PTY lifecycle. It is 1198 LOC against the project default
limit of 300, has lived in `shipwright_bloat_baseline.json` as
`state=grandfathered` since Campaign A.defense seeded the baseline, and
has accumulated mass primarily through three load-bearing ADRs:

- **ADR-067** — pty-manager spawn whitelist (`pwsh / powershell.exe /
  cmd.exe / bash / zsh / sh / fish`); basename-normalised match; WS-
  upgrade Origin gate (loopback-only). `paste-image` / `append-gitignore`
  flow through `realPathGuard`; 8 MiB image cap + 9 MiB Content-Length
  precheck + magic-byte mime sniff. `POST /spawn` is idempotent prewarm
  only — WS upgrade is the authoritative pty creation path.
- **ADR-068-A1** — scrollback path-guard is `realpath` at every operation
  (not just boot-time). UUID validated on every public ScrollbackStore
  method. Rotate/read/clear/closeStream go through per-task PQueue;
  rotation 4-state FSM (NORMAL → ROTATING → ROTATION_FLUSH → NORMAL);
  overflow during rotation throws (cap 4 MiB). Replay-on-attach uses
  `pty.pause / resume` — never drop chunks (ANSI/UTF-8 corruption).
- **ADR-092** — WS replay precedence is LIVE-mirror FIRST, disk-snapshot
  FALLBACK. Snapshot-on-detach uses `detachAndCount(taskId, conn)`
  atomically — when `remainingAttachCount === 0`,
  `void ptyManager.flushMirrorSnapshot(taskId)` fires
  fire-and-forget. DO NOT split the count check across detach
  (race-vulnerable to concurrent attach). DO NOT call `mirror.dispose()`
  from `flushMirrorSnapshot` — pty must stay alive for subsequent
  `pty.onData`.

The Campaign A.defense pre-commit hook plus the Campaign A.defense Group
H audit (in the shipwright dev repo) treat `grandfathered` as "we owe a
decision-record one day". C8 pays that debt: the decision is to keep
the file at its current shape and record the reasoning rather than
split.

Nothing in pty-manager.ts changes as part of C8 — this ADR is purely
metadata. The actual concrete change is one entry in
`shipwright_bloat_baseline.json` flipping from `state=grandfathered` +
`adr=null` to `state=exception` + `adr="ADR-101"`.

## Ousterhout Argument

John Ousterhout's *A Philosophy of Software Design* defines a **deep
module** as one with a narrow public interface and substantial,
atomically-coupled behaviour behind it. Splitting a deep module
shallow exposes internals that should stay encapsulated and inflates
the cumulative interface area the caller must reason about.

**Public surface (narrow):** the class exposes 24 public methods, of
which only a handful are part of the actual lifecycle contract used by
`server/src/external/routes.ts` and the embedded-terminal WS handler:

- `spawn(taskId, opts)` — create + register a PTY
- `attach(taskId, conn)` — WS attaches, returns role + replay context
- `detachAndCount(taskId, conn)` — atomic detach + remaining-attach
  count (per ADR-092)
- `flushMirrorSnapshot(taskId)` — fire-and-forget disk snapshot on
  last detach (per ADR-092)
- `serializeMirrorIfLive(taskId)` — live mirror serialization for
  attach-time replay (per ADR-092)
- `pause(taskId)` / `resume(taskId)` — backpressure on attach replay
  (per ADR-068-A1)
- `kill(taskId)` / `killAll()` — lifecycle teardown
- `write(taskId, data)` / `resize(taskId, cols, rows)` — pass-through
  to underlying pty

The remaining methods (`getRole`, `hasActiveWriter`, `attachCount`,
`peekTerminalText`, `subscribe`, `subscribeForConnection`,
`pauseForConn`, `resumeForConn`) are auxiliary accessors that exist
because the WS handler needs to distinguish writer-vs-reader roles
without leaking the per-connection bookkeeping out of the manager.
They are NOT a parallel public API — they all close over the same
internal `taskId → handleMeta` map.

**Internal behaviour (substantial + atomically coupled):**

1. **PTY spawn + shell whitelist enforcement** (ADR-067). The
   whitelist check, the basename normalisation, the env-passthrough,
   the cwd resolution, and the spawn-failure-classification all live
   here because they are the architectural enforcement line for the
   "webui spawns no Claude process directly" invariant.
2. **Backpressure / attach-replay handshake** (ADR-068-A1). `pause` /
   `resume` are not generic — they are the specific dance that lets
   attach-replay drain the headless-mirror serialize buffer without
   dropping live `onData` chunks. The pause point and the resume
   point must share the same lock with attachment registration,
   otherwise replay corrupts ANSI/UTF-8 mid-sequence.
3. **Idle timer + watchdog** (lives in this file because the idle
   timer must atomically coordinate with `attachCount` going to zero
   AND with `flushMirrorSnapshot` completing — splitting it out
   would require exposing the per-task attach-count map AND the
   mirror-flush completion signal across a module boundary).
4. **Headless-mirror serialization** (ADR-088 + ADR-092). The live
   `@xterm/headless` mirror lives here because it consumes the same
   `pty.onData` stream as the WS broadcast and the scrollback writer.
   Three consumers, one source, shared backpressure: splitting them
   forces the `onData` callback to fan out across a module boundary,
   which means the backpressure pause/resume now crosses two
   modules' locks. ADR-092 explicitly rejected this split
   ("flushMirrorSnapshot must not call mirror.dispose() — pty must
   stay alive for subsequent pty.onData").
5. **Scrollback rotation 4-state FSM** (ADR-068-A1). The rotation FSM
   coordinates with append (WriteStream's own serialization), with
   the per-task PQueue, AND with the overflow cap (4 MiB). It is
   structurally inside pty-manager because the append path is the
   same `pty.onData` consumer described above.
6. **Per-connection role assignment + writer/reader bookkeeping**
   (writer-vs-reader is an invariant of the WS replay contract —
   only one writer; readers get role-downgraded if the writer
   detaches). Splitting this out would require the WS handler to
   re-acquire the role lock on every send, defeating the point of
   the single-writer invariant.

The public surface stays narrow because all six bullets above close
over the same private state: `taskId → handleMeta` (which itself owns
the pty handle, the headless mirror, the attach set, the idle timer,
the scrollback stream, and the role registry). Any split that severs
this state forces the seam onto either the WS handler or the
`external/routes.ts` orchestrator — moving the complexity outward
rather than reducing it. That is exactly the failure mode Ousterhout
calls a *shallow module*.

## YAGNI Check

Walk through each of the six responsibilities listed under
"Ousterhout Argument" and ask "is this needed **today**?":

1. **PTY spawn + shell whitelist** — needed today; the whitelist is
   the architectural enforcement line for ADR-067, and Campaign A
   ships it as a security guarantee. Cannot be deleted.
2. **Backpressure / attach-replay handshake** — needed today; without
   it, the very first attach replay corrupts ANSI/UTF-8 (ADR-068-A1
   regression-guarded by `pty-replay-attach-detach.test.ts`).
   Cannot be deleted.
3. **Idle timer + watchdog** — needed today; without it, abandoned
   ptys would leak. Active regression-guard: production users have
   long-running tasks where the idle timer is the only thing
   preventing FD exhaustion.
4. **Headless-mirror serialization** — needed today; ADR-092 made
   live-mirror-first the replay primitive, and the v0-9-6-live-pty-
   replay.spec.ts E2E hard-asserts it. Cannot be deleted.
5. **Scrollback rotation FSM** — needed today; 4 MiB cap protects
   against runaway emitters and the FSM is what makes rotation
   atomic with append. Cannot be deleted.
6. **Per-connection role assignment** — needed today; the single-
   writer invariant is what makes Resume / Relaunch deterministic
   (only one writer means only one source of truth for the next
   `pty.write`). Cannot be deleted.

None of the responsibilities is speculative scope; none can be
deleted; the size is load-bearing.

## Chesterton-Fence Check

Three ADRs document why the current shape exists:

- **ADR-067** (pty-manager whitelist + WS-upgrade origin gate) —
  established the spawn-target and the WS-upgrade authority. The
  fence here is "webui spawns no Claude process directly"; the spawn
  whitelist is the enforcement line.
- **ADR-068-A1** (scrollback + replay-on-attach) — established the
  rotation FSM, the per-task PQueue, the pause/resume replay
  handshake, and the `<taskId>.log` filename convention. The fence
  here is "multi-launch + resume + fork share one task"; the
  filename convention is the enforcement line.
- **ADR-092** (WS replay precedence + atomic detach) — established
  `detachAndCount` as the atomic detach primitive and the fire-and-
  forget `flushMirrorSnapshot` on last detach. The fence here is
  "snapshot is a fallback when live mirror is null, never a
  primary"; the precedence ordering in `routes.ts` is the
  enforcement line.

All three fences stand for documented reasons; tearing any of them
down would require revisiting the parent ADR. None is a candidate
for "tear it down and refactor instead".

A git-history scan of `pty-manager.ts` (post-ADR-067, when the file
first crossed 300 LOC) shows monotonic accretion driven by the three
ADRs above plus their iterate-level follow-ups (ADR-088, ADR-097,
ADR-098). The accretion was deliberate, reviewed, and each step
landed with its own regression-guard test. The fence stands.

## Decision

Grant a bloat exception: `server/src/terminal/pty-manager.ts` is
allowed to remain at its current 1198 LOC. Baseline entry transitions
from `state=grandfathered` + `adr=null` to `state=exception` +
`adr="ADR-101"`. The anti-ratchet rule (Campaign A.defense)
continues to apply — the `current` value in the baseline is a
ceiling, not a sliding target.

**Retirement plan:** retire this exception only when an auth layer is
added to the pty-manager that genuinely separates concerns (e.g. a
distinct module owning "who is allowed to spawn what" so the
whitelist enforcement can move out). At that point the file should
be split along the new seam, the exception ADR superseded, and the
baseline entry removed.

**Out of scope for retirement:** mechanical extraction of "scrollback
stuff into a file" or "headless-mirror stuff into a file" —
ADR-092 explicitly rejected those splits, and re-litigating them
without new evidence is a contract violation.

## Consequences

- The baseline entry for `server/src/terminal/pty-manager.ts`
  records the named decision via `adr="ADR-101"`. The Campaign
  A.defense Group H audit (in the shipwright dev repo) recognises
  `state=exception` + valid `adr` as the named-decision satisfied
  state and stops counting this entry against the anonymous-TODO
  metric.
- The pre-commit anti-ratchet hook (`scripts/hooks/anti_ratchet_
  check.py`) continues to block any commit that increases the
  `current` value upward. The exception raises the *allowed*
  ceiling for this file; it does not relax the anti-ratchet rule.
- Downstream tests do NOT change. The exception is purely a baseline
  metadata flip; no test asserts the old `state=grandfathered`
  value.
- Cost if the exception holds longer than 2026-08-25 Re-Review-Date:
  none, provided the deep-module argument still holds. The cost is
  borne entirely by the reviewer at that date, who must re-verify
  the six "atomically coupled" claims above.

## Rejected alternatives

1. **"Just split spawn from scrollback into separate modules."** —
   Rejected because the two share `pty.onData` as a single source.
   Splitting them requires fanning that callback across a module
   boundary, which means the backpressure pause/resume lock now
   crosses two modules. ADR-092 explicitly forbade
   `mirror.dispose()` from `flushMirrorSnapshot` for exactly this
   reason: pty must stay alive for subsequent `pty.onData`. A split
   would re-introduce the same coupling at the seam, just with
   inter-module locks now visible as bugs.
2. **"Extract the per-connection role bookkeeping into a separate
   `pty-roles.ts`."** — Rejected because role assignment closes over
   the same `taskId → handleMeta` map as `attachCount`,
   `hasActiveWriter`, `subscribeForConnection`, and `attach`. The
   role module would need a back-reference to the manager map, which
   is structurally the same as inlining the logic. A pure-data
   extraction (types only, no behaviour) is already done — the
   `AttachResult` / `ConnectionSubscription` types live at the top
   of the file.
3. **"Rewrite in a different language (e.g. Rust for the pty layer
   only)."** — Rejected as out of scope; the entire server is
   TypeScript and the spawn target is `node-pty`, which is what
   gives us the Windows ConPTY path. A language rewrite is a
   multi-quarter campaign; the bloat baseline is the wrong forum
   to authorise it.
4. **"Delete the feature (terminal embedded mode)."** — Rejected;
   ADR-034 + ADR-068-A1 establish embedded terminal auto-execute as
   the load-bearing UX for Plan D″ external-launch. Deleting it
   would revert to copy-paste-only launches.
5. **"Leave it at `state=grandfathered` and never write the ADR."**
   — Rejected; this is the option the project has had since
   Campaign A.defense, and Campaign C C8 exists specifically to
   end that state. Anonymous TODO entries accumulate review debt
   for future maintainers who have to re-derive the deep-module
   argument from scratch. Naming the decision is the entire point.

---

## External Sources Acknowledged

This ADR's YAGNI Check + Chesterton-Fence Check headings are adapted
from:

- obra/superpowers, skill `writing-plans` —
  https://github.com/obra/superpowers — MIT © Jesse Vincent
- addyosmani/agent-skills, skill `code-simplification` —
  https://github.com/addyosmani/agent-skills — MIT © Addy Osmani

The Incident-Reference field follows the **pattern** of the per-decision
incident-reference convention in `multica-ai/multica` `CLAUDE.md`
(Apache-2.0 modified-with-hosting-restriction — patterns reusable,
text not copied).

The deep-module concept is from John Ousterhout, *A Philosophy of
Software Design* (cited as concept; no text reproduced).
