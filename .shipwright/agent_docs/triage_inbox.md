# Triage Inbox

> Auto-generated 2026-06-17T06:55:51.831073Z. Items waiting for triage decision.
> Promote via WebUI Triage tab (when v1b lands) or `shared/scripts/tools/triage_promote.py --id <id> --task-ref EXT:<ref>`.

## Status summary

- Total: 61
- Triage: 2 | Promoted: 1 | Dismissed: 58 | Snoozed: 0

## Top 2 items (severity-sorted)

### Source: compliance (1 item)

<a id="trg-93c92fdc"></a>
- **Compliance: 3 open finding(s)** `id=trg-93c92fdc | severity=high | kind=compliance → P1/compliance`
  - 3 open compliance finding(s): D/D3, G/G2, H/H1  - D/D3: Promised FRs delivered — FRs introduced via new_frs but never r…
  - Launch payload (copy into a new Claude session):
    ```text
    /shipwright-compliance
    
    Context: 3 open compliance finding(s): D/D3, G/G2, H/H1.
    Dashboard: .shipwright/compliance/dashboard.md
    Each finding + hint is listed in this item's detail.
    ```
  - Promote: `triage_promote.py --id trg-93c92fdc --task-ref EXT:<ref>`

### Source: iterate (1 item)

<a id="trg-786eab1f"></a>
- **Serve the WebUI over HTTPS so terminal Ctrl+V paste works over Tailscale** `id=trg-786eab1f | severity=medium | kind=enhancement → P2/engineering`
  - Follow-up to iterate-2026-05-18-terminal-copy-paste (PR #38), user-approved as a separate iterate during the copy/paste…
  - Promote: `triage_promote.py --id trg-786eab1f --task-ref EXT:<ref>`

