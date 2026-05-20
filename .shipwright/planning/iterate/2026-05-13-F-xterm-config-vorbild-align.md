---
iterate: F-xterm-config-vorbild-align
campaign: headless-terminal-refactor
type: change
complexity: small
risk_flags: []
date: 2026-05-13
adr: ADR-093
---

# Iterate F — xterm.js client config Vorbild-Alignment

## Context

After Iterate E shipped the live-pty serialize-on-attach + snapshot-on-detach
pair (ADR-092), the user reported a **residual** in-session rendering bug:
within a live session (no navigate-away), Claude TUI's status pane redraws
stack visually in the terminal (vertical "stacking" of the status line on
each redraw). The bug **clears** on navigate-away / navigate-back —
i.e. ADR-092's re-attach replay path works; what stays broken is in-session
incremental rendering before the first detach/re-attach round-trip.

Diagnostic comparison with the reference repo `siteboon/claudecodeui`, which
runs Claude TUI cleanly with raw byte-stream replay (and no server-side
`@xterm/headless` at all), surfaced four xterm.js client-side option
differences:

| Option              | Vorbild (`siteboon/claudecodeui`) | Our `EmbeddedTerminal.tsx:551-585` (pre-F) |
|---------------------|-----------------------------------|--------------------------------------------|
| `convertEol`        | `true`                            | `false` ← suspected primary cause          |
| `allowProposedApi`  | `true`                            | `false`                                    |
| `scrollback`        | `10000`                           | `5000`                                     |
| WebGL renderer      | YES (with Canvas fallback)        | NO (Canvas/DOM default only)               |

The `convertEol: false` setting was scaffolding-era default with no inline
justification. Claude TUI's status pane redraw uses cursor positioning that
assumes CR-LF-normalised line endings; a stray LF-only byte under
`convertEol: false` sends the cursor down without column reset, causing
redraws to land at visually offset columns ("stacking" pattern).

The WebGL renderer is an orthogonal robustness improvement: atomic full-frame
redraws vs. incremental Canvas/DOM partial redraws reduce visual artifacts
under high-frequency redraw scenarios (which is exactly what Claude TUI's
status pane produces).

## Goal

Flip the four xterm.js client options to match the Vorbild repo and accept
the WebGL renderer (with Canvas/DOM fallback) as the default rendering path.

## Scope

### Modify

- `client/src/components/terminal/EmbeddedTerminal.tsx` (Terminal constructor at L551–L585):
  - `convertEol: false` → `convertEol: true`
  - `allowProposedApi: false` → `allowProposedApi: true`
  - `scrollback: 5000` → `scrollback: 10000`
  - Add explicit `windowsMode: false` (Vorbild-parity; documents intent)
  - After `term.loadAddon(links)`: load `WebglAddon` inside try/catch (Canvas/DOM fallback if WebGL unavailable)
- `client/package.json`: add `@xterm/addon-webgl@^0.18.0` dependency; lockfile rewrite.
- `client/src/components/terminal/EmbeddedTerminal.test.tsx`: add a `@xterm/addon-webgl` `vi.mock` so the import doesn't break the jsdom test environment.

### Out of scope

- Theme palette (L558–L582) — unchanged per ADR-067.
- Server-side anything — pure client config.
- ADR-087 / 088 / 089 / 092 — still in force; F adds on top.
- Pixel-diff regression tests — visual correctness is operator-verified post-merge.

## Acceptance Criteria

- [x] `EmbeddedTerminal.tsx` constructor matches Vorbild on the four options + windowsMode
- [x] `@xterm/addon-webgl@^0.18.0` in `client/package.json` deps + lockfile updated
- [x] WebGL addon load uses try/catch with explicit console.warn on fallback
- [x] `client/src/components/terminal/EmbeddedTerminal.test.tsx` retains green status
- [x] `client && npm run build` clean (tsc + vite)
- [x] `client && npm run test` 777/777 (or current baseline) green
- [x] No new TypeScript errors
- [x] ADR-093 written: Vorbild comparison, screenshot context, option-by-option rationale, rejected alternatives

## Affected Boundaries

n/a — pure client UI config change. No serialized-format producer/consumer
on either end. No new IO surface. xterm.js Terminal constructor options are
not a versioned data boundary; the WebglAddon is a client-only renderer
swap with documented Canvas/DOM fallback.

## Rejected Alternatives

- **F.1: Auto-refresh push** — periodically clear-and-rewrite the terminal
  from a server-side snapshot. Rejected: high-frequency, masks symptom not
  cause, introduces flicker and breaks user scrollback position.
- **F.2: Manual re-sync button** — surface a "force refresh" CTA next to the
  terminal. Rejected: pushes operator burden onto a UX surface that should
  not require manual intervention.
- **F.5: Architecture shift** — drop xterm.js, replace with a different
  terminal emulator. Rejected: massive blast radius, the bug is far cheaper
  to fix with a four-option config flip first; if F doesn't resolve the
  residual, then F.5 becomes a candidate.

F.0 (this iterate) selected as the lowest-risk hypothesis-test: the four
options are documented xterm.js public API, the WebGL renderer has a
documented Canvas/DOM fallback, and Vorbild has shipped the same
combination in production.

## Verification

- F0: `npm.cmd run build` + `npm.cmd run test` green in `client/`.
- F0.5 surface: `cli` with justification — config-only change; visual
  correctness is verified by the operator manually post-merge (no
  pixel-diff Playwright regression is in scope for this iterate).
- F1: drift check.
- Manual UAT (post-merge, operator): launch a Claude TUI session, observe
  the status pane redraw in-session for at least 30 s. Stacking should be
  absent. If residual stacking persists, F.0 hypothesis is falsified and
  the campaign opens F.1/F.5.

## Relationship to Prior ADRs

- ADR-067 (embedded-terminal scaffold, light/dark palette) — untouched; F
  flips only behaviour options, not theme palette.
- ADR-068-A1 (disk scrollback, auto-execute) — untouched.
- ADR-087 (headless-mirror retirement) — untouched; this is a client-side
  rendering knob, orthogonal to the snapshot protocol.
- ADR-091 / 092 (live-pty replay across navigate cycle) — F is the
  follow-on to E for the **in-session** rendering surface; E fixed
  re-attach, F fixes the live-redraw axis.
