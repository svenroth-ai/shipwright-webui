# Triage Inbox

> Auto-generated 2026-09-28T06:43:14.369756Z. Items waiting for triage decision.
> Promote via WebUI Triage tab (when v1b lands) or `shared/scripts/tools/triage_promote.py --id <id> --task-ref EXT:<ref>`.

## Status summary

- Total: 250
- Triage: 11 | Promoted: 1 | Dismissed: 238 | Snoozed: 0

## Top 11 items (severity-sorted)

### Source: claude-session (3 items)

<a id="trg-69c5f35a"></a>
- **03 \[auto\] Stop producers writing a second triage store under server/ instead of the repo root** `id=trg-69c5f35a | severity=high | kind=bug → P1/engineering`
  - FOUND 2026-09-26. shipwright-webui carries a SECOND, untracked triage store at server/.shipwright/ alongside the real o…
  - Promote: `triage_promote.py --id trg-69c5f35a --task-ref EXT:<ref>`

<a id="trg-4f52e04b"></a>
- **02 \[auto\] Triage the 22 open code-scanning alerts, 1 high and 3 errors in the terminal surface** `id=trg-4f52e04b | severity=high | kind=compliance → P1/engineering`
  - RECOVERED 2026-09-26 from a STRAY TRIAGE STORE. This finding was first raised on 2026-09-11 as trg-558f9827, but the pr…
  - Promote: `triage_promote.py --id trg-4f52e04b --task-ref EXT:<ref>`

<a id="trg-e542ce03"></a>
- **10 \[guided\] Show and drive the campaign dependency graph from the WebUI** `id=trg-e542ce03 | severity=medium | kind=feature → P2/engineering`
  - Second half of the monorepo card trg-c196ba32, whose own sequencing says "monorepo-first ... then WebUI second -- the W…
  - Promote: `triage_promote.py --id trg-e542ce03 --task-ref EXT:<ref>`

### Source: compliance (1 item)

<a id="trg-12f47d39"></a>
- **Compliance: 4 open finding\(s\)** `id=trg-12f47d39 | severity=high | kind=compliance → P1/compliance`
  - 4 open compliance finding\(s\): B/B7, F/F5, F/F6, H/H1  - B/B7: Every commit since release tag has a matching event — 6…
  - Launch payload (copy into a new Claude session):
    ```text
    /shipwright-compliance
    
    Context: 4 open compliance finding(s): B/B7, F/F5, F/F6, H/H1.
    Dashboard: .shipwright/compliance/dashboard.md
    Each finding + hint is listed in this item's detail.
    ```
  - Promote: `triage_promote.py --id trg-12f47d39 --task-ref EXT:<ref>`

### Source: e2e-hygiene (1 item)

<a id="trg-b13d2495"></a>
- **04 \[auto\] Stop 35-no-chat-panel.spec.ts leaving a fixture task behind that fails the E2E teardown** `id=trg-b13d2495 | severity=low | kind=bug → P3/engineering`
  - Running e2e/flows/35-no-chat-panel.spec.ts \(a @smoke test, unrelated to this iterate\) alone or as part of the @smoke…
  - Launch payload (copy into a new Claude session):
    ```text
    /shipwright-iterate <id>
    ```
  - Promote: `triage_promote.py --id trg-b13d2495 --task-ref EXT:<ref>`

### Source: iterate (1 item)

<a id="trg-786eab1f"></a>
- **06 \[auto\] Serve the WebUI over HTTPS so terminal Ctrl+V paste works over Tailscale** `id=trg-786eab1f | severity=medium | kind=enhancement → P2/engineering`
  - Follow-up to iterate-2026-05-18-terminal-copy-paste \(PR #38\), user-approved as a separate iterate during the copy/pas…
  - Promote: `triage_promote.py --id trg-786eab1f --task-ref EXT:<ref>`

### Source: manual (1 item)

<a id="trg-8de744d4"></a>
- **08 \[guided\] Enumerate, mint and re-tag WebUI ACs at AC level \(after 07\)** `id=trg-8de744d4 | severity=medium | kind=compliance → P2/engineering`
  - Follow-up to w5 \(bind-and-promote, campaign req3-06-mechanics-webui\): both external plan reviewers flagged w5 as FR-l…
  - Launch payload (copy into a new Claude session):
    ```text
    /shipwright-iterate AC-level enumeration + minting + test re-tagging for webui (campaign req3-06-mechanics-webui follow-on to w5/this card)
    ```
  - Promote: `triage_promote.py --id trg-8de744d4 --task-ref EXT:<ref>`

### Source: operator (1 item)

<a id="trg-ef19d18d"></a>
- **01 \[auto\] Codextender launches: declare the real context window AND suppress the incompatible-gateway auto-mode notice** `id=trg-ef19d18d | severity=high | kind=bug → P1/engineering`
  - Operator finding \(2026-09-26, live Codextender iterate test\): a Codextender-routed task compacted its conversation al…
  - Launch payload (copy into a new Claude session):
    ```text
    /shipwright-iterate --type bug
    
    Context: Codextender-routed tasks compact their conversation far too early because Claude Code assumes a 200K context window for the unrecognized "sol" model alias, while the real Codex model window is roughly 1,050,000 tokens. Fix: launcher-codextender.ts must set CLAUDE_CODE_MAX_CONTEXT_TOKENS when launching a Codextender task, read dynamically from codextender's own /v1/models max_input_tokens (do not hardcode a duplicate number in webui). Read the referenced triage item in full first for the confirmed root cause and the companion codextender-side fix landing in parallel.
    ```
  - Promote: `triage_promote.py --id trg-ef19d18d --task-ref EXT:<ref>`

### Source: phaseQuality (1 item)

<a id="trg-c4611b77"></a>
- **Phase-quality: 3 open Tier-1 FAIL\(s\) across 2 phase\(s\)** `id=trg-c4611b77 | severity=high | kind=bug → P1/engineering`
  - 3 open phase-quality Tier-1 FAIL\(s\) across 2 phase\(s\): design, iterate.  - design:C1 \(C1 record\_event phase\_comp…
  - Launch payload (copy into a new Claude session):
    ```text
    /shipwright-compliance
    
    Context: 3 open phase-quality Tier-1 FAIL(s): design:C1, design:D1, iterate:W3.
    Dashboard: .shipwright/compliance/skill-compliance/_dashboard.md
    Each FAIL + remediation is listed in this item's detail.
    ```
  - Promote: `triage_promote.py --id trg-c4611b77 --task-ref EXT:<ref>`

### Source: req3-campaign (2 items)

<a id="trg-58a3e32d"></a>
- **09 \[auto\] REQ3.07: backfill the missing AC tests for the WebUI \(after 08\)** `id=trg-58a3e32d | severity=medium | kind=improvement → P2/engineering`
  - Der Coverage-Motor fuer die WebUI, eigener Anker. Schreibt Tests fuer ACs ohne beweisenden Test \(Liste aus REQ3-2b\).…
  - Promote: `triage_promote.py --id trg-58a3e32d --task-ref EXT:<ref>`

<a id="trg-35c0daff"></a>
- **07 \[guided\] REQ3.03: write the requirements and acceptance criteria for the WebUI** `id=trg-35c0daff | severity=medium | kind=improvement → P2/engineering`
  - Phase 2 fuer die WebUI, interaktiv. grill-Runde: Code-Scan auf Vollstaendigkeit, pro Requirement Formulierung + fehlend…
  - Promote: `triage_promote.py --id trg-35c0daff --task-ref EXT:<ref>`

