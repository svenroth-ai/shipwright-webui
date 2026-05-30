# Iterate — change: PR-card width + open/merged status

- **Run ID:** iterate-2026-05-30-pr-card-status
- **Intent:** CHANGE · **Complexity:** medium
- **Spec Impact:** MODIFY (enhances FR-01.02 transcript PR rendering)
- **Branch:** iterate/pr-card-status

## Context

The transcript `PrLinkCard` (Claude `type: "pr-link"` events) currently renders
as a small inline chip (`inline-flex … px-3 py-1.5 text-[12.5px]`, button-radius
8px) that visually diverges from the assistant message bubbles around it, and it
shows no information about whether the PR is still open or already merged. UAT
point 1: render it at the same size/width as a normal Claude message and surface
open vs. merged.

## Acceptance Criteria

1. **AC1 — bubble parity.** `PrLinkCard` adopts the assistant-message-bubble
   geometry: `max-w-[90%]`, `px-3 py-2`, `text-sm` (14px), `border-radius:14px`
   with a `4px` top-left tail — matching `TranscriptRow`'s assistant bubble. The
   anchor keeps `target="_blank"` + `rel="noopener noreferrer"`.
2. **AC2 — status badge.** When status is known, a pill renders inside the card:
   `Open` (green), `Merged` (purple), `Closed` (red), `Draft` (muted). On
   `unknown` (gh unavailable / network / parse failure) **no badge** renders and
   the card degrades gracefully (never errors, never blocks the transcript).
3. **AC3 — status source (gh).** A new `GET /api/external/pr-status?url=<prUrl>`
   route resolves the `gh` binary and runs
   `gh pr view --json state,mergedAt,isDraft -- <url>` with **`shell:false`**
   (url is a separate argv member passed after a `--` end-of-options separator —
   no shell interpolation, and never parseable as a gh flag). Result is mapped to
   `{state, merged}` and cached in-memory (60 s TTL) so transcript polling does
   not hammer GitHub. (`number` is intentionally NOT fetched — the card already
   has `event.prNumber`.)
4. **AC4 — input validation.** The route rejects any non
   `https://github.com/<owner>/<repo>/pull/<n>` url with `400` before invoking
   gh. The client only requests for parser-validated `prUrl`s.

## Affected Boundaries

- **New read surface (external):** GitHub via the `gh` CLI subprocess
  (`core/pr-status.ts`). First time webui reaches an external network service →
  F2 architecture update + decision-drop.
- **New public API route:** `GET /api/external/pr-status` (`touches_public_api`
  → mandatory review).
- No `.env`/config/JSON io-boundary touched.

## Mini-Plan

- `server/src/core/pr-status.ts` — `validatePrUrl()`, `resolveGhBin()`,
  `fetchPrStatus(url, deps?)` with injectable runner + TTL cache.
- `server/src/external/pr-status/routes.ts` — `createPrStatusRouter({fetchPrStatus?})`
  mounted in `createExternalRoutes`.
- `client`: `getPrStatus()` (externalApi) + `usePrStatus()` (React Query,
  staleTime 60 s, retry false) + `PrLinkCard` bubble/badge.
- Tests: `core/pr-status.test.ts`, `external/pr-status/routes.test.ts`,
  updated `PrLinkCard.test.tsx`, new E2E `pr-card-status.spec.ts`.

**Alternative considered:** GitHub REST API + PAT (rejected — adds secret
management; user chose gh which reuses existing auth). Deriving merged-state from
local git (rejected — cannot distinguish open vs. closed, and PRs are GitHub-side).

## Security

- `shell:false` + url-as-argv + pre-validation (`validatePrUrl`) ⇒ no command
  injection (mirrors ADR-044 #9 spawn discipline).
- Graceful degradation: gh missing/unauth/offline ⇒ `unknown` ⇒ no badge; the
  route never 500s on a gh failure (returns `{state:"unknown"}`).

## Confidence Calibration
- **Boundaries touched:** new external read surface (gh→GitHub); new public API route `GET /api/external/pr-status`.
- **Empirical probes run:** server unit tests drive fetchPrStatus over injected gh stdout for OPEN/DRAFT/MERGED/CLOSED/ENOENT/non-zero/malformed-json + cache-hit; route tests for 200/400; F0.5 E2E seeds a real pr-link JSONL, route-mocks pr-status, asserts the Merged badge + bubble geometry in real Chromium.
- **Edge cases NOT probed + why acceptable:** live GitHub rate-limiting (cache + retry:false bound request volume; failure path already maps to `unknown`); private-repo auth (gh inherits the operator's keyring auth; auth failure → `unknown`).
- **Confidence-pattern check:** the risky asymptote is "works when gh is present" — explicitly probed the gh-absent path (resolveGhBin → null → unknown) so the green path is not the only one verified.
