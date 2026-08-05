# Iterate: permanent real-browser coverage for Mermaid rendering

- **Run ID:** iterate-2026-07-29-mermaid-real-render-e2e
- **Intent:** CHANGE (test-coverage hardening)
- **Complexity:** small (risk flag `touches_build`, raised mid-run — see below)
- **Spec Impact:** NONE — adds coverage; changes no shipped behaviour and no
  product surface.
- **Origin:** follow-up left over from the 2026-07-28 dependency triage
  (`iterate-2026-07-28-security-accepted-risk-register`), Part 2 of 2.

## Problem

`client/src/components/external/SmartViewer/MermaidRenderer.test.tsx` stubs the
library outright with `vi.mock("mermaid")`, returning a canned `<svg>` string,
and there was no e2e coverage either. The client suite was therefore
STRUCTURALLY blind to a rendering regression.

That matters because mermaid draws through a sanitizer dependency (DOMPurify):
a routine patch bump of *either* package can change or break diagram output
while every existing test stays green. During the 2026-07-28 triage a DOMPurify
bump had to be verified by an ad-hoc probe, because nothing committed to the
repo could catch it.

## Acceptance Criteria

- **AC-1** A committed test renders a real diagram with the REAL mermaid and the
  REAL sanitizer in a real browser.
- **AC-2** Assertions are ABSOLUTE, not differential: svg present, output
  length, pixel dimensions, every node label, zero surviving script elements,
  zero console errors.
- **AC-3** The test runs in the CI gate. A dependency bump lands as a
  lockfile-only PR touching no `client/src` file, so coverage outside the gate
  reproduces the blindness this iterate exists to end.
- **AC-4** The harness renders under the SAME `securityLevel` the app uses, and
  that agreement is ENFORCED rather than copied.
- **AC-5** Falsified at least once by degrading the render — a probe that cannot
  fail proves nothing.

## Implementation

| File | Lines | Role |
|---|---|---|
| `client/e2e/flows/mermaid-real-render.spec.ts` | 278 | 6 tests, tagged `@smoke` so `E2E smoke (gate)` collects them |
| `client/e2e/helpers/mermaid-diagrams.ts` | 159 | the four diagram cases + every measured value and floor |
| `client/e2e/helpers/mermaid-bundle.ts` | 101 | esbuild Node API, `stdin.resolveDir = client/` |
| `client/e2e/helpers/page-errors.ts` | 48 | `watchForErrors` + `flushPageEvents` |
| `client/src/test/mermaid-security-level.test.ts` | 90 | the AC-4 drift guard, as a vitest meta-test |
| `client/package.json` + lockfile | +1 / +65 | declares `esbuild` as a devDependency |

The esbuild NODE API is required, not the CLI: `stdin.resolveDir` is the only
way to make the bare specifier `mermaid` resolve from `client/`, and the CLI has
no `--resolve-dir` flag. The bundle is loaded into Chromium via
`page.addScriptTag` on a self-authored blank document — no app route, no
fixture, no SmartViewer state machine that could fail first and mask the answer.

The AC-4 drift guard lives in the vitest meta-test family rather than in the
spec (CR-4): it is a pure source read, and filing it there also puts it in the
fast `Client (type + lint + test)` PR gate rather than only behind the container
job. It guards BOTH drift directions and is anchored on the `.initialize(` call
rather than the bare word, so it cannot pass by matching a comment.

**Risk-flag note (`touches_build`).** Declaring `esbuild` raises the flag, which
enforces the performance-test layer. Skip-rules apply as written: no `dev_url`
is running, so Lighthouse is skipped; and the package is a dev-only
devDependency that `client/tsconfig.json` (`rootDir: ./src`) structurally
excludes from the production build. The bundle gate was checked directly —
`npm run build` succeeds and the lockfile adds **no** new `node_modules/esbuild`
entry (0.25.12 was already present as a Vite transitive, `dev: true`), so the
installed tree is byte-identical and no bundle-size delta is possible.
`npm install --package-lock-only` also re-materialised 64 lines of previously
omitted optional `@tailwindcss/oxide-wasm32-wasi` entries — incidental npm
normalisation, left as npm produced it rather than hand-edited.

## What this does NOT cover

Stated up front because an adversarial review showed the first draft's claim was
**overstated**, not false. Written into the spec header too, so it travels with
the code:

1. **Four diagram types, not all 21.** Mermaid ships each type in its own lazily
   imported chunk (38 loaders in `mermaid.core.mjs`), so each is a separate
   failure surface. The first draft rendered only a flowchart. Four independent
   chunks is a real improvement; a bump breaking gantt or mindmap still passes.
2. **The esbuild path, not the Vite path.** The app loads mermaid through
   Vite/Rollup lazy chunks; this bundles everything into one IIFE. A Rollup-only
   runtime failure — chunk-init order, circular-dep TDZ, hashed-chunk delivery —
   would show users "Mermaid failed to render" with this gate green. CI's
   `npm run build` catches the build-time half of that class; the runtime half
   is genuinely uncovered.
3. **It cannot prove the securityLevel-GATED sanitize ran.** Mermaid calls
   DOMPurify unconditionally for label text, and additionally — only when the
   level is not `"loose"` — for the finished SVG. Rendering at `"strict"` and at
   `"loose"` was MEASURED to produce near-identical output (identical
   dimensions, identical foreignObject and dominant-baseline counts, ~0.4% char
   delta), so no output assertion can distinguish them. AC-4 therefore buys
   harness FIDELITY (the harness cannot silently diverge from the app's config),
   not verification of the gated call. The ADD_TAGS/ADD_ATTR assertions do
   establish that those options are honoured.

## Confidence Calibration

- **Boundaries touched:** none. No serialized format is produced or consumed;
  `MermaidRenderer.tsx` is read as source TEXT for the drift guard only. The
  `touches_io_boundary` flag did not fire, so no round-trip probe is due.
- **Empirical probes run:**
  1. *Recipe viability* — esbuild(stdin.resolveDir) → addScriptTag → render
     works; ~240 ms bundle (7.9 MB, memoised per worker), ~50 ms/render.
  2. *Measured ladder, through the SHIPPED render ids.* Mermaid prefixes every
     rule of its injected `<style>` with the render id, so the char count scales
     with the id string; a first ladder measured under different ids was off by
     ~1.1 kB — the entire margin such an assertion trades in. Re-measured with
     the exact ids the spec uses.
  3. *Which diagram emits what* — `dominant-baseline` appears 7× in the sequence
     diagram and **0×** in the flowchart; `foreignObject` 10× in the flowchart
     and 0× in the sequence. A flowchart-only suite could not see an `ADD_ATTR`
     regression at all.
  4. *strict vs loose* — measured identical dimensions and survivor counts, which
     is the evidence behind limitation 3 above.
  5. *Sanitizer is reached* — the `<script>` payload is stripped INSIDE
     `mermaid.render()`: the raw returned string carries no `<script`, so the
     credit belongs to mermaid's sanitizer, not the browser's parser.
- **Test Completeness Ledger:** below.
- **Confidence-pattern check:**
  - *Asymptote (depth)* — every assertion class was degraded and observed red
    (falsifications A–E below). Three assertions were found VACUOUS across the
    review rounds and were removed or replaced rather than kept as decoration.
  - *Coverage (breadth)* — four diagram types / four mermaid chunks, happy path,
    adversarial payload path, sanitizer-config path, bundle-failure path,
    dependency-resolution path, config-drift path.
  - *Integration composition* — n/a: `cross_component` did not fire.

### Falsifications

| # | Degradation | Observed |
|---|---|---|
| A | Cut the flowchart to fewer nodes | Ladder, measured under this spec's own ids: 1 node 10 889 chars / 161x70 px · 2 nodes 12 440 / 179x283 · 3 nodes 14 054 / 209x411 · real 17 674 / 436x515. Goes red. The FIRST attempt used an 8 000-char floor and passed a one-node render — mermaid's CSS block alone is ~4.5 kB. |
| B | Swap DOMPurify for an identity passthrough | `<script` survives `mermaid.render()` verbatim: `rawHasScriptTag` true, 1 script element in the DOM (real: false / 0). Flipping `securityLevel` to `"loose"` does NOT falsify — see limitation 3. |
| C | Inject a top-level throw into the bundle | Reports `mermaid bundle did not evaluate; page errors: pageerror: deliberate bundle failure` instead of `Cannot read properties of undefined`. |
| D | Expect two DOMPurify packages | Fails naming the one real root `…/client/node_modules/dompurify/`, proving the metafile scan is wired to reality. |
| E | Make DOMPurify ignore `ADD_TAGS`/`ADD_ATTR` (still sanitizing correctly) | flowchart `foreignObject` 10 → **0**; sequence `dominant-baseline` 7 → **0**. Both new assertions go red. **Char count fell only to 15 029 against a 15 000 floor — 29 characters of margin**, so the char floor alone would NOT have caught this. That is why the structural assertions exist. |

### Test Completeness Ledger

| # | Behaviour introduced | Disposition | Evidence |
|---|---|---|---|
| 1 | Real mermaid renders four diagram types in a real browser | `tested` | 4 parametrised tests over `DIAGRAM_CASES`; falsification A |
| 2 | Output length / width / height meet per-diagram absolute floors | `tested` | same; floors measured through the shipped render ids |
| 3 | Every declared label is drawn, per diagram | `tested` | same; `<style>` stripped from a clone so a CSS match cannot pass a label |
| 4 | mermaid injects nothing executable on a clean input | `tested` | same — belt-and-braces only; these inputs carry no payload, so SANITIZER coverage is row 7's |
| 5 | `ADD_TAGS: ["foreignobject"]` is still honoured | `tested` | `minForeignObjects`; falsification E (10 → 0) |
| 6 | `ADD_ATTR: ["dominant-baseline"]` is still honoured | `tested` | `minDominantBaseline` on the sequence diagram; falsification E (7 → 0) |
| 7 | A script payload in a node label is stripped INSIDE `render()` | `tested` | sanitizer test; falsification B |
| 8 | Over-stripping is a regression too (safe text survives) | `tested` | same test asserts `safe-label-token` + `Downstream` survive |
| 9 | Exactly ONE DOMPurify package, resolved by MERMAID | `tested` | metafile package-root scan; the bundle entry imports only mermaid, so the count is mermaid's own; falsification D |
| 10 | esbuild emits no warnings while bundling mermaid | `tested` | `bundleWarnings` assertion — esbuild warns rather than throws on an unfollowable dynamic import |
| 11 | Harness `securityLevel` matches the component's, both directions | `tested` | `mermaid-security-level.test.ts`; falsified by flipping the harness constant |
| 12 | `render()` producing no `<svg>` reports as data, not a null deref | `tested` | `svgPresent` guard + assertion (self-review item 2) |
| 13 | A trailing console error cannot be missed by the assertion | `tested` | `flushPageEvents` precedes every `errors` assertion (EC-1); uses `setTimeout` not rAF so it cannot hang (S1-6) |
| 14 | A bundle that throws at evaluation time reports its OWN error | `tested` | bundle-load assertion; falsification C |

Untested-testable: **0**. No `untestable` rows.

## External-Code-Review-Findings

`external_review.py --mode code`, provider openrouter, 2 legs, `degraded: false`.

| # | Severity | Finding | Disposition |
|---|---|---|---|
| EC-1 | low (gemini) | `expect(errors).toEqual([])` runs the instant `page.evaluate()` resolves; console/pageerror are asynchronous CDP events, so a trailing error can be missed — a FALSE GREEN. | **accepted-and-fixed** — `flushPageEvents()` before every `errors` assertion. |
| — | — | openai leg: "No concrete defects found… ship-as-is", `SHIPWRIGHT_VERDICT: approve`. | no action |

## Internal-Review-Findings (three-stage cascade)

**Stage 1 `spec-reviewer` — REJECT, then PASS on re-review.**

| # | Finding | Disposition |
|---|---|---|
| S1-1 | The record stated 266 lines while the delivered file was 286, advertising headroom under the 300-line cap that did not exist. | **accepted-and-fixed** — and the condition fixed, not just the number: the file was split. Delivered counts are now in the Implementation table and restated whenever they move. |
| S1-2 | `esbuild` and `dompurify` are imported by first-party code but declared nowhere; they resolve only via npm hoisting / an `overrides` pin. | **`esbuild` accepted-and-fixed** (declared devDependency). **`dompurify` rejected-with-reason**: declaring it could bind OUR hoisted copy while mermaid used a nested one, leaving the assertion green against a sanitizer mermaid never calls. Undeclared makes the bad case LOUD (the build throws); declared makes it QUIET. `esbuild` is the instrument, `dompurify` is the subject — different roles, different answers. The reviewer was asked to break this reasoning and could not. |
| S1-3 | The height floor had the thinnest margin on the one font-metric-driven axis, justified by a char-length argument that does not transfer to pixels. | **accepted-and-fixed** — per-diagram floors, each stated as headroom against a measured value. |
| S1-4 | `reviews.json` records EC-1 with `disposition: null`; an empty `reviews.json.lock` sits in the run directory. | **accepted** — dispositions live in these tables; the lock file is excluded at F6 (per-path staging, never `git add -A`). |
| S1-5 | The third test is a pure `readFileSync` check yet paid the full `beforeEach`. | **accepted-and-fixed** — superseded by CR-4. |
| S1-6 | `flushPageEvents` relied on `requestAnimationFrame`, which does not fire on a backgrounded page — a future config change would make it TIME OUT rather than fail. | **accepted-and-fixed** — `setTimeout(…, 0)`. |

**Stage 2 `code-reviewer` — sound, four low findings, no blockers.**

| # | Finding | Disposition |
|---|---|---|
| CR-1 | `addScriptTag` resolves even when the inline script throws at evaluation time, so a broken bundle detonated as `Cannot read properties of undefined` with the real cause unread in `errors`. | **accepted-and-fixed** — bundle-load assertion interpolating the captured page errors. Falsification C. |
| CR-2 | `sanitizerPresent` was VACUOUS and its message over-claimed a one-instance property it could not see. | **accepted-and-fixed** — replaced with an esbuild `metafile` scan. Then Stage 3 showed the replacement was *also* unattributable; see D-4. |
| CR-3 | Test 1's script assertions hold for any sanitizer (no payload in the input), yet comment and ledger credited them with sanitizer coverage. | **accepted-and-fixed** — claim downgraded in both places. |
| CR-4 | The securityLevel drift guard is a pure source scan filed in the Playwright suite; this repo has a documented vitest meta-test family for that shape. | **accepted-and-fixed** — moved to `client/src/test/`, now also in the fast PR gate. |

**Stage 3 `doubt-reviewer` (advisory-must-address) — 11 doubts, 2 high.**

| # | Sev | Doubt | Disposition |
|---|---|---|---|
| D-1 | high | Only a flowchart is rendered; mermaid ships each diagram type in its own chunk, so a bump breaking sequence/class/state/gantt passes green. | **accepted-and-fixed** — four types (flowchart, sequence, class, state) = four independent chunks. Residual (17 further types) recorded under "What this does NOT cover". |
| D-2 | high | AC-4 pins a literal whose only render-path effect is the securityLevel-GATED sanitize, which no assertion can see (strict and loose render the same). | **accepted, scope corrected** — measured strict vs loose (identical dimensions and survivor counts, ~0.4% char delta) and wrote the limitation into both the record and the spec header. AC-4 is now claimed as harness FIDELITY only. Partially mitigated by D-6's ADD_TAGS/ADD_ATTR assertions. |
| D-3 | med | esbuild IIFE inlines mermaid's dynamic imports; the app uses Vite/Rollup lazy chunks, so a Rollup-only runtime failure passes green. | **accepted, documented** — stated as limitation 2 rather than papered over. Building a second app-route harness is real scope beyond this card; `npm run build` in CI covers the build-time half. |
| D-4 | med | The one-DOMPurify guard could not attribute the import to mermaid, because the harness entry imported `dompurify` itself — CR-2's defect one level up. | **accepted-and-fixed** — the entry now imports ONLY mermaid, so the count is mermaid's own resolution and is load-bearing in both directions (0 = dropped/vendored, 2 = duplicate). Verified: the count is still exactly 1 without the harness import. |
| D-5 | med | The guard counted module FILES, so a DOMPurify release splitting its ESM output would turn a REQUIRED gate red on a healthy tree. | **accepted-and-fixed** — deduped to distinct package ROOTS. |
| D-6 | med | `ADD_ATTR: ["dominant-baseline"]` was not exercised at all: the flowchart emits zero. | **accepted-and-fixed** — the sequence diagram asserts it, and the flowchart/class/state assert the `ADD_TAGS` foreignObject survivors. Falsification E flips both to 0. |
| D-7 | low | `logLevel: "silent"` with `result.warnings` never inspected — the harness discarded the bundler's diagnostics about the very dependency it watches. | **accepted-and-fixed** — `bundleWarnings` is asserted empty. |
| D-8 | low | The "~240 ms / ~50 ms" cost claim omits shipping the 7.9 MB IIFE once per test, plus trace capture on retry. | **accepted, corrected** — the per-test cost is stated here and the measured suite time is 3.3 s for 6 tests. The bundle is still memoised per worker; retaining it is deliberate. |
| D-9 | low | The S1-1 disposition — whose subject is stale line counts — itself carried stale line counts. | **accepted-and-fixed** — counts consolidated into one Implementation table, so there is a single place to update. |
| D-10 | low | The width portability argument ("Linux falls back to a WIDER face") was never measured, and Liberation Sans is metric-identical to Arial rather than wider. | **accepted-and-fixed** — the comment now states measured value + headroom and makes no unverified prediction. |
| D-11 | low | The drift-guard regex took the first `securityLevel:` match anywhere, comments included, so it could pass by matching its own documentation. | **accepted-and-fixed** — comments stripped first, and the regex anchored on the `.initialize(` call. |

## Notes / observations

- Local `client/node_modules` carries **dompurify 3.4.11** while
  `client/package-lock.json` pins **3.4.12** (the version the 2026-07-28 triage
  patched to). The dev box has not reinstalled since; CI runs `npm ci` and gets
  3.4.12. Consequence worth stating: every DOMPurify-half empirical here was
  measured against a version CI does not run. It does not undermine the
  assertions — they are behavioural and version-agnostic, which is exactly why
  no version is pinned — but a version assertion would have been written against
  the stale tree and failed in CI. The mermaid half is clean: local and lockfile
  are both 11.16.0.
- The `E2E smoke (gate)` grep now collects 30 tests across 7 files.
