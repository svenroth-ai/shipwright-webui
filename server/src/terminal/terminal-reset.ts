/*
 * terminal-reset.ts — pure helper for the `terminalReset` field carried
 * by the WS `ready` envelope (ADR-104).
 *
 * Extracted from `terminal/routes.ts` in iterate-2026-05-27-ws-upgrade-
 * handler-split (ADR-103 retirement candidate #1). The helper is shared
 * by `routes.ts` and `ws-upgrade-handler.ts`; living in its own neutral
 * module avoids a circular dependency between them (external plan
 * review MED #3 — openrouter/openai, 2026-05-27).
 */

/**
 * ADR-104 (iterate-20260515-terminal-smear-reset) — derive the
 * `terminalReset` flag carried by the WS `ready` envelope.
 *
 * `true` exactly when this WS attach FRESHLY created the pty
 * (`ptyExistedBefore === false` — `ptyManager.get` returned undefined
 * immediately before `spawn`) AND the task already had a Claude session
 * (`firstJsonlObservedAt` set). That is the "the previous embedded
 * terminal was lost — a server restart / crash killed the pty
 * mid-session" signal that drives the EmbeddedTerminal reset banner.
 *
 * `false` on first-ever launch (no prior JSONL) and on re-attach to a
 * still-live pty (navigate-away-and-back never kills the pty, so
 * `spawn()` returns the existing handle).
 *
 * Known false-negative band (code review, ADR-104): `firstJsonlObservedAt`
 * is read from the in-memory store, which reflects the last value
 * persisted to `sdk-sessions.json`. It is RESTORED from disk at server
 * boot, so after a normal restart it is available for any task whose
 * transcript poll ever persisted it. The narrow miss: a task whose JSONL
 * first appeared, was observed by a poll, but crashed before the
 * follow-up `store.persist()` flushed — the field is `undefined` on
 * reload and the banner does not show. This degrades to the pre-ADR-104
 * behaviour (no banner) — never a false positive, never a regression —
 * so the precise (cheap, no-false-positive) `firstJsonlObservedAt`
 * signal is kept over a live JSONL-path stat. A live stat would also
 * have to encode the `~/.claude/projects/<cwd>` path and could fire on
 * a pty that ran a bare shell with no Claude session.
 */
export function deriveTerminalReset(
  ptyExistedBefore: boolean,
  firstJsonlObservedAt: string | null | undefined,
): boolean {
  return !ptyExistedBefore && Boolean(firstJsonlObservedAt);
}
