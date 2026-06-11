# Triage Inbox

> Auto-generated 2026-06-11T19:34:02.879462Z. Items waiting for triage decision.
> Promote via WebUI Triage tab (when v1b lands) or `shared/scripts/tools/triage_promote.py --id <id> --task-ref EXT:<ref>`.

## Status summary

- Total: 50
- Triage: 3 | Promoted: 1 | Dismissed: 46 | Snoozed: 0

## Top 3 items (severity-sorted)

### Source: compliance (1 item)

<a id="trg-899beca1"></a>
- **Compliance: 2 open finding(s)** `id=trg-899beca1 | severity=medium | kind=compliance → P2/compliance`
  - 2 open compliance finding(s): B/B7, G/G2  - B/B7: Every commit since release tag has a matching event — 1 commit(s) sin…
  - Launch payload (copy into a new Claude session):
    ```text
    /shipwright-compliance
    
    Context: 2 open compliance finding(s): B/B7, G/G2.
    Dashboard: .shipwright/compliance/dashboard.md
    Each finding + hint is listed in this item's detail.
    ```
  - Promote: `triage_promote.py --id trg-899beca1 --task-ref EXT:<ref>`

### Source: iterate (1 item)

<a id="trg-786eab1f"></a>
- **Serve the WebUI over HTTPS so terminal Ctrl+V paste works over Tailscale** `id=trg-786eab1f | severity=medium | kind=enhancement → P2/engineering`
  - Follow-up to iterate-2026-05-18-terminal-copy-paste (PR #38), user-approved as a separate iterate during the copy/paste…
  - Promote: `triage_promote.py --id trg-786eab1f --task-ref EXT:<ref>`

### Source: manual (1 item)

<a id="trg-380aedd1"></a>
- **Campaign board: migrate consumer from status.json to event-log projection** `id=trg-380aedd1 | severity=medium | kind=improvement → P2/engineering`
  - The WebUI server reads campaign status from .shipwright/planning/iterate/campaigns/<slug>/status.json (server/src/core/…
  - Promote: `triage_promote.py --id trg-380aedd1 --task-ref EXT:<ref>`

