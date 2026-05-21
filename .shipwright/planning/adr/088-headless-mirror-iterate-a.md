# ADR-088 spec — Server-side @xterm/headless mirror (Iterate A)

**Linked decision:** `.shipwright/agent_docs/decision_log.md` → ADR-088.
**Plan of record:** `.shipwright/planning/embedded-terminal-refactor-headless.md` § "Iterate A".
**Spike artefacts:** `C:/Users/you/AppData/Local/Temp/codex-terminal-spike/`.

## Extended Context

Four iterates (v0.9.1 → v0.9.4 — ADR-069, ADR-077, ADR-079, ADR-086) layered byte-stream workarounds on top of the disk-scrollback chosen in ADR-069. The architectural mismatch: Claude Code's TUI redraws main-buffer state with raw cursor-position bytes — only a real terminal emulator can preserve that faithfully.

Empirical spike on the captured 30 986-byte real Claude TUI scrollback proved `@xterm/headless` + `@xterm/addon-serialize` reproduce visible cell state correctly under random chunking, mid-escape splits, and resize-midway — with one caveat: the first serialize after a resize has a 1-character drift, which converges to a fixed point on the second serialize (T2: round2 == round3).

## Implementation Detail

- **HeadlessMirror** wraps `@xterm/headless` Terminal per LIVE pty (invariant #1 — no live Terminal for idle/completed tasks).
- `pty.onData` → fire-and-forget `mirror.write(data)` in parallel with the existing scrollback-store append.
- `pty.kill` / `pty.onExit` → detached `finalizeMirrorSnapshot` chain runs M2 double-serialize (round1 → write into warm Terminal → round2 stable output) → persist to `<scrollbackDir>/<taskId>.snapshot` via atomic temp-rename.
- Feature flag `SHIPWRIGHT_TERMINAL_HEADLESS_MIRROR=1` gates wiring — default OFF in iterate A (zero behavior change; AC#1). Iterate B flips default.

**New files:**
- `server/src/terminal/headless-mirror.ts` (CJS interop via `import pkg from "@xterm/headless"; const { Terminal } = pkg;`)
- `server/src/terminal/snapshot-store.ts` — versioned plain-text header `# shipwright-snapshot v1 xterm@<ver> <cols>x<rows>`, bounded-regex parser, 0o600/0o700 POSIX perms, realpath-at-op-time guard, UUID validation on every public method.

**Modified:**
- `pty-manager.ts` — HeadlessMirror entry, parallel onData listener, finalize-on-kill, resize forwarding.
- `config.ts` — new `terminalHeadlessMirror` flag.
- `index.ts` — snapshot-store construction + best-effort init.

**Intentionally NOT modified:** `routes.ts` — Iterate A is write-only; replay protocol still uses chunked scrollback (Iterate B replaces it).

**Pinned dependencies (EXACT, architecture invariant #4):** `@xterm/headless@5.5.0`, `@xterm/addon-serialize@0.13.0`.

## External Plan Review Dispositions

OpenRouter (gemini-2.5-flash + gpt-5.1-mini) — 5 Gemini findings + 13 OpenAI findings:

- **Gemini #1 / OpenAI #2** (HIGH — "no CPU/RAM/disk regression" unrealistic): accepted, AC interpreted as "no user-perceptible regression at typical concurrency". Spike measured <80 MB RSS across multiple terminals; worker-thread offload deferred unless production telemetry shows event-loop blocking.
- **Gemini #2** (HIGH — idle→active hydration): out-of-scope for Iterate A (write-only); addressed by Iterate B.
- **Gemini #3** (MEDIUM — error boundary on `term.write`): fixed — `HeadlessMirror.write` wraps `term.write` in try/catch; pty-manager onData wraps with `.catch()`.
- **Gemini #4 / OpenAI #4** (MEDIUM-HIGH — mid-CSI corruption at serialize / resize ordering): fixed — `serializeStableWithCanonicalBuffer` calls `flushPendingWrites()` before round1.
- **Gemini #5** (LOW — DoS via oversized dims): fixed — `clampCols`/`clampRows` cap at 1000x500; non-finite values clamp to 1.
- **OpenAI #1** (MEDIUM — isolation): already-in-place — scrollback append synchronous + try/catched; mirror write separate try/catch + `.catch()` shell.
- **OpenAI #3** (MEDIUM — xterm version pair compat): documented — both packages pinned EXACT; header embeds `@xterm/headless` version read from `node_modules` at runtime.
- **OpenAI #5** (MEDIUM — visible-line equality misses wrap/cursor/alt-screen): accepted-with-rationale — addon-serialize captures these in payload; visible-line equality at round3 IS the integration test.
- **OpenAI #6** (MEDIUM — drift between scrollback + snapshot artifacts): accepted-as-design — Iterate A keeps both; Iterate B switches to snapshot; Iterate C deletes scrollback path.
- **OpenAI #7** (MEDIUM — reader-side migration): out-of-scope — Iterate B wires reader.
- **OpenAI #8** (MEDIUM — cols/rows header ambiguity): documented — header comment states "FINAL size at moment snapshot was written".
- **OpenAI #9** (MEDIUM — mirror ownership races): already-in-place — `PtyManager.spawn` idempotent by taskId.
- **OpenAI #10** (MEDIUM — pathological UTF-8 / wide / CRLF): partially-accepted — fixture log is real Claude TUI output (CRLF + ANSI SGR + OSC titles + box-drawing UTF-8). Mid-escape 4-byte split test forces every CSI/OSC fragmentation. Wide-character cursor-step tests deferred to Iterate B real-browser-smoke.
- **OpenAI #11** (LOW — retention surface): already-in-place — snapshots share scrollback dir (0o700) + inherit 0o600 file mode + 24h TTL.
- **OpenAI #12** (LOW — header parser hardening): fixed — header size capped at 512 bytes; version `v\d{1,3}`; terminalVersion `\S{1,64}`; dims `\d{1,5}`.
- **OpenAI #13** (LOW — M2 docs): documented — `headless-mirror.ts` + ADR explain root cause (T2 fixed-point convergence), ~10 ms cost, link planning doc.

## Self-Review (7-item checklist per references/iteration-reviews.md)

1. **Spec Compliance** — PASS: All 5 ACs covered (flag-off no behavior change → integration test; shadow snapshot write → integration test; visible-line equality on real fixture → `headless-mirror.fixture.test.ts`; versioned header + rejection → `snapshot-store.test.ts`; no live mirror after kill → integration test).
2. **Error Handling** — PASS: kill path best-effort with try/catch around `mirror.serializeStable` + `snapshotStore.write`. Snapshot writer cleans up tmp on rename failure.
3. **Security Basics** — PASS: UUID validation on every public method (path-traversal defense); realpath-at-op-time; 0o600/0o700 POSIX perms; bounded regex; resize-DoS clamping.
4. **Test Quality** — PASS: 38 new tests across 4 new files; fixture test uses real captured 30 986-byte Claude TUI scrollback; resize-midway variant is precisely the case M2 fixes (verified by RED-phase run).
5. **Performance Basics** — PASS: <80 MB RSS across multiple terminals; M2 ~10 ms per attach; fire-and-forget mirror.write keeps broadcast loop synchronous.
6. **Naming & Structure** — PASS: new files follow terminal/ subdomain; class naming matches PtyManager/ScrollbackStore pattern.
7. **Affected Boundaries** — PASS: snapshot file format is a NEW I/O boundary. Empirical boundary probe runs producer→file→consumer round-trip for empty/ASCII/ANSI/UTF-8-multibyte/header-collision/>1-MiB payloads.

## Confidence Calibration (medium + touches_io_boundary)

12 probes against snapshot file boundary — all PASS:

1. Empty payload round-trip
2. Simple ASCII round-trip
3. ANSI escape sequence round-trip
4. UTF-8 multi-byte (CJK + emoji + box-drawing) round-trip
5. Header-collision payload round-trip
6. Large payload (>1 MiB) round-trip
7. Malformed envelope (no newline) — correctly throws
8. Malformed header shape — correctly throws
9. Unknown version (v99) — correctly throws (AC #4)
10. Atomic-write probe (overwrite leaves no tmp file)
11. Two-task isolation probe
12. POSIX file mode 0o600

Asymptote reached: two consecutive probe rounds with no findings — boundary calibrated.

**Edge cases NOT probed (deferred):** concurrent write same task (single-writer-per-task is enforced by pty-manager); fs.rename across filesystems (snapshot dir is single-fs by construction); Windows symlink escape (POSIX symlink covered; Windows admin-required junction is a separate threat model).

## Rejected Alternatives (with rationale)

1. **M1 — ship with 1-char drift unmitigated.** Spike showed visible in resize-midway; M2 cost ~10 ms is negligible.
2. **M3 — pin mirror dims at task creation, dispose-recreate on client resize.** Complex; not justified by spike evidence.
3. **Bump `@xterm/headless` to 6.0.0.** Spike validated 5.5.0; bumping would invalidate resize-drift evidence.
4. **Use `^` ranges instead of exact pins.** Architecture invariant #4 forbids.
5. **Include reader-side wiring in this iterate.** Conflates with Iterate B.
6. **Add `routes.ts` snapshot-existence probe for diagnostic logging.** Extra disk syscall per WS attach in flag-OFF mode violates AC #1.

## Test Results Summary

- Server `npm run build` clean.
- 60 test files / 894 tests green (+38 new: 4 fixture variants + 21 snapshot-store + 6 headless-mirror contract + 7 pty-mirror-integration).
- Type-system clean (server tsc + client tsc).
- Fixture test b. (4-byte chunks) runs ~120s under pathological fragmentation — within spike envelope; production chunks are KB-sized.

## New Write Surface

`<registryDir>/terminal-scrollback/<taskId>.snapshot` — POSIX 0o600, plain-text UTF-8, atomic temp-rename, versioned header.

## Notes

Phase Quality Tier-1 FAILs from session start (C1/C5 project/iterate, S1 project) are stale audit signals from completed pipeline phases — not introduced by this iterate. Iterate canon completion tracked via the new `write_changelog_drop.py` path going forward.
