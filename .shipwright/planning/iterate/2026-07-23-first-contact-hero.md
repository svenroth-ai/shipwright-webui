# Iterate Spec: first-contact-hero

- **Run ID:** iterate-2026-07-23-first-contact-hero
- **Type:** feature
- **Complexity:** medium
- **Status:** draft

## Goal
Build the dedicated **First Contact hero** — the first screen a brand-new user sees
right after `npx @svenroth-ai/shipwright@latest` installs and opens the browser.
Today there is NO First Contact screen: `/` renders the Task Board (whose only
first-run affordance is a minimal zero-*tasks* empty state), and the three-door
picker + readiness gate live only inside `/wizard`. First Contact is the
**hero-framed** presentation of that same door picker: the lighthouse hero image,
the "Welcome to the Command Center / Say what you want. A competent room takes it
from here." copy, the three doors, the readiness gate, and the register-manually
line. Follow-up to iterate-2026-07-23-intent-launcher-front-door (PR #320), which
made the guided Intent Wizard the reachable front door of every create surface and
named "First Contact hero (Iterate B)" as its sibling.

Design SSoT (read verbatim): `Spec/prototype/screens/firstContact.js`,
`Spec/prototype/assets/lighthouse.jpg` (already shipped, optimized, at
`client/public/backdrops/lighthouse.jpg`), `Spec/prototype/README.md` §"First
contact" + the v3 "First Contact: lighthouse hero" note.

## Acceptance Criteria
- [ ] **AC1** — A `FirstContact` screen renders the lighthouse hero with the eyebrow
  "Welcome to the Command Center", the h1 "Say what you want. / A competent room
  takes it from here.", the lead paragraph, the **three canonical doors** (Build
  something new · Bring Shipwright to an existing repo · Grade your repo), the
  readiness gate, and the "Register a project manually…" line — all sourced from the
  SAME components the wizard uses (no duplicated doors/readiness copy).
- [ ] **AC2** — The three doors **deep-link into the wizard flow**: Build new →
  `/wizard`, Adopt → `/wizard/adopt`, Grade → `/wizard/grade`. The register-manually
  line → `/projects?new=1` (inherited from the shared door primitive).
- [ ] **AC3** — The readiness **gate** is reused, not rebuilt: when the environment
  is not ready the three doors are inert (disabled `<button>`, `aria-disabled`) and
  the gate names each missing prerequisite + the one repair command. When ready the
  doors navigate.
- [ ] **AC4** — At the root route `/`, when the Command Center is **genuinely empty**
  — zero registered projects AND zero tasks — the user lands on First Contact instead
  of the board; once **≥1 project OR ≥1 task** exists, `/` is the Task Board as normal.
  (A user with zero registered projects but genuinely-unassigned/discovered tasks must
  keep the board — those tasks are reachable only there; doubt-review.) A still-loading
  or errored projects/tasks read renders the board (its own skeleton), never a blank
  screen and never a redirect of an existing user to First Contact.
- [ ] **AC5** — A permanent `/first-contact` route always renders First Contact
  (revisitable + testable without wiping the registry), and it carries the
  **lighthouse** backdrop with the left-weighted scrim — First Contact is exempt
  from the deck-golden signature backdrop.
- [ ] **AC6** — Under `prefers-reduced-motion: reduce` the hero renders its COMPLETE
  final state (all copy + doors present, opaque, in position) — content is never
  hidden-then-revealed (CLAUDE.md A20). First Contact ships with no entrance motion.

## Spec Impact
- **Classification:** modify
- **ADD:** none
- **MODIFY:** `FR-01.51` (FDR — Intent wizard). First Contact hero-frames the SAME
  three-door picker + readiness gate for the fresh-install / empty-registry case.
  MINT-vs-FOLD gate → **FOLD**: it is not a new capability but the first-run
  presentation of the already-built front door (reuses DoorPicker's doors + readiness
  verbatim), consistent with its sibling deltas FR-01.52/53 and the prior iterate's
  own "First Contact hero (Iterate B)" note. Mint delta-row **FR-01.69 → FR-01.51
  (delta)** in the FR-Fold-Map (next free id; 67/68 are Mission deltas), and append
  the First Contact hero to FR-01.51's `**Updates:**` line. F5b FR gate declares the
  SURVIVOR id = **FR-01.51**; tests `@covers FR-01.51`.
- **REMOVE:** none
- **NONE justification:** n/a

## Out of Scope (deferred by Sven)
- The board's left Campaign/Pipeline orchestration rail and the pipeline view.
- The bail affordance.
- Re-styling the doors as the prototype's dark-glass `.fc-door` panels — the
  converged decision is to REUSE the wizard's white `.wz-opt` door cards (single
  source), framed by the lighthouse hero. Pixel-parity of the doors themselves is a
  deliberate non-goal; the hero (image + copy + scrim) is the faithful part.
- The prototype's `__fcDemo` / `__fcBroken` readiness demo toggle — deliberately
  removed, guarded by `noFcDemo.test.ts`; MUST NOT be reintroduced.

## Design Notes / Approach
- **Shared primitive extraction.** The doors + register-manually line + readiness
  gate are extracted verbatim from `DoorPicker.tsx` into a new `DoorGrid.tsx`
  (returns a Fragment). `DoorPicker` becomes `StepDots + h1 + hint + <DoorGrid>` —
  its rendered DOM + testids are BYTE-IDENTICAL, so every existing wizard test stays
  green. `FirstContact` renders `heroCopy + <DoorGrid>`. This honours "reuse the
  doors/readiness, don't duplicate" as a single source both consumers share.
- **Door → route.** A small `doorRoute(id)` helper reads `DoorDef.route`.
  FirstContact's `onPickDoor` navigates there; the wizard's dispatches into the
  reducer — same callback contract, different consumer intent (Rule 1: navigation
  only, no Claude spawn). It lives LOCALLY in `FirstContact.tsx` rather than beside
  `doorLabel` in `stubData.ts`: that stub file is already at the 300-LOC ceiling, and
  the +6-line helper would ratchet a new bloat crossing — the local helper is the
  YAGNI-correct home for its single caller (both reviews noted the split; this is the
  reasoned choice).
- **Backdrop.** Add `'first-contact': { img: 'lighthouse.jpg', well: true }` to
  `SceneBackdrop` BACKDROPS — the documented seam ("lighthouse.jpg plugs into" when
  A08 builds the route). `routeKey('/first-contact') → 'first-contact'`. The
  `.well-left` scrim (`linear-gradient(90deg, .72→.28)`) is the wizard's own proven
  hero scrim, so DoorGrid-over-scrim legibility is already shipped.
- **Root trigger.** New thin `RootRoute` component at the index route: `useProjects()`
  → loading renders null → a SUCCESSFUL empty registry (no `!synthesized`,
  non-`unassigned` project) renders `<Navigate to="/first-contact" replace>` (so the
  lighthouse backdrop resolves correctly) → otherwise `<TaskBoardPage>`. An
  error/undefined result falls back to the board (never redirect an existing user on
  a transient failure).
- **Hero copy** lives in `first-contact.css` (white-on-photo literals, matching the
  prototype `.fc-in` / intent-wizard.css precedent — the no-hardcoded-colours guard
  scans `.ts/.tsx` only). Static, no entrance animation (reduced-motion-safe).
- **In-shell, not full-bleed (decision).** First Contact mounts INSIDE `MainLayout`
  (sidebar + diagnostics banner stay), like its sibling `/wizard` — the scope says
  render it "instead of the board", and the board is in-shell. The sidebar is a
  harmless secondary affordance a fresh user can use to reach Diagnostics/Settings;
  a full-bleed pop-out (like `/preview`) is a deliberate non-goal (plan-review LOW).
- **Accepted: one deck-golden fetch on the fresh-install `/` (decision).** The
  client-side redirect means `/` briefly resolves the board's deck-golden plate
  before landing on `/first-contact` (lighthouse). Special-casing SceneBackdrop for
  `/` would couple the backdrop to the registry — a worse trade. Accepted as the
  inherent, once-ever cost of the redirect design (doubt-review LOW).

## Affected Boundaries
No serialized producer/consumer format changes. `GET /api/readiness` and
`GET /api/projects` are READ-only, pre-existing, and already consumed. Navigation
only (`/wizard*`, `/projects?new=1`, `/first-contact`). `n/a` — no env/JSON
round-trip is introduced; `touches_io_boundary` did not fire.

| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| n/a | n/a | n/a |

## Confidence Calibration
- **Boundaries touched:** none (UI navigation + component reuse only). Reads the
  pre-existing `/api/readiness` + `/api/projects` + `/api/external/tasks` GET surfaces;
  writes nothing. `touches_io_boundary` did not fire.
- **Empirical probes run:**
  1. Full client vitest — **3036 passed / 326 files** (incl. the unchanged IntentWizard
     suite running THROUGH the extracted DoorGrid → extraction proven behavior-preserving).
  2. `tsc --noEmit` — clean. `oxlint` — clean (no new warnings).
  3. F0.5 isolated empty-registry stack (real Chromium): `/api/projects => {"data":[]}`,
     `/api/readiness.ready => true`, **3/3** tests pass; `surface_verification.py` exit 0.
  4. Backdrop resolution verified in-DOM: `SceneBackdrop.test` asserts `/first-contact`
     → `/backdrops/lighthouse.jpg` + `well-left`.
- **Test Completeness Ledger:**

  | # | Testable behavior | Disposition | Evidence / reason_code |
  |---|---|---|---|
  | 1 | Hero renders eyebrow + h1 + lead copy | tested | FirstContact.test PASSED |
  | 2 | Hero renders the three canonical doors + register line | tested | FirstContact.test PASSED |
  | 3 | Door deep-links: new→/wizard, adopt→/wizard/adopt, grade→/wizard/grade | tested | FirstContact.test (it.each) + F0.5 PASSED |
  | 4 | Register-manually line → /projects?new=1 | tested | FirstContact.test PASSED |
  | 5 | Not-ready → doors inert + gate names the repair | tested | FirstContact.test PASSED |
  | 6 | Reduced-motion → complete opaque final state | tested | FirstContact.test PASSED |
  | 7 | Root: 0 projects AND 0 tasks → First Contact | tested | RootRoute.test + F0.5 PASSED |
  | 8 | Root: ≥1 real project → board | tested | RootRoute.test PASSED |
  | 9 | Root: 0 registered projects but tasks exist → board | tested | RootRoute.test PASSED |
  | 10 | Root: loading → board (no blank) | tested | RootRoute.test PASSED |
  | 11 | Root: errored/undefined → board (no redirect) | tested | RootRoute.test PASSED |
  | 12 | /first-contact always renders (any stack) | tested | F0.5 PASSED |
  | 13 | SceneBackdrop /first-contact → lighthouse + well-left | tested | SceneBackdrop.test PASSED |
  | 14 | DoorPicker→DoorGrid extraction is behavior-preserving | tested | IntentWizard suite (79) PASSED |
  | 15 | E2E empty root → First Contact; door → wizard flow | tested | F0.5 surface_verification (real Chromium) |

- **Confidence-pattern check:** asymptote (depth) — the doubt-review surfaced ONE real
  depth gap (a zero-registered-projects user with genuinely-unassigned tasks was being
  stranded on First Contact); it is FIXED (trigger now requires 0 tasks too) and pinned
  by ledger row 9, so no "confident→later-finding" loop remains. coverage (breadth) — all
  15 behaviors `tested`, 0 untested-testable. integration composition — n/a (no
  `cross_component` machinery; the DoorGrid reuse is exercised end-to-end by the full
  wizard suite + the F0.5 door-nav test).

## Verification (medium+)
- **Surface:** web
- **Runner command:** isolated built-client stack (temp USERPROFILE = empty
  registry, plugin-cache canary seeded so readiness is ready = the real fresh-install
  state) + Playwright smoke: empty-stack `/` → First Contact hero visible; a door →
  the wizard flow; `/first-contact` always renders. Wrapped in `surface_verification`
  as `bash <wrapper>`.
- **Evidence path:** `.shipwright/agent_docs/iterates/<run_id>` + F0.5 surface block.
- **Justification (only if surface=none):** n/a — a startable web surface exists.
