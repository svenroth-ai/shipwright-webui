# Triage Inbox

> Auto-generated 2026-06-05T10:58:14.658113Z. Items waiting for triage decision.
> Promote via WebUI Triage tab (when v1b lands) or `shared/scripts/tools/triage_promote.py --id <id> --task-ref EXT:<ref>`.

## Status summary

- Total: 2
- Triage: 1 | Promoted: 0 | Dismissed: 1 | Snoozed: 0

## Top 1 items (severity-sorted)

### Source: compliance (1 item)

<a id="trg-26bf7ca1"></a>
- **Compliance: 1 open finding(s)** `id=trg-26bf7ca1 | severity=medium | kind=compliance → P2/compliance`
  - 1 open compliance finding(s): B/B7  - B/B7: Every commit since release tag has a matching event — 9 commit(s) since v0.…
  - Launch payload (copy into a new Claude session):
    ```text
    /shipwright-compliance
    
    Context: 1 open compliance finding(s): B/B7.
    Dashboard: .shipwright/compliance/dashboard.md
    Each finding + hint is listed in this item's detail.
    ```
  - Promote: `triage_promote.py --id trg-26bf7ca1 --task-ref EXT:<ref>`

