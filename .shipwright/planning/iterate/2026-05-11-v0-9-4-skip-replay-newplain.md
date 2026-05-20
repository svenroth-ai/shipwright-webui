# Iterate Spec: v0.9.4-skip-replay-newplain

- **Run ID:** iterate-2026-05-11-v0-9-4-skip-replay-newplain
- **Type:** bug
- **Complexity:** medium
- **ADR slot:** ADR-086

## Goal
For new-plain tasks (actionId === "new-plain") skip the disk-scrollback
replay on WS attach. Claude TUI on Windows ConPTY emits per-keystroke
input-field redraws + footer-state rotations as raw bytes in the main
buffer (no \x1b[?1049h alt-screen); the ADR-069 sanitizer strips cursor
positioning but preserves character bytes, so every keystroke + every
footer-hint rotation accumulates linearly in scrollback. On replay the
viewport renders as stacked ghost characters + repeated footer banners,
making the terminal unusable.

## AC-1 — WS upgrade for new-plain skips replay
- [ ] WS attach to a new-plain task with non-empty disk-scrollback receives `ready` envelope + `scrollback-meta` (bytes=0) + live `data` envelopes only — NO `replay_start` / `replay_chunk` / `replay_separator` / `replay_end`.

## AC-2 — Non-new-plain tasks still replay normally
- [ ] Replay envelopes still fire for adopted brownfield / fork / slash-command launches (existing behavior preserved).

## AC-3 — Privacy footer suppressed for new-plain
- [ ] `scrollback-meta` reports `scrollbackBytes: 0` for new-plain on attach so the privacy disclosure footer doesn't render (bytes are still on disk; user can clear via overflow menu).

## Trade-off
- User loses scrollback-restore on re-attach for new-plain.
- Acceptable: the alternative (current corrupted replay) is worse UX; the "Clear terminal history" overflow menu still wipes the on-disk bytes.

## Affected FRs
FR-01.28 — one new AC appended.

## Empirical evidence
- Captured 8487 bytes of ~/.shipwright-webui/terminal-scrollback/2aa752d7-e9c1-43df-a6b7-ca3ca9bb19aa.log
- No alt-screen sequences (\x1b[?1049 not present)
- Per-keystroke \e[7m \e[27m<char> emit pattern visible (Claude's reverse-video cursor + char)
- Footer hint rotations stacked (Press Ctrl-C / Pasting... / No image found / Checking for updates)
- German text from prior typing visible despite "nichts schreibe" in this attach

## Verification
- Surface: web
- Runner: npx playwright test e2e/flows/v0-9-4-skip-replay-newplain.spec.ts --config=client/playwright.tailscale.config.ts
