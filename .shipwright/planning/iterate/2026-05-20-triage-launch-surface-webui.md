# Iterate Spec: triage-launch-surface-webui

- **Run ID:** iterate-2026-05-20-triage-launch-surface-webui
- **Type:** feature
- **Complexity:** medium
- **Status:** draft

## Goal

WebUI counterpart to shipwright Iterate A (PR #41, merged 2026-05-20):
surface the new `launchPayload` field on every triage item and add a
**Fix now** verb button so operators can copy the producer-generated
slash-command + context into their clipboard and paste it into a Claude
Code session — the GUI equivalent of `triage_cli.py list` followed by a
manual copy out of the markdown fence.

## Acceptance Criteria

- (AC-1) `TriageItem` TS type (both `server/src/types/triage.ts` and
  `client/src/lib/triageApi.ts`) carries an optional
  `launchPayload?: string | null` field — exact mirror of the Python
  `launchPayload` wire key on `append` events.
- (AC-2) The `triage-store.test.ts` parity test asserts that
  `launchPayload` round-trips byte-for-byte: a fixture with a non-empty
  payload, a fixture with `null`, and a missing-key legacy fixture all
  produce the resolved view a Python `read_all_items()` would produce.
- (AC-3) `TriageDetailModal` renders the `launchPayload` in a
  `<pre><code>` block, control-chars stripped to the same allow-list
  the aggregator uses (`\n`, `\t`, `0x20..0x7E`, ≥`0x80`), HTML-escaped
  by React's default text-node escaping (no `dangerouslySetInnerHTML`).
- (AC-4) When `item.source === "github"` AND `launchPayload` is null,
  empty, or whitespace-only, the modal renders a visible loud-failure
  placeholder `[no launch payload — producer bug; please report]`
  (verbatim string match to `aggregate_triage.py::_render_launch_payload`).
- (AC-5) Legacy items (`source !== "github"` AND no `launchPayload`)
  render WITHOUT a payload block — exactly the existing UI.
- (AC-6) A **Fix now** button appears in `TriageDetailModal` next to the
  existing Promote / Dismiss / Snooze row, ONLY when a renderable
  payload exists. Click → copies the cleaned (control-stripped)
  payload to clipboard via `lib/clipboard.copyText` and shows a transient
  "Copied — paste into your Claude session" confirmation for ~3 s. No
  wire-status change to `triage.jsonl` (this is the v1 copy-paste flow).
- (AC-7) Wire-event parity for status events (the actual mutating
  path) stays unchanged. The architecture decision — subprocess vs
  TS-reimpl — is documented in the iterate ADR, and the existing
  `core/triage-store.test.ts` parity gate continues to guard the
  resolver's wire shape.
- (AC-8) Docs update: `CLAUDE.md` mentions the launchPayload-aware
  Triage tab + Fix-now CTA in the file map. A `CHANGELOG-unreleased.d/`
  drop file is created under the appropriate category.

## Spec Impact

This webui project is a brownfield adoption — its FR table is auto-
generated from the codebase at adoption time and is not edited per
iterate (per ADR-080 and the `.shipwright/agent_docs/conventions.md`
"adopt-only" posture). The change adds a UI verb on an existing FR
surface (Triage tab, ADR-101 / FR-01.30).

- **Classification:** MODIFY (FR-01.30 — Triage Tab)
- **ADD:** none
- **MODIFY:** FR-01.30 gains a launchPayload rendering rule and the
  Fix-now copy-to-clipboard verb. Wire status flips are unchanged.
- **REMOVE:** none
- **NONE justification:** n/a

The webui's brownfield spec lives in `.shipwright/planning/01-adopted/spec.md`;
adding a one-line MODIFY note for FR-01.30 is the smallest possible
edit that surfaces the new behavior in the spec without re-architecting
the adoption baseline.

## Out of Scope

- Re-implementing triage promote/dismiss/snooze as a subprocess call to
  `shared/scripts/tools/triage_cli.py`. The existing TS implementation
  (ADR-101 / ADR-106) is the architectural posture; this iterate adds
  a UI verb on top of it without re-platforming the writer.
- Mid-session prompt injection. The WebUI does not spawn Claude (Arch
  rule 1) and has no cross-route "inject into the foreground terminal"
  mechanism. Fix-now is clipboard-copy + paste, matching shipwright's
  Iterate A "copy-paste is the v1 fix-now flow" note.
- A `fix` verb in the Python `triage_cli.py` — intentionally not added
  in Iterate A.
- Per-finding GitHub false-positive dismissal (operators continue to
  do this at SARIF level on GitHub).
- Showing the launchPayload on the small `TriageItemCard` (the card
  stays compact; the payload is for the modal where the operator
  actually copies it).

## Design Notes

- The launchPayload block sits BELOW the existing `Detail` section in
  `TriageDetailModal`, above the action-button row. Reuses the existing
  `border-t border-stone-200 pt-4 mt-4` section divider so it visually
  belongs to the item content, not the action area.
- Fence styling: `font-mono text-xs bg-stone-50 border border-stone-200
  rounded p-3 whitespace-pre-wrap overflow-x-auto max-h-64`. The
  `whitespace-pre-wrap` is intentional — long lines wrap so the
  operator can read them; `<pre>`'s default `white-space: pre` would
  force horizontal scroll, which mismatches the Inbox/Transcript
  rendering posture in this project.
- The github loud-failure placeholder is a red-toned warning box
  (`text-red-700 bg-red-50 border border-red-200 rounded p-3`) so it
  reads as a producer bug, not a status quo. Matches `triage-action-error`
  styling.
- Fix-now button uses the existing emerald accent (`bg-emerald-600
  hover:bg-emerald-700`) — same family as Promote, since both are the
  forward-action verbs.
- Transient confirmation is a `text-xs text-emerald-700` line that
  appears next to the button for 3 s, NOT a toast (the Triage tab
  doesn't have a toast primitive and adding one is out of scope).

## Affected Boundaries

| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| `shared/scripts/triage.py append_triage_item` (Python, shipwright) | `server/src/core/triage-store.ts readAllItems` (TS, webui) | JSONL on disk, camelCase wire keys; new `launchPayload` field on `append` events |
| `aggregate_triage.py _render_launch_payload` (Python, shipwright) | `client/src/components/triage/TriageDetailModal LaunchPayloadBlock` (TS, webui) | UI rendering rule (`<pre><code>` + control-char strip + github placeholder) |

`triage_io_boundary` risk flag fires: the JSONL is the cross-process
contract between Iterate A's producer and the WebUI's consumer.
Boundary Probe is mandatory at Step 6a.

## Confidence Calibration

- **Boundaries touched:** (a) JSONL `append`-event wire shape gains
  `launchPayload`; (b) UI rendering rule mirrors aggregator.
- **Empirical probes run (planned):**
  1. **Round-trip:** write a JSONL append event with
     `"launchPayload": "/iterate something\n..."` via the Python
     `append_triage_item()` test path → read it back via TS
     `readAllItems()` → assert deep-equal to the Python
     `read_all_items()` output.
  2. **Null/missing parity:** three fixture variants — payload present,
     `"launchPayload": null`, key absent (legacy) — all produce the
     same resolved shape on both sides.
  3. **Control-char strip parity:** payload containing `\x07` (BEL),
     `\x1b` (ESC), `\x7f` (DEL) → TS `stripControlChars` produces the
     same output as Python `_strip_control_chars`. Multi-line
     `\n` + `\t` are preserved.
  4. **GitHub loud-fail parity:** `source="github"` + `launchPayload=null`
     → both renderers emit the literal string `[no launch payload —
     producer bug; please report]` (verbatim).
- **Edge cases NOT probed:**
  - Markdown safe-fence renumbering: irrelevant for DOM rendering
    (no markdown parser, just `<pre><code>` + React text escape).
- **Confidence-pattern check:** no "are you confident?" question yet.
  If a follow-up empirical probe finds drift, run one more before F0.

## Verification (medium+)

- **Surface:** web (Vitest unit + Playwright E2E happen on the web
  surface; the launchPayload rendering is purely client-side once the
  JSONL is on disk).
- **Runner command:** `npm.cmd --prefix client run test -- --run` for
  unit + a single Playwright spec under `client/e2e/flows/triage-fix-now.spec.ts`
  that seeds a triage.jsonl with a real launchPayload via the new
  `/api/triage/__test__/seed` test-only route OR via direct file write
  in the test setup (preferred — no new route).
- **Evidence path:** `.shipwright/runs/iterate-2026-05-20-triage-launch-surface-webui/surface_verification.json`
- **Justification:** n/a (surface=web is the natural fit; the change
  is UI-visible).
