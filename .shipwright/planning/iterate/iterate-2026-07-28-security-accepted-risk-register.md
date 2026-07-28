# Iterate: Security triage — fix two reachable CVEs, register three unreachable ones

**Run ID:** `iterate-2026-07-28-security-accepted-risk-register`
**Type:** CHANGE · **Complexity:** medium · **Spec Impact:** NONE (no FR behaviour changes)

## Trigger

GitHub Code Scanning showed 5 open alerts on `svenroth-ai/shipwright-webui`
(2 high, 2 medium, 1 low — all Trivy SCA, 0 SAST, 0 secrets, 0 Dependabot).
The question asked was whether they are real or false positives. All five are
REAL advisories; the reachability analysis below is what separates them.

## Reachability analysis (the actual triage)

| Alert | Package | Sev | Verdict |
|---|---|---|---|
| #300 | linkify-it 5.0.1 | HIGH | real, **not reachable** → FIXED anyway |
| #299 | dompurify 3.4.11 | LOW | real, **not exploitable** → FIXED anyway |
| #301 | react-router 7.18.0 | HIGH | **not applicable** → accepted |
| #298/#297 | @hono/node-server 1.19.13/.14 | MED | real, **impact nil here** → accepted |

- **linkify-it** (CVE-2026-59887) — quadratic DoS in the `mailto:` validator,
  triggered through markdown-it with `linkify: true`. This repo sets
  `linkify: false` (`client/src/lib/markdownTiptap.ts:51`) and both markdown-it
  linkify rules early-return on `!options.linkify`. The server pulls no
  markdown-it at all. Fixed regardless: the patch sits inside markdown-it's
  declared `^5.0.1` range, so it costs a lockfile line.
- **dompurify** (GHSA-c2j3-45gr-mqc4) — `CUSTOM_ELEMENT_HANDLING` bypasses
  `afterSanitizeElements`. Needs three conditions; two are absent outright: the
  app registers no DOMPurify hooks and defines no custom elements
  (`customElements.define` → 0 hits), so the second-order gadget cannot exist.
  Mermaid runs `securityLevel: "strict"`. Fixed regardless — inside mermaid's
  declared `^3.3.3` range.
- **react-router** (GHSA-qwww-vcr4-c8h2) — the advisory scopes itself to the
  unstable RSC APIs. This client is a Vite SPA on `RouterProvider`; no RSC entry
  point, no `unstable_*` API in `client/src`. No patch exists for 7.x at all.
- **@hono/node-server** (GHSA-frvp-7c67-39w9) — `%5C` path traversal in
  serve-static on Windows. The platform precondition IS met, but the advisory's
  impact is reading files behind a *middleware-guarded prefix*, and this repo
  mounts none: all three `app.use` calls are wildcards, the static root is the
  public SPA build, and `..` escape stays blocked. Nothing to bypass. Also not
  fixable: `@hono/node-ws@1.3.1` peer-requires `@hono/node-server ^1.19.11`, so
  the patched 2.0.5 breaks the embedded terminal's WS upgrade chain (ADR-067).

## Why the register, not just `.trivyignore.yaml`

The original plan was to add ignore entries and be done. Reading the toolchain
first changed that, and the reason is empirical, not stylistic: the compliance
dashboard (`accepted_risk_view.py`) **correlates** register against suppression
and renders a suppression with no register entry as **DRIFT**, not as an accepted
risk. Ignore-only entries would therefore have traded five alerts for two drift
rows — the opposite of the goal. Probe 1 below reproduces exactly that.

`shipwright_accepted_risks.yaml` is the canonical record; its own docstring names
this repo's `.trivyignore.yaml` entry as the semantic stretch that motivated it.
Creating it also clears the pre-existing unregistered suppression.

## Acceptance Criteria

- **AC1** — `linkify-it` resolves to 5.0.2 and `dompurify` to 3.4.12 in
  `client/package-lock.json`, with no other dependency churn.
- **AC2** — the lockfile still installs (`npm ci` clean, integrity verified).
- **AC3** — mermaid still renders after the dompurify bump.
- **AC4** — `shipwright_accepted_risks.yaml` exists, validates, and carries all
  three acceptances with due dates and named rationale refs.
- **AC5** — `.trivyignore.yaml` suppresses the two real advisory ids, and the
  register/suppression drift gate is clean in BOTH directions.
- **AC6** — no acceptance is past due; the boundary day counts as still active.

## Confidence Calibration

- **Boundaries touched:** `client/package-lock.json` (dependency resolution +
  integrity); `.trivyignore.yaml` (Trivy ignore-file format, consumed by the CI
  scanner AND the compliance dashboard); `shipwright_accepted_risks.yaml` (new —
  the shared register schema, validated by `accepted_risks.py`).

- **Empirical probes run:**
  1. *Register entry removed, suppression kept* → `check` reported `UNRECORDED`,
     exit 1. This is the failure the ignore-only plan would have shipped.
  2. *Suppression removed, register entry kept* → `check` reported `STALE`,
     exit 1. Reverse direction bites too.
  3. *Entry backdated one day* → `expire` reported `EXPIRED`, exit 1.
  4. *Entry dated exactly today* → still active, exit 0. Matches the documented
     "the date itself is still an active acceptance" semantics.
  5. *`npm ci` from the hand-edited lockfile* → exit 0; integrity verified
     against hashes independently re-fetched from the registry.
  6. *Real-browser mermaid render* with the actually-installed
     mermaid 11.16 + dompurify 3.4.12, `securityLevel: "strict"` → 16 283-char
     SVG, 340×501 px, all 5 node labels present, 0 `<script>` survivors,
     0 console errors.
  7. *Falsification of probe 6* — degraded the render and re-ran; probe failed
     (exit 1), so probe 6 is sensitive rather than vacuously green.

- **Test Completeness Ledger:**

  | # | Behavior | Status | Evidence |
  |---|---|---|---|
  | 1 | linkify-it resolves to 5.0.2 (AC1) | tested | `npm ls linkify-it` → 5.0.2; lockfile diff |
  | 2 | dompurify resolves to 3.4.12 (AC1) | tested | `npm ls dompurify` → 3.4.12; lockfile diff |
  | 3 | no collateral dependency churn (AC1) | tested | `git diff --stat` = 6 insertions / 6 deletions, confined to the two entries |
  | 4 | lockfile remains installable (AC2) | tested | probe 5 — `npm ci` exit 0 |
  | 5 | mermaid renders post-bump (AC3) | tested | probe 6 (+ falsified by probe 7) |
  | 6 | register validates against the schema (AC4) | tested | `check` loaded 3 entries without `RegisterError` |
  | 7 | unrecorded suppression is caught (AC5) | tested | probe 1 |
  | 8 | stale register entry is caught (AC5) | tested | probe 2 |
  | 9 | expired acceptance is caught (AC6) | tested | probe 3 |
  | 10 | boundary day still active (AC6) | tested | probe 4 |
  | 11 | existing suites unaffected | tested | client 3092 + server 3030 pass; typecheck clean |
  | 12 | Trivy actually stops emitting the two ids | untestable | `requires-external-nondeterministic-service` — Trivy is not installed locally (verified: `trivy`, `semgrep`, `gitleaks` all absent) and the authoritative check is the CI scan. Mitigated by using id-level (not path-scoped) ignores, the least fragile match Trivy offers. |

  0 testable-but-untested.

- **Confidence-pattern check:**
  - *Asymptote (depth)* — the drift gate is exercised in all four of its
    directions (unrecorded / stale / expired / boundary), not just the happy
    path. The one claim I cannot close locally (row 12) is named as such rather
    than assumed.
  - *Coverage (breadth)* — both changed mechanisms are covered: dependency
    resolution (rows 1-5) and the accepted-risk record (rows 6-10).
  - *Known gap, deliberately not closed here* — the repo has NO real mermaid
    rendering coverage at all; `MermaidRenderer.test.tsx` does `vi.mock("mermaid")`,
    so the whole existing suite is blind to a sanitizer regression. Probe 6 covers
    THIS change but is not permanent coverage. Flagged as follow-up rather than
    silently absorbed.

## Follow-ups (deliberately NOT in this change)

1. **Wire `check` + `expire` into CI** so an expired acceptance fails the build
   instead of only surfacing in a dashboard table. Needs a
   `.github/workflows/**` edit → `touches_ci_supplychain` posture + an admin
   merge, so it gets its own iterate.
2. **Relocate the synthetic `semgrep:` entry** to a real `semgrep-policy-toggle`
   target. Requires moving `SHIPWRIGHT_SEMGREP_ACCEPT_GH_OWNED_ACTION_TAGS` from
   `.claude/settings.json` into `security.yml`, which is the same CI-supply-chain
   posture change as (1) and pairs naturally with it.
3. **Permanent real-mermaid render coverage** to close the `vi.mock` blind spot.
