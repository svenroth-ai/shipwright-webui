# Triage Inbox

> Auto-generated 2026-08-31T05:20:47.888489Z. Items waiting for triage decision.
> Promote via WebUI Triage tab (when v1b lands) or `shared/scripts/tools/triage_promote.py --id <id> --task-ref EXT:<ref>`.

## Status summary

- Total: 209
- Triage: 7 | Promoted: 1 | Dismissed: 200 | Snoozed: 0

## Top 7 items (severity-sorted)

### Source: compliance (1 item)

<a id="trg-b696524d"></a>
- **Compliance: 4 open finding\(s\)** `id=trg-b696524d | severity=high | kind=compliance → P1/compliance`
  - 4 open compliance finding\(s\): B/B7, H/H1, H/H2, H/H6  - B/B7: Every commit since release tag has a matching event — 1…
  - Launch payload (copy into a new Claude session):
    ```text
    /shipwright-compliance
    
    Context: 4 open compliance finding(s): B/B7, H/H1, H/H2, H/H6.
    Dashboard: .shipwright/compliance/dashboard.md
    Each finding + hint is listed in this item's detail.
    ```
  - Promote: `triage_promote.py --id trg-b696524d --task-ref EXT:<ref>`

### Source: iterate (1 item)

<a id="trg-786eab1f"></a>
- **Serve the WebUI over HTTPS so terminal Ctrl+V paste works over Tailscale** `id=trg-786eab1f | severity=medium | kind=enhancement → P2/engineering`
  - Follow-up to iterate-2026-05-18-terminal-copy-paste \(PR #38\), user-approved as a separate iterate during the copy/pas…
  - Promote: `triage_promote.py --id trg-786eab1f --task-ref EXT:<ref>`

### Source: manual (1 item)

<a id="trg-0f040744"></a>
- **FR-01.01 Task board: two decided gaps from the REQ-3 catalog walk** `id=trg-0f040744 | severity=high | kind=bug → P1/engineering`
  - One card per requirement \(operator rule, 2026-07-28\). Carries every decided change found while walking FR-01.01 again…
  - Promote: `triage_promote.py --id trg-0f040744 --task-ref EXT:<ref>`

### Source: req3-campaign (4 items)

<a id="trg-58a3e32d"></a>
- **REQ3.07 \[CAMPAIGN AUTONOM\] Test-Backfill: fehlende AC-Tests - WebUI** `id=trg-58a3e32d | severity=medium | kind=improvement → P2/engineering`
  - Der Coverage-Motor fuer die WebUI, eigener Anker. Schreibt Tests fuer ACs ohne beweisenden Test \(Liste aus REQ3-2b\).…
  - Promote: `triage_promote.py --id trg-58a3e32d --task-ref EXT:<ref>`

<a id="trg-7dc73a3b"></a>
- **REQ3.08 \[ITERATE\] Mission Control zeigt AC-Ebene - WebUI \(optional\)** `id=trg-7dc73a3b | severity=medium | kind=improvement → P2/engineering`
  - Phase 3/4, interaktiv, optional. Mission Control zeigt pro AC welche Tests geschrieben / geaendert / dazugekommen / ent…
  - Promote: `triage_promote.py --id trg-7dc73a3b --task-ref EXT:<ref>`

<a id="trg-a2017e6f"></a>
- **REQ3.06 \[CAMPAIGN AUTONOM\] Mechanik - WebUI** `id=trg-a2017e6f | severity=medium | kind=improvement → P2/engineering`
  - Phase 3, AUTONOME Kampagne. Sub-Iterates: Evidenzkette, Formkonvergenz \(Origin -&gt; Basis, Layers-Spalte ergaenzen, a…
  - Promote: `triage_promote.py --id trg-a2017e6f --task-ref EXT:<ref>`

<a id="trg-35c0daff"></a>
- **REQ3.03 \[ITERATE\] Requirements + AC schreiben - WebUI** `id=trg-35c0daff | severity=medium | kind=improvement → P2/engineering`
  - Phase 2 fuer die WebUI, interaktiv. grill-Runde: Code-Scan auf Vollstaendigkeit, pro Requirement Formulierung + fehlend…
  - Promote: `triage_promote.py --id trg-35c0daff --task-ref EXT:<ref>`

