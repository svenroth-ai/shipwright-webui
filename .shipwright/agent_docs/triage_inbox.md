# Triage Inbox

> Auto-generated 2026-06-07T10:32:21.475380Z. Items waiting for triage decision.
> Promote via WebUI Triage tab (when v1b lands) or `shared/scripts/tools/triage_promote.py --id <id> --task-ref EXT:<ref>`.

## Status summary

- Total: 36
- Triage: 2 | Promoted: 1 | Dismissed: 33 | Snoozed: 0

## Top 2 items (severity-sorted)

### Source: compliance (1 item)

<a id="trg-68bc2f62"></a>
- **Compliance: 1 open finding(s)** `id=trg-68bc2f62 | severity=low | kind=compliance → P3/compliance`
  - 1 open compliance finding(s): A/A5.6  - A/A5.6: Dormant-trigger contract honored — non-dormant trigger active: pull_req…
  - Launch payload (copy into a new Claude session):
    ```text
    /shipwright-compliance
    
    Context: 1 open compliance finding(s): A/A5.6.
    Dashboard: .shipwright/compliance/dashboard.md
    Each finding + hint is listed in this item's detail.
    ```
  - Promote: `triage_promote.py --id trg-68bc2f62 --task-ref EXT:<ref>`

### Source: iterate (1 item)

<a id="trg-786eab1f"></a>
- **Serve the WebUI over HTTPS so terminal Ctrl+V paste works over Tailscale** `id=trg-786eab1f | severity=medium | kind=enhancement → P2/engineering`
  - Follow-up to iterate-2026-05-18-terminal-copy-paste (PR #38), user-approved as a separate iterate during the copy/paste…
  - Promote: `triage_promote.py --id trg-786eab1f --task-ref EXT:<ref>`

