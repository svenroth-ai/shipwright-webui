# Triage Inbox

> Auto-generated 2026-09-17T04:39:03.560694Z. Items waiting for triage decision.
> Promote via WebUI Triage tab (when v1b lands) or `shared/scripts/tools/triage_promote.py --id <id> --task-ref EXT:<ref>`.

## Status summary

- Total: 231
- Triage: 5 | Promoted: 1 | Dismissed: 225 | Snoozed: 0

## Top 5 items (severity-sorted)

### Source: compliance (1 item)

<a id="trg-ac2e459b"></a>
- **Compliance: 1 open finding\(s\)** `id=trg-ac2e459b | severity=medium | kind=compliance → P2/compliance`
  - 1 open compliance finding\(s\): B/B7  - B/B7: Every commit since release tag has a matching event — 1 commit\(s\) since…
  - Launch payload (copy into a new Claude session):
    ```text
    /shipwright-compliance
    
    Context: 1 open compliance finding(s): B/B7.
    Dashboard: .shipwright/compliance/dashboard.md
    Each finding + hint is listed in this item's detail.
    ```
  - Promote: `triage_promote.py --id trg-ac2e459b --task-ref EXT:<ref>`

### Source: iterate (1 item)

<a id="trg-786eab1f"></a>
- **Serve the WebUI over HTTPS so terminal Ctrl+V paste works over Tailscale** `id=trg-786eab1f | severity=medium | kind=enhancement → P2/engineering`
  - Follow-up to iterate-2026-05-18-terminal-copy-paste \(PR #38\), user-approved as a separate iterate during the copy/pas…
  - Promote: `triage_promote.py --id trg-786eab1f --task-ref EXT:<ref>`

### Source: manual (1 item)

<a id="trg-8de744d4"></a>
- **\[STILL BLOCKED — REQ3.03 ceiling open\] AC-level enumeration + minting + test re-tagging for webui is unstarted, needs…** `id=trg-8de744d4 | severity=medium | kind=compliance → P2/engineering`
  - Follow-up to w5 \(bind-and-promote, campaign req3-06-mechanics-webui\): both external plan reviewers flagged w5 as FR-l…
  - Launch payload (copy into a new Claude session):
    ```text
    /shipwright-iterate AC-level enumeration + minting + test re-tagging for webui (campaign req3-06-mechanics-webui follow-on to w5/this card)
    ```
  - Promote: `triage_promote.py --id trg-8de744d4 --task-ref EXT:<ref>`

### Source: req3-campaign (2 items)

<a id="trg-58a3e32d"></a>
- **REQ3.07 \[CAMPAIGN AUTONOM - blocked on AC minting\] Test-Backfill: fehlende AC-Tests - WebUI** `id=trg-58a3e32d | severity=medium | kind=improvement → P2/engineering`
  - Der Coverage-Motor fuer die WebUI, eigener Anker. Schreibt Tests fuer ACs ohne beweisenden Test \(Liste aus REQ3-2b\).…
  - Promote: `triage_promote.py --id trg-58a3e32d --task-ref EXT:<ref>`

<a id="trg-35c0daff"></a>
- **REQ3.03 \[ITERATE\] Requirements + AC schreiben - WebUI \(parser floor closed via PR #462; 17 folded blocks + prose rev…** `id=trg-35c0daff | severity=medium | kind=improvement → P2/engineering`
  - Phase 2 fuer die WebUI, interaktiv. grill-Runde: Code-Scan auf Vollstaendigkeit, pro Requirement Formulierung + fehlend…
  - Promote: `triage_promote.py --id trg-35c0daff --task-ref EXT:<ref>`

