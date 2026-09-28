# Triage Inbox

> Auto-generated 2026-09-26T13:19:04.755190Z. Items waiting for triage decision.
> Promote via WebUI Triage tab (when v1b lands) or `shared/scripts/tools/triage_promote.py --id <id> --task-ref EXT:<ref>`.

## Status summary

- Total: 245
- Triage: 9 | Promoted: 1 | Dismissed: 235 | Snoozed: 0

## Top 9 items (severity-sorted)

### Source: compliance (1 item)

<a id="trg-6ae2d749"></a>
- **02 \[auto\] Clear the 8 open compliance findings \(B7, D-layer, D-orphan, D1, F5, F6, H1, H2\)** `id=trg-6ae2d749 | severity=high | kind=compliance → P1/compliance`
  - 8 open compliance finding\(s\): B/B7, D/D-layer, D/D-orphan, D/D1, F/F5, F/F6, H/H1, H/H2  - B/B7: Every commit since r…
  - Launch payload (copy into a new Claude session):
    ```text
    /shipwright-compliance
    
    Context: 8 open compliance finding(s): B/B7, D/D-layer, D/D-orphan, D/D1, F/F5, F/F6, H/H1, H/H2.
    Dashboard: .shipwright/compliance/dashboard.md
    Each finding + hint is listed in this item's detail.
    ```
  - Promote: `triage_promote.py --id trg-6ae2d749 --task-ref EXT:<ref>`

### Source: e2e-hygiene (1 item)

<a id="trg-b13d2495"></a>
- **03 \[auto\] Stop 35-no-chat-panel.spec.ts leaving a fixture task behind that fails the E2E teardown** `id=trg-b13d2495 | severity=low | kind=bug → P3/engineering`
  - Running e2e/flows/35-no-chat-panel.spec.ts \(a @smoke test, unrelated to this iterate\) alone or as part of the @smoke…
  - Launch payload (copy into a new Claude session):
    ```text
    /shipwright-iterate <id>
    ```
  - Promote: `triage_promote.py --id trg-b13d2495 --task-ref EXT:<ref>`

### Source: iterate (1 item)

<a id="trg-786eab1f"></a>
- **05 \[auto\] Serve the WebUI over HTTPS so terminal Ctrl+V paste works over Tailscale** `id=trg-786eab1f | severity=medium | kind=enhancement → P2/engineering`
  - Follow-up to iterate-2026-05-18-terminal-copy-paste \(PR #38\), user-approved as a separate iterate during the copy/pas…
  - Promote: `triage_promote.py --id trg-786eab1f --task-ref EXT:<ref>`

### Source: manual (2 items)

<a id="trg-3fd0953a"></a>
- **04 \[auto\] Back the Codex More-options dropdowns with the live model catalog \(after 01\)** `id=trg-3fd0953a | severity=medium | kind=improvement → P2/engineering`
  - Follow-up to PR #473 \(session-scoped Plan review / Review free-text fields\) and the dismissed trg-be9df375 \(Implemen…
  - Launch payload (copy into a new Claude session):
    ```text
    /shipwright-iterate Codex More-options panel: live-catalog-backed dropdowns for Plan review / Review / Implementation model via codex debug models (spike done, see card detail), replacing free-text-only inputs
    ```
  - Promote: `triage_promote.py --id trg-3fd0953a --task-ref EXT:<ref>`

<a id="trg-8de744d4"></a>
- **07 \[guided\] Enumerate, mint and re-tag WebUI ACs at AC level \(after 06\)** `id=trg-8de744d4 | severity=medium | kind=compliance → P2/engineering`
  - Follow-up to w5 \(bind-and-promote, campaign req3-06-mechanics-webui\): both external plan reviewers flagged w5 as FR-l…
  - Launch payload (copy into a new Claude session):
    ```text
    /shipwright-iterate AC-level enumeration + minting + test re-tagging for webui (campaign req3-06-mechanics-webui follow-on to w5/this card)
    ```
  - Promote: `triage_promote.py --id trg-8de744d4 --task-ref EXT:<ref>`

### Source: operator (2 items)

<a id="trg-ef19d18d"></a>
- **Codex-runtime tasks compact way too early: launcher-codextender.ts must declare the real context window to Claude Code** `id=trg-ef19d18d | severity=high | kind=bug → P1/engineering`
  - Operator finding \(2026-09-26, live Codextender iterate test\): a Codextender-routed task compacted its conversation al…
  - Launch payload (copy into a new Claude session):
    ```text
    /shipwright-iterate --type bug
    
    Context: Codextender-routed tasks compact their conversation far too early because Claude Code assumes a 200K context window for the unrecognized "sol" model alias, while the real Codex model window is roughly 1,050,000 tokens. Fix: launcher-codextender.ts must set CLAUDE_CODE_MAX_CONTEXT_TOKENS when launching a Codextender task, read dynamically from codextender's own /v1/models max_input_tokens (do not hardcode a duplicate number in webui). Read the referenced triage item in full first for the confirmed root cause and the companion codextender-side fix landing in parallel.
    ```
  - Promote: `triage_promote.py --id trg-ef19d18d --task-ref EXT:<ref>`

<a id="trg-e914a64d"></a>
- **01 \[auto\] Hide the Implementation-model field for every Codex runtime, not just Codextender** `id=trg-e914a64d | severity=medium | kind=bug → P2/engineering`
  - Operator report \(2026-09-26, live Codextender iterate test\): the New Issue/Iterate/Pipeline task dialogs still show t…
  - Launch payload (copy into a new Claude session):
    ```text
    /shipwright-iterate --type bug
    
    Context: the "Implementation model" field (CodexModelOverrideFields.tsx) must be hidden for ALL Codex runtime tasks (codexIntegrationMode light AND codextender), reversing the explicit keep-it decision from PR #481 (commit a98e218a). Read the referenced triage item in full first -- it documents why the field was kept last time and what would break if it is naively removed. Confirm the replacement model-selection mechanism with Sven before touching the wiring, then update spec.md FR-01.74 and the three affected tests to match.
    ```
  - Promote: `triage_promote.py --id trg-e914a64d --task-ref EXT:<ref>`

### Source: req3-campaign (2 items)

<a id="trg-58a3e32d"></a>
- **08 \[auto\] REQ3.07: backfill the missing AC tests for the WebUI \(after 07\)** `id=trg-58a3e32d | severity=medium | kind=improvement → P2/engineering`
  - Der Coverage-Motor fuer die WebUI, eigener Anker. Schreibt Tests fuer ACs ohne beweisenden Test \(Liste aus REQ3-2b\).…
  - Promote: `triage_promote.py --id trg-58a3e32d --task-ref EXT:<ref>`

<a id="trg-35c0daff"></a>
- **06 \[guided\] REQ3.03: write the requirements and acceptance criteria for the WebUI** `id=trg-35c0daff | severity=medium | kind=improvement → P2/engineering`
  - Phase 2 fuer die WebUI, interaktiv. grill-Runde: Code-Scan auf Vollstaendigkeit, pro Requirement Formulierung + fehlend…
  - Promote: `triage_promote.py --id trg-35c0daff --task-ref EXT:<ref>`

