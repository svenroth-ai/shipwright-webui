# Triage Inbox

> Auto-generated 2026-08-25T12:29:31.029426Z. Items waiting for triage decision.
> Promote via WebUI Triage tab (when v1b lands) or `shared/scripts/tools/triage_promote.py --id <id> --task-ref EXT:<ref>`.

## Status summary

- Total: 207
- Triage: 8 | Promoted: 1 | Dismissed: 197 | Snoozed: 0

## Top 8 items (severity-sorted)

### Source: doubt-reviewer (1 item)

<a id="trg-27f83477"></a>
- **Mission feed: stale commandKey can silently delete an unrelated coalesced card** `id=trg-27f83477 | severity=high | kind=bug → P1/engineering`
  - In missionActivityFeed.ts's tool-result handling, a command failure parks its commandKey \(tool name + detail string\)…
  - Promote: `triage_promote.py --id trg-27f83477 --task-ref EXT:<ref>`

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

### Source: phaseQuality (1 item)

<a id="trg-7ff1d61f"></a>
- **Phase-quality: 6 open Tier-1 FAIL\(s\) across 4 phase\(s\)** `id=trg-7ff1d61f | severity=high | kind=bug → P1/engineering`
  - 6 open phase-quality Tier-1 FAIL\(s\) across 4 phase\(s\): design, iterate, plan, project.  - design:C1 \(C1 record\_ev…
  - Launch payload (copy into a new Claude session):
    ```text
    /shipwright-compliance
    
    Context: 6 open phase-quality Tier-1 FAIL(s): design:C1, design:D1, iterate:T1, iterate:W3, plan:W5, project:T1.
    Dashboard: .shipwright/compliance/skill-compliance/_dashboard.md
    Each FAIL + remediation is listed in this item's detail.
    ```
  - Promote: `triage_promote.py --id trg-7ff1d61f --task-ref EXT:<ref>`

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

