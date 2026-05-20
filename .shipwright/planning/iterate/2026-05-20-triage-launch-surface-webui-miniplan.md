# Mini-Plan: triage-launch-surface-webui

- **Run ID:** iterate-2026-05-20-triage-launch-surface-webui

## Approach

Iterate B has a small surface area — the bulk of the wire / lock /
parity machinery already exists from Iterate-3 + ADR-101 + ADR-106.
The new producer field `launchPayload` flows through the existing
verbatim-key resolver (`Object.entries(parsed)` in
`server/src/core/triage-store.ts`) without code change. We add the
type declaration, the rendering UI block, and a Fix-now copy-to-
clipboard verb.

### Files to change

| File | Change | Reason |
|---|---|---|
| `server/src/types/triage.ts` | Add `launchPayload?: string \| null` to `TriageItem` | TS type drift-guard (mirrors Python wire shape) |
| `client/src/lib/triageApi.ts` | Add `launchPayload?: string \| null` to client `TriageItem` mirror | Keep client + server types byte-equal |
| `server/src/test/fixtures/triage.jsonl` | Add a 4th append event with a non-empty `launchPayload` + a 5th with `launchPayload: null` | Cover both payload + null cases in the parity fixture |
| `server/src/test/fixtures/triage-resolved.json` | Regenerate so each resolved item carries `launchPayload` | Parity-gate input |
| `server/src/core/triage-store.test.ts` | Add 3 unit tests: payload round-trip, null wire, missing-key legacy | AC-2 |
| `client/src/lib/launchPayload.ts` (NEW) | `stripControlChars()` (mirrors Python `_strip_control_chars`) + `renderableLaunchPayload(item)` helper | Single SSoT for the rendering rule |
| `client/src/lib/launchPayload.test.ts` (NEW) | Unit tests for stripControlChars + the github loud-fail decision | AC-3 + AC-4 |
| `client/src/components/triage/LaunchPayloadBlock.tsx` (NEW) | Renders the payload `<pre><code>` block OR the github placeholder OR nothing (legacy) — pure component | AC-3 + AC-4 + AC-5 |
| `client/src/components/triage/LaunchPayloadBlock.test.tsx` (NEW) | Three test paths: renders payload, renders github placeholder, renders nothing for legacy | AC-3 + AC-4 + AC-5 |
| `client/src/components/triage/TriageDetailModal.tsx` | Mount `<LaunchPayloadBlock>` below Detail; add `<FixNowButton>` next to Promote when payload is renderable | AC-6 |
| `client/src/components/triage/TriageDetailModal.test.tsx` | Assert Fix-now button presence/absence + clipboard call + transient confirmation | AC-6 |
| `client/e2e/flows/triage-fix-now.spec.ts` (NEW) | Seed a real `.shipwright/triage.jsonl` with a non-empty `launchPayload`, navigate to /triage, click item, click Fix now, assert clipboard write + UI confirmation | F0.5 web-surface gate |
| `CLAUDE.md` | Add `LaunchPayloadBlock.tsx` to the file map under `components/triage/`; note Fix-now CTA in the Triage description; add ADR-110 entry to the convention notes | AC-8 |
| `CHANGELOG-unreleased.d/Added/iterate-2026-05-20-triage-launch-surface-webui_001.md` | One-liner per AC | F4 |
| `.shipwright/agent_docs/architecture.md` | Note the launchPayload data-flow leg (Python producer → JSONL → TS resolver → React modal) | F2 — new read surface for the producer field |
| `.shipwright/planning/01-adopted/spec.md` | Append a single-line MODIFY note on FR-01.30 with the run_id + ADR reference | F1 |

### Work breakdown

1. **Wire-shape parity (foundation)** — types + fixtures + 3 unit tests.
   Gates everything else. If the resolver doesn't expose `launchPayload`,
   nothing downstream works.
2. **Rendering primitive** — `lib/launchPayload.ts` + `LaunchPayloadBlock`
   component + their unit tests. Pure-function shape so the same logic
   is reusable from the modal and any future surface (e.g. inbox).
3. **Modal integration** — wire `<LaunchPayloadBlock>` into the modal
   layout; add `<FixNowButton>` next to Promote. Update modal tests.
4. **E2E spec** — Playwright spec that seeds a real triage.jsonl,
   drives the modal, asserts clipboard + confirmation.
5. **Docs + finalize** — CLAUDE.md note, ADR, changelog drop, F0/F0.5,
   commit, PR.

### Alternative considered (rejected)

**Subprocess invocation of `triage_cli.py promote/dismiss` from the
WebUI backend.** Rejected because:

- The WebUI already has a complete TS implementation of status-event
  appends (ADR-101 / ADR-106) with extensive lock + idempotency
  testing, a `.weblock` lock-sidecar deliberately picked to NOT
  collide with Python's `.lock`, and a byte-for-byte parity gate.
- Switching to subprocess re-introduces cross-platform fragility
  (uv-on-Windows .cmd shim per the global CLAUDE.md, shipwright-
  checkout path discovery, subprocess timeout / process leak risk on
  failed `uv run`) for no architectural gain.
- Iterate A's prompt allows this as the explicit fallback: *"if
  subprocess invocation isn't viable in the webui's deployment model,
  implement the JSONL append in TypeScript matching the EXACT shape …
  Add a parity test"*. That gate already exists.
- The launchPayload field is added by the PRODUCER (Python
  `append_triage_item`) — the WebUI doesn't write it; it only reads.
  No mutating-path drift exists to guard against.

The parity-risk callout in the prompt is addressed by:
1. Keeping the existing `core/triage-store.test.ts` parity test green
   (resolver round-trips every wire key, including the new
   `launchPayload`).
2. Adding three new fixture variants (payload, null, missing) so the
   gate covers the new field empirically.
3. The status-event writer (`triage-write.ts`) is unchanged and the
   existing parity test still proves its event shape matches
   `triage.py::mark_status`.

### Test strategy

- Vitest unit tests for the new `lib/launchPayload.ts`, the
  `LaunchPayloadBlock` component, and the modal Fix-now flow (jsdom).
- Vitest parity test extension for `core/triage-store.test.ts` with
  three new fixture variants.
- Playwright E2E (`client/e2e/flows/triage-fix-now.spec.ts`) — seeds
  a real `triage.jsonl` in an isolated `USERPROFILE` temp dir per the
  `feedback_iterate_e2e_isolated_userprofile` memory rule, runs against
  the prod build server (`node dist/index.js`), drives the click and
  asserts on `navigator.clipboard.writeText` via a stub.

### External review responses (iterate review, 2026-05-20)

OpenAI returned 14 findings (4 medium, 10 low). All addressed in this
mini-plan; see the spec's Confidence Calibration for the new probe
list. Findings folded in:

- **MED #1 (API-layer end-to-end):** ADD an HTTP-level test in
  `server/src/routes/triage.test.ts` that asserts `GET /api/triage/:projectId`
  surfaces `launchPayload` on the JSON response body for an item that
  carries one in its `append` event. (The resolver test is necessary
  but not sufficient — see memory `feedback_verify_the_consumer_chain`.)
- **MED #2 (cross-workspace type drift):** the existing
  `server/src/types/action-schema-sync.test.ts` covers `action-schema.ts`
  but not `triage.ts`; ADD a sibling content-parity test
  `server/src/types/triage-schema-sync.test.ts` that diffs
  `server/src/types/triage.ts` against `client/src/lib/triageApi.ts` for
  the `TriageItem` field set (handles future drift, not just `launchPayload`).
- **MED #3 + #4 + #11 (renderability + copy SoT, github-placeholder
  AFTER sanitization, copy uses cleaned string):** `lib/launchPayload.ts`
  exposes a single `prepareLaunchPayload(item)` helper that returns a
  discriminated union `{ kind: "render"; cleaned: string }` |
  `{ kind: "github-placeholder" }` | `{ kind: "none" }`. The decision
  order is: (1) clean the raw payload with `stripControlChars`; (2) if
  `.trim()` non-empty → `render`; (3) else if `source === "github"` →
  `github-placeholder`; (4) else `none`. Both `<LaunchPayloadBlock>`
  (renders) and `<FixNowButton>` (visibility + copy) consume the SAME
  helper output. Copy passes ONLY `cleaned` to `copyText` — never the
  raw payload.
- **MED #6 (Python-generated parity inputs for stripControlChars):**
  add `server/src/test/fixtures/launch-payload-strip.json` — an array
  of `{input, expected}` pairs generated by a small Python helper that
  feeds `aggregate_triage.py::_strip_control_chars`. Both the TS unit
  test for `stripControlChars` AND the modal/component tests read this
  fixture so future drift fails loudly. Categories covered: ASCII
  controls 0x00-0x1F (preserving `\n` + `\t`), DEL `0x7F`, multibyte
  (German Umlaut, emoji, CJK), CR `\r` (intentionally dropped), bare
  ESC `\x1b`. Fixture regen script lives at
  `server/scripts/regen-launch-payload-fixtures.py`, called once at
  build start to verify it stays Python-canonical.
- **MED #7 (clipboard failure UX):** `<FixNowButton>` catches
  `copyText` rejection and shows an inline `text-red-700` failure line
  next to the confirmation slot. Unit test covers the rejected
  promise path.
- **MED #9 (server caching breaks E2E):** `core/triage-store.ts` has
  a 5s mtime-keyed cache that invalidates on file mtime change AND
  on append (via `invalidateCacheForPath`). E2E spec writes the
  `triage.jsonl` BEFORE `page.goto`, then waits ≥6s OR triggers a
  TanStack refetch via test hook. Safer: seed file BEFORE server
  spawn, then start server. Documented in E2E spec header.
- **LOW #5 (fixture mutation risk):** AUDIT existing consumers of
  `triage.jsonl` / `triage-resolved.json` (grep before commit).
  Strategy: APPEND new items at the END of the JSONL with new ids
  (`trg-dddd4444` for non-null payload, `trg-eeee5555` for null
  payload, `trg-ffff6666` for github-source missing-payload). Existing
  test expectations on items-1-3 stay byte-equal; new tests assert
  on items-4-6.
- **LOW #8 (timer cleanup):** `useEffect` cleanup clears the 3s
  timer; second click resets the timer. Test uses `vi.useFakeTimers`.
- **LOW #10 (rendered text ≡ copied text):** the modal test asserts
  `term.textContent === clipboard.writeText.mock.calls[0][0]` for the
  rendered `<pre>`.
- **LOW #12 (no telemetry leak):** `copyText` already only takes
  the string param; no logger wraps it. Confirmed via grep; no
  action needed.
- **LOW #13 (helper discovery):** grepped `client/src` for existing
  text-sanitization helpers — there is no shared one. `lib/launchPayload.ts`
  becomes the canonical source.
- **LOW #14 (FixNowButton placement):** keep inline in
  `TriageDetailModal` (no separate component file). Helper
  `prepareLaunchPayload` is the SoT for both decisions; the JSX
  glue stays where the rest of the action buttons live.

Net new files vs the original file list:
- `server/src/types/triage-schema-sync.test.ts` (MED #2)
- `server/src/test/fixtures/launch-payload-strip.json` (MED #6)
- `server/scripts/regen-launch-payload-fixtures.py` (MED #6)
- HTTP-level test added INSIDE `server/src/routes/triage.test.ts`
  (MED #1) — no new file.
