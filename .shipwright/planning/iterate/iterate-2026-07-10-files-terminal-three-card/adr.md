# Iterate ADR — A18 Files & Terminal three-card layout (FR-01.62)

Run ID: `iterate-2026-07-10-files-terminal-three-card` · Campaign
`webui-wow-usability-2026-07-10` · sub-iterate A18 · change_type=feature ·
complexity=medium · model claude-opus-4-8.

## Decision

Restyle the Files & Terminal task-detail body into three cards (Files glass ·
Terminal/Transcript SOLID beige · Smart Preview glass) with greyed `.ft-head`
bands holding segmented tabs, plus a "Maximize terminal" focus mode — WITHOUT
touching the terminal's byte path.

Key architecture choices:

- **Cards built in the page, not the shell.** The center card's segmented tabs
  must stay Radix `role="tab"` (the whole terminal E2E corpus pins
  `getByRole("tab",{name:/terminal/i})` to one match), and Radix `Tabs.List`
  (head) + `Tabs.Content` (body) must share one `Tabs.Root`. That couples the
  middle card's head+body into one place — the page. So all three cards are
  composed in `TaskDetailPage`; `TaskDetailThreePane` stays the pure resizable
  shell.
- **Maximize via `FocusModeContext`, NOT a lifted hook.** The shell keeps
  `useThreePaneLayout` (unchanged public contract → existing shell tests
  untouched) and provides a context; the middle head's maximize button (rendered
  as a shell descendant via the `center` prop) consumes it. Default is a safe
  no-op so the button works when the shell is mocked (TaskDetailPage.test).
- **Maximize reuses the collapse→resize path** (`maximized || collapsed`), which
  is what fires the pty resize — no new hide path, no 120-col desync.
- **`--surface-reading`** semantic token added over the existing A03 `--beige`
  value (single source, no duplicate hex).
- **`PaneSplitter` extracted** from the shell (the two verbatim-duplicated resize
  handles) to hold the shell ≤300 LOC after the maximize wiring.

## RED-first tripwire (mandatory) — recorded

Deliberate mutation of the terminal byte-path config: flipped
`convertEol: false` → `true` in `client/src/components/terminal/xterm-theme-options.ts`.

- **RED:** `a18-terminal-fences.test.ts` › "convertEol is false" FAILED, AND the
  existing byte-path fence `xtermAddons.test.ts` failed 2 assertions
  (`opts.convertEol` + captured factory options). Proves the tripwire fires on a
  byte-path regression.
- **Revert → GREEN:** `git diff` on the file = 0 lines; fence suite 8/8 green.

The full E2E byte-path guard (`terminal-byte-path-guard.spec.ts`, A00) is
UNMODIFIED. AC1 holds by construction: the outbound-frame producer
(`client/src/components/terminal/**`, `server/src/terminal/**`,
`useAutoLaunch.ts`, `useTerminalSocket.ts`, `client/package.json` xterm pins) is
byte-identical to `origin/main` (verified: `git diff origin/main` = 0 lines on
all of them).

## External LLM review (Step 3.5 plan / 3.7 code)

Provider openrouter (`external_review.py --mode code` over the diff). Gemini +
OpenAI both succeeded. Findings + dispositions:

| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| 1 | med (bug) | Keyboard splitter nudge mutates/persists saved widths during maximize (`hidden={compact}` omits `maxed`; key handlers unguarded) | **accepted-and-fixed** — `hidden={compact\|\|maxed}` + `if (layout.maximized) return` guards; new unit test proves widths unchanged after maximize+restore |
| 2 | high (test) | No-remount proof uses a generic sentinel, not a real-xterm spy; E2E absent | **accepted-and-fixed** — authored the mandated E2E flow (`files-terminal-three-card.spec.ts`, socket-open count proves same session); strengthened unit test with same-DOM-node identity across every transition. Rationale the sentinel is valid: it occupies the EXACT tree position the terminal would; the shell's reconciliation is position-based, identical for any child |
| 3 | med (spec) | AC3 fence lacked a replay envelope v2 / cell-state-only assertion | **accepted-and-fixed** — added replay fence: `useTerminalSocket.ts` gates on `env.type === "replay_snapshot"` + `terminalVersion`, no ACTIVE chunked-path gate |
| 4 | med (test) | windowsMode scan covered only 2 files | **accepted-and-fixed** — now recursively scans the whole `components/terminal/**` tree for the property assignment |
| 5 | med (spec) | No task-detail visual baseline in the diff (AC6) | **rejected-with-reason** — baseline regen is DELEGATED to the orchestrator (pinned Linux container); committing Windows-local PNGs is a known anti-pattern. Route named in result.json |
| G | low | Tab cross-fade (A20 motion) not implemented | **acknowledged** — spec explicitly permits shipping WITHOUT the fade when A20 tokens aren't present for this file rather than inventing a second easing scale |

## Self-Review (7-item)

1. **Spec Compliance** — PASS. Three cards + surfaces, greyed heads with
   segmented tabs, maximize reusing collapse, byte path untouched, provenance-honest
   (real FolderTree/terminal/SmartViewer, "Preview" placeholder). FR-01.62 in spec.md.
2. **Error Handling** — PASS. Focus context safe no-op default (no throw off-provider);
   resize() swallows registry-warmup; FolderTree error/empty states preserved.
3. **Security Basics** — PASS. No new inputs/routes; read-only observer; pty spawn
   whitelist untouched.
4. **Test Quality** — PASS. RED-first demonstrated; fence covers pins/convertEol/
   windowsMode(tree-wide)/spawn/replay-v2; no-remount unit (same-node + mount count);
   maximize hook + width-guard tests; E2E authored. Zero skips, nothing weakened.
5. **Performance Basics** — PASS. No new fetching/polling; transient maximize;
   memoised focus value; CSS-only reflow.
6. **Naming & Structure** — PASS. PaneSplitter/FocusModeToggle/focus-mode-context
   cohesive; every new/changed file ≤300 (page 644<676, shell 300, FolderTree 394<398);
   no dead code.
7. **Affected Boundaries (ADR-024)** — PASS. Serialized boundary = outbound WS frame
   to the pty. Producer = terminal/** + useAutoLaunch (UNTOUCHED, 0 diff); consumer =
   server pty. Round-trip probe = byte-path guard (E2E) + fence. Second boundary =
   localStorage layout; maximize is TRANSIENT (not serialized) — unit-verified it writes
   no new key and never clobbers collapse prefs.

## Confidence Calibration (empirical probes)

Trigger: complexity=medium AND touches_io_boundary (WS/pty adjacency).

- **Probe A (byte-path producer unchanged):** `git diff origin/main` over
  terminal/**, useAutoLaunch, useTerminalSocket, package.json → 0 lines. Finding: none.
- **Probe B (tripwire fires):** convertEol flip → fence + xtermAddons RED; revert → green.
  Finding: the fence bites.
- **Probe C (no remount):** unit test — same DOM node + 1 mount / 0 unmount across
  collapse/maximize/restore/drag. Second probe: E2E terminal-socket-open count stable
  across the same transitions. Two clean probes → asymptote reached.
- **Probe D (maximize width mutation):** external review found a real bug → fixed
  (hidden + guard) → re-probe (width-unchanged test) clean. Bug found → fixed → clean
  re-probe → asymptote reached.
- **Edge cases NOT probed + why acceptable:** (1) live-pty E2E RUN on the Windows
  runner — isolated-stack E2E is a delicate/infeasible recipe here (documented in
  memory) and E2E is not a CI gate; the flow is AUTHORED and the orchestrator runs it.
  (2) Visual baseline pixels — delegated to the orchestrator's pinned Linux container.

Asymptote reached: yes (byte-path + no-remount). The one bug (maximize width) was
fixed and re-probed clean.
