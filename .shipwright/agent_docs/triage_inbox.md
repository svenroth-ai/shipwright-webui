# Triage Inbox

> Auto-generated 2026-06-18T07:16:53.061024Z. Items waiting for triage decision.
> Promote via WebUI Triage tab (when v1b lands) or `shared/scripts/tools/triage_promote.py --id <id> --task-ref EXT:<ref>`.

## Status summary

- Total: 68
- Triage: 2 | Promoted: 1 | Dismissed: 65 | Snoozed: 0

## Top 2 items (severity-sorted)

### Source: compliance (1 item)

<a id="trg-e6dc4f33"></a>
- **Compliance: 2 open finding(s)** `id=trg-e6dc4f33 | severity=high | kind=compliance → P1/compliance`
  - 2 open compliance finding(s): H/H1, H/H2  - H/H1: Bloat drift (oversize file not in baseline) — client/src/components/t…
  - Launch payload (copy into a new Claude session):
    ```text
    /shipwright-compliance
    
    Context: 2 open compliance finding(s): H/H1, H/H2.
    Dashboard: .shipwright/compliance/dashboard.md
    Each finding + hint is listed in this item's detail.
    ```
  - Promote: `triage_promote.py --id trg-e6dc4f33 --task-ref EXT:<ref>`

### Source: iterate (1 item)

<a id="trg-786eab1f"></a>
- **Serve the WebUI over HTTPS so terminal Ctrl+V paste works over Tailscale** `id=trg-786eab1f | severity=medium | kind=enhancement → P2/engineering`
  - Follow-up to iterate-2026-05-18-terminal-copy-paste (PR #38), user-approved as a separate iterate during the copy/paste…
  - Promote: `triage_promote.py --id trg-786eab1f --task-ref EXT:<ref>`

