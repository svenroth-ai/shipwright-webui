# Iterate ADR — A03 Weather-Deck design system (FR-01.48)

- **Run ID:** iterate-2026-07-10-design-system-weatherdeck
- **Campaign:** webui-wow-usability-2026-07-10 · **Sub-iterate:** A03 (#4 of 22)
- **Complexity:** medium (confidence 0.75). Risk flags: touches_shared_infra,
  touches_public_api, touches_io_boundary. Enforcements: full_test_suite,
  mandatory_review, round_trip_test.
- **change_type:** feature · **spec_impact:** modify (FR-01.48 added; precedent FR-01.44).

## Decision

Port the prototype's Weather-Deck system (tokens + scene layer + glass + `.on-photo`
flip/reset) as the design foundation, and enforce an AA contrast ladder as the
primary, machine-checked deliverable. Key decisions:

1. **`@theme inline` (not plain `@theme`)** so the Tailwind utilities reference the
   `:root` prototype tokens and are NEVER emitted to `:root` — this is what keeps the
   legacy `--color-*` palette (23 files use `--color-accent`, 99 use `--color-muted`)
   unclobbered. A04 owns the `--color-*` → Weather-Deck alias re-point.
2. **Scene wired in `MainLayout` via `SceneBackdrop`**, reusing the existing
   `main-scroll-container` scroll role (renamed onto `.scene-fore`, testid + safe-area
   class preserved). The app never used body/window scroll or `position:sticky`, so
   scroll semantics are unchanged.
3. **A03→A04 seam:** within `.on-photo` only, `--color-bg`/`--color-background` flip
   transparent so the opaque legacy pages let the one signature backdrop show — the
   single lever that makes AC3/AC5 visible before A04 harmonises `--color-*`.
4. **Composite grounds are DETERMINISTIC** (global-mean glass, max-under-scrim photo),
   derived by a committed script tied to the shipped asset — see Confidence Calibration.
5. **`--faint` re-roled NON-TEXT** (2.52:1); rule 3 darkens it to a readable #6B645D
   (5.1:1) specifically for glass secondary text.

## Self-Review (ADR-029 Step 3.6 — 7-item checklist)

1. **Spec Compliance — PASS.** All 7 ACs addressed: AC1 machine-checked ladder (bites),
   AC2 flip+reset E2E, AC3 scene + retracted-attr guard, AC4 dead-token guard (bites),
   AC5 baselines (via CI round-trip), AC6 no fabricated data, AC7 footprint held.
2. **Error Handling — PASS.** `SceneBackdrop` falls back to a default backdrop for
   unknown routes; guards throw loudly on a missing token (never silently pass).
3. **Security Basics — PASS.** Pure CSS/asset/DOM; no new write surface, no Claude
   spawn, no run_config write, no hardcoded slash-commands (rules 1/12, DO-NOT #11).
   Backdrop `<img>` is `alt=""` decorative; only the two approved assets ship.
4. **Test Quality — PASS.** Both guards proven to BITE via mutation drills (recorded
   below); the contrast test parses live CSS values so a bad token edit fails.
5. **Performance Basics — PASS.** Photo plate is `position:absolute` + frozen; only
   `.scene-fore` scrolls (no repaint-on-scroll). `loading="lazy" decoding="async"`.
6. **Naming & Structure — PASS.** Tokens ported verbatim in values + order; files split
   to keep each ≤300 LOC; index.css held at exactly 375.
7. **Affected Boundaries (ADR-024) — PASS.** Producer = derivation script + asset;
   consumer = contrast test + built CSS. Real round-trip probe run (Confidence
   Calibration below). `@theme inline` collision boundary probed empirically.

## External-Plan-Review-Findings (Step 3.5 · openrouter gemini+openai)

| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| P1 | High | Moving scroll to `.scene-fore` breaks window-scroll/sticky | rejected-with-reason: app never used body/window scroll or `position:sticky` (grep-verified); `.scene-fore` inherits the pre-existing `main-scroll-container` role + testid |
| P2 | Med | Don't parse the ladder matrix from CSS (brittle) | accepted-and-fixed: structure is a hardcoded typed array; only token HEX VALUES are regex-parsed (CSS coupling → mutation drill bites) |
| P3 | Med | JSDOM getComputedStyle won't resolve var chains | n/a: the vitest computes WCAG from parsed hex in pure TS; getComputedStyle is only in the Playwright E2E (real Chromium) |
| P4 | Med | Transparency swap → legacy legibility loss | accepted: intermediate state, documented; mandatory baseline eyeball catches unreadable routes (A05 redoes) |
| P5 | Low | Verify Tailwind v4 for `@theme` | verified: `@tailwindcss/vite` + `tailwindcss` ^4.0.0 |
| P6 | High(oai) | Prove existing UI stops using `--faint`/opacity, not just tokens | accepted-with-reason: A03 ships the systemic token/ladder job; per-component application is A05(brand)/A16(triage)/A18(terminal) scope, which the ladder gates |
| P7 | Med(oai) | Audit route coverage + dynamic `/tasks/:id` matching | accepted-and-verified: router audited (all app routes under MainLayout; `/preview` deliberately excluded); first-segment routeKey handles `/tasks/:id` |
| P8 | Med(oai) | Composite grounds must be reproducible/committed | accepted-and-fixed: committed `derive-weather-deck-grounds.py`, made deterministic (global-mean) — see Confidence Calibration |

## External-Code-Review-Findings (Step 3.7 external · openrouter)

| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| C1 | High | Backdrop assets missing | rejected: FALSE POSITIVE — both jpgs staged (deck 178457, lighthouse 192242, ≤250 KB); excluded from the review TEXT diff (`:!*.jpg`) |
| C2 | High | photo-worst body text ~1.5:1 not in passing ladder | rejected-with-reason: photo-worst is a DECLARED NON-TEXT ground ("solid is for reading, bare text only in scrim bands"); the test proves the boundary (light text fails → text rides chrome) |
| C3 | High | glass-worst from mean, spec said brightest region | accepted-with-reason: deviation deliberate + documented; brightest region clips to #FFF (trivial best-case for the dark text glass carries); global-mean is deterministic, reproducible, and MORE protective (base --muted fails at 4.22 → forces the darkened tokens) |
| C4 | High | on-photo/glass tokens hardcoded, not CSS-checked | accepted-and-fixed: `.on-photo` accent + rule-3 glass secondary now PARSED from on-photo.css (block-isolated); terminal #131110/#f2f0ec remain documented A18 ladder contracts (not in A03 CSS) |
| C5 | Med | `--faint` listed as glass "body" conflicts with non-text re-role | accepted-and-clarified: base --faint (#A8A29E) is NON-TEXT; rule 3 DARKENS it to #6B645D (5.1:1) — the fix, not a conflict; rung renamed |
| C6 | Med | `--focus` token defined but no `:focus-visible` applies it | deferred-to-A05-with-reason: `--focus` + on-photo `--focus` shipped; global focus-ring application is A05 chrome scope (a blanket `:focus-visible` is an app-wide behavioural change beyond A03's backdrop foundation) |
| C7 | Med | AC2 injects synthetic nodes, not real elements | accepted-with-reason: current pages predate the `.card` token system; the probe exercises the REAL ported cascade in the live `.on-photo` container; real-element assertions land with A05 |
| C8 | Med | Visual baselines not regenerated in the diff | accepted-and-planned: regenerated via visual-baselines.yml post-push (the mandated pinned-container round-trip); named in PR body |

Internal code-review cascade (spec-reviewer → code-reviewer → doubt-reviewer):
**delegated_to_orchestrator** (campaign constraint 3).

## Confidence Calibration (ADR-029 Step 3.8 — empirical, touches_io_boundary)

Boundary: asset → derivation → committed CSS constant → contrast-test consumer, plus
the `@theme inline` legacy-collision boundary and the built-CSS output boundary.

- **Probe 1 — round-trip (producer→file→consumer):** `derive-weather-deck-grounds.py`
  run against the SHIPPED `deck-golden.jpg` outputs `--ground-photo-worst #D5D4CF` and
  `--ground-glass-worst #F9EFE5`, EXACTLY matching the committed CSS constants the
  contrast test consumes. **Finding (during design):** the first cut used a grid-
  dependent MEDIAN pixel (#FFF9F5) that changed with the sampling stride → FIXED to a
  deterministic global-mean basis → re-probed clean.
- **Probe 2 — `@theme inline` collision:** built `:root` carries `--color-accent:#857568`
  (legacy intact), NOT teal — empirically confirming the collision-safety of the design
  bet that 23 `--color-accent` consumers are untouched. No finding.
- **Probe 3 — built output:** the fresh dist carries `--ground-glass-worst:#f9efe5`, the
  scene layer (`.scene-bg{…}`), the on-photo transparentization, and NO
  `data-scene-tier`/`data-depth="band"`. No finding.
- **Guard bite probes:** `--body`→#9a948d → contrast test RED (`--body body/card` 3.00);
  `var(--nope)` → dead-var guard RED. Both reverted.
- **Asymptote:** the one design-time finding (median non-determinism) was fixed and
  re-probed; Probes 2/3 + the guard drills found nothing further → boundary calibrated.
- **Edge cases NOT probed (acceptable):** live-browser transcript auto-scroll under
  `.scene-fore` (DO-NOT #2) — cannot run a browser locally on Windows; mitigated because
  `.scene-fore` is the SAME nested scroll role as the prior `main-scroll-container` and
  the transcript keeps its own inner scroller; the AC2 `@smoke` E2E + the CI baseline
  eyeball are the runtime check. Legacy-page legibility under the transparency swap is
  verified at the CI baseline-review step, per AC5.
