# Triage Inbox

> Auto-generated 2026-06-28T07:25:36.473436Z. Items waiting for triage decision.
> Promote via WebUI Triage tab (when v1b lands) or `shared/scripts/tools/triage_promote.py --id <id> --task-ref EXT:<ref>`.

## Status summary

- Total: 70
- Triage: 2 | Promoted: 1 | Dismissed: 67 | Snoozed: 0

## Top 2 items (severity-sorted)

### Source: compliance (1 item)

<a id="trg-9e87ad6e"></a>
- **Compliance: 4 open finding(s)** `id=trg-9e87ad6e | severity=medium | kind=compliance → P2/compliance`
  - 4 open compliance finding(s): B/B7, D/D3, G/G2, H/H2  - B/B7: Every commit since release tag has a matching event — 1 c…
  - Launch payload (copy into a new Claude session):
    ```text
    /shipwright-compliance
    
    Context: 4 open compliance finding(s): B/B7, D/D3, G/G2, H/H2.
    Dashboard: .shipwright/compliance/dashboard.md
    Each finding + hint is listed in this item's detail.
    ```
  - Promote: `triage_promote.py --id trg-9e87ad6e --task-ref EXT:<ref>`

### Source: iterate (1 item)

<a id="trg-786eab1f"></a>
- **Serve the WebUI over HTTPS so terminal Ctrl+V paste works over Tailscale** `id=trg-786eab1f | severity=medium | kind=enhancement → P2/engineering`
  - Follow-up to iterate-2026-05-18-terminal-copy-paste (PR #38), user-approved as a separate iterate during the copy/paste…
  - Promote: `triage_promote.py --id trg-786eab1f --task-ref EXT:<ref>`

