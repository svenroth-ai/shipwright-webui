# Mini-plan — A03 Weather-Deck design system (FR-01.48)

## Problem
Foundation for 15 later UI sub-iterates: port the prototype's Weather-Deck design
system (tokens + scene layer + glass + `.on-photo` flip/reset) into the webui and
enforce an AA contrast ladder. Get the tokens right or 15 sub-iterates inherit the
mistake.

## Approach
1. **Tokens** — `client/src/styles/weather-deck.css`: port the prototype `:root`
   (v3 + v3.1 verbatim in values), plus promoted `--beige`, plus two DERIVED
   composite grounds computed once from `deck-golden.jpg` (`--ground-glass-worst
   #FFF9F5`, `--ground-photo-worst #D5D3CE`). Expose to Tailwind via `@theme inline`
   referencing the `:root` tokens (no `:root` re-emit → legacy `--color-*` untouched).
2. **Scene layer** — `SceneBackdrop.tsx` reproduces `applyScene()` DOM contract
   (`.screen[data-scene=deck][data-depth=immersive]` > `.scene-bg > img` +
   `.scene-fore.on-photo`). Wired once in `MainLayout`; `.scene-fore` is the scroller
   and keeps the `main-scroll-container` testid + safe-area class. BACKDROPS map is
   the First-Contact/wizard seam. NO `data-scene-tier`, NO `data-depth=band`.
3. **Glass + flip/reset** — `on-photo.css`: `.glass-l/.glass-d/.glass-card/.btn-glass/
   .sheet` + `@supports` fallback; rule 1 flip (bare→light), rule 2 solid-surface
   reset (dark-on-white + shadow cancel), rule 3 darkened glass secondary. Plus the
   A03→A04 seam: within `.on-photo` only, `--color-bg/--color-background:transparent`
   so the opaque legacy pages let the backdrop show (the lever that makes "one
   backdrop on every route" visible before A04 harmonises `--color-*`).
4. **The AA ladder (primary)** — `tokens.contrast.test.ts`: WCAG-2.1 relative-lum,
   token×ground matrix parsed from the CSS, fails <4.5 body / <3 large. Proves the
   four Fable-B5 failures fixed/re-roled. Mutation drill: `--body`→`#9a948d` → RED.
5. **Guards** — `tokens.no-dead-vars.test.ts` (fallback-less `var(--x)` orphan guard,
   fixes `--font-mono`), `SceneBackdrop.test.tsx` (DOM contract + retracted-attr guard).
   AC2 flip+reset is a `@smoke` Playwright computed-style probe on `/` and `/tasks/:id`.
6. **Assets** — `client/public/backdrops/{deck-golden,lighthouse}.jpg` (deck verbatim
   174 KB; lighthouse 540→188 KB q96 progressive).
7. **Baselines** — all 8 routes regenerate via CI (pinned Linux container), NOT locally.

## Constraints
- `index.css` held at exactly 375 LOC (2 imports offset by 2 blank-line removals).
- New CSS/TS files ≤300 LOC; `shipwright_bloat_baseline.json` not ratcheted.
- Terminal xterm bytes/theme untouched (ADR-097 / FR-01.44).
- No Claude spawn, no run_config write, no hardcoded slash-commands (rules 1/12, DO-NOT #11).
