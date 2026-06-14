# Iterate Spec — Actions-config UX (edit-modal upload) + upload-validation fix

- **run_id:** `iterate-2026-06-14-actions-config-ux`
- **Intent:** FEATURE · **Complexity:** medium · **Risk flags:** `touches_public_api` (upload.ts)
- **Spec Impact:** ADD (new UI surface) + MODIFY (upload route validation completion)
- **Date:** 2026-06-14

## Problem (3 cohesive parts, user asked for them together)

1. **Upload-route 500 (production, verified in live log).** `server/src/external/actions/upload.ts` calls `dryRunTemplate(action.command_template, action.id, phaseIds)` WITHOUT the 4th `slash_command` arg. FR-01.37 (PR #123) fixed the same dry-run in `get.ts` but **missed `upload.ts`**. Uploading a custom `actions.json` whose action uses `{task.initial_prompt}` + `slash_command` → `buildSlashCommand` returns null → `UnknownActionError` → **500** on `POST /api/projects/:id/actions-upload`. (Sven hit this in Settings for the Content-Marketing project.)
2. **Actions upload UI only on the Settings page.** No way to manage a project's `actions.json` from the project Edit modal.
3. **Stale/wrong "Launcher preferences" card** on the Settings page — claims a "Copy command launcher" that no longer exists (Launch/Resume auto-execute via the embedded-terminal header CTA, ADR-068-A1).

## Goal / Acceptance Criteria

- **AC-1** `upload.ts` passes `action.slash_command` to `dryRunTemplate` (mirrors `get.ts`). Uploading a valid custom `{task.initial_prompt}` + `slash_command` config returns **200** (was 500). A still-invalid config (missing/invalid slash_command) returns the existing typed **400** schema error, not 500.
- **AC-2** `ActionsConfigRow` is extracted into its own exported component (`client/src/components/settings/ActionsConfigRow.tsx`), used by BOTH `ActionsConfigCard` (Settings, maps all real projects) and `ProjectSettingsDialog` (edit modal, one project). Behavior unchanged on the Settings page.
- **AC-3** The row gains an optional `hideProjectHeader?: boolean`. In the edit modal it is rendered with `hideProjectHeader` (the dialog already shows name + path) → only badge + Upload/Reset controls + banners. On Settings the full header (name + path) stays.
- **AC-4** The project Edit modal (`ProjectSettingsDialog`) shows a new **Actions configuration** section with full parity: Upload .json + Reset-to-default (with confirm dialog) + Custom/Bundled/Malformed badge + error/success banners. Gated on a real project (`project.path` present).
- **AC-5** The "Launcher preferences" card is removed from `SettingsPage` (section + stale copy + the file-header comment that describes it). The Settings page keeps the `ActionsConfigCard`.
- **AC-6** No new server route (POST/DELETE `/api/projects/:id/actions-upload` already exist). Server stays the validation authority.

## Out of scope

- No change to the actions schema or substitution logic (FR-01.37 already shipped that).
- No FolderTree / wizard changes; the edit modal is `ProjectSettingsDialog` only.

## Affected Boundaries

- `server/src/external/actions/upload.ts` — actions.json upload route (the security/validation boundary; the fix mirrors the already-correct `get.ts`).
- `client/src/components/settings/ActionsConfigCard.tsx` + new `ActionsConfigRow.tsx` — component extraction (behavior-preserving for Settings).
- `client/src/components/wizard/ProjectSettingsDialog.tsx` — new consumer of the row.
- `client/src/pages/SettingsPage.tsx` — removal.

## Self-Review (Step 7)
1. **Solves it?** Yes — upload 500 fixed (route test), actions upload now in the edit modal (compact), Launcher card gone.
2. **YAGNI?** One reused component + one prop (`hideProjectHeader`, two real callers) + a one-line server fix + a removal. No speculative surface.
3. **Reuses patterns?** Extraction de-duplicates (one row serves Settings + modal); server fix mirrors `get.ts` (incl. try/catch defense).
4. **Happy + error paths tested?** Upload 200 + 400; row default + compact; section present + gated-absent; card still maps real rows.
5. **Behavior-preserving extraction?** All testids/handlers/state preserved; existing `ActionsConfigCard.test.tsx` green unchanged.
6. **Bloat?** Extraction *reduces* `ActionsConfigCard.tsx` (408→86); new files under 300. No ratchet.
7. **Affected boundaries:** upload route, settings components, edit-modal consumer, settings page — all exercised by tests.

## Confidence Calibration
- **Boundaries touched:** upload-route validation, actions-config component extraction, edit-modal consumer, settings-page removal.
- **Empirical probes run:**
  - Upload route accepts a custom `{task.initial_prompt}`+`slash_command` config → **200** (was 500); missing slash → **400** `schema_validation_failed` (not 500). `actions-upload.test.ts` (16/16).
  - Extraction is behavior-preserving: existing `ActionsConfigCard.test.tsx` green unchanged + `SettingsPage.test.tsx` "still maps real projects" asserts a full-header row renders.
  - `hideProjectHeader` omits name/path, keeps badge + Upload + Reset (`ActionsConfigRow.test.tsx`); the modal renders it compact (`ProjectSettingsDialog.test.tsx`, `within(section)` asserts name/path absent).
  - Modal section gated (present with path, absent without).
  - SettingsPage no longer renders "Launcher preferences"; actions card still present.
  - Full suites: server 1639/1639, client 1654/1654, doc-sync 59, tsc 0 (both), lint 0 (both).
- **Test Completeness Ledger:**

  | Behavior | Disposition | Evidence |
  |---|---|---|
  | upload accepts custom initial_prompt+slash (200, was 500) | tested | actions-upload.test.ts "accepts…" |
  | upload rejects missing slash → 400 not 500 | tested | actions-upload.test.ts "rejects…" |
  | ActionsConfigRow full mode shows name+path | tested | ActionsConfigRow.test.ts "renders … by default" |
  | hideProjectHeader omits name/path, keeps badge+controls | tested | ActionsConfigRow.test.ts "hideProjectHeader omits…" |
  | Custom badge after query resolves (fromUser) | tested | ActionsConfigRow.test.ts "Custom badge" |
  | ActionsConfigCard still maps real rows after extraction | tested | ActionsConfigCard.test.tsx (existing) + SettingsPage.test.tsx "still maps real projects" |
  | edit modal renders Actions section COMPACT for real project | tested | ProjectSettingsDialog.test.tsx "COMPACT mode" |
  | edit modal hides Actions section for pathless project | tested | ProjectSettingsDialog.test.tsx "hides … no path" |
  | SettingsPage no longer renders Launcher preferences | tested | SettingsPage.test.tsx "no longer renders…" |
  | SettingsPage renders actions-config surface | tested | SettingsPage.test.tsx "renders the actions-config surface" |

  counts: testable 10, tested 10, untestable 0, untested_testable 0. enumeration_basis: acs 6, covered_acs 6.
- **Confidence-pattern check:** asymptote (depth) — extraction is byte-equivalent behavior verified by the unchanged existing card test + new compact/full assertions; server fix mirrors the already-correct get.ts. coverage (breadth) — server route (200/400) × component (full/compact/badge) × consumer (modal present/gated) × page (removal/surface/real-row), plus E2E web at F0.5.
