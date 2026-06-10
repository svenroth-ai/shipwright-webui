# Triage Inbox

> Auto-generated 2026-06-10T07:48:04.067902Z. Items waiting for triage decision.
> Promote via WebUI Triage tab (when v1b lands) or `shared/scripts/tools/triage_promote.py --id <id> --task-ref EXT:<ref>`.

## Status summary

- Total: 48
- Triage: 4 | Promoted: 1 | Dismissed: 43 | Snoozed: 0

## Top 4 items (severity-sorted)

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

### Source: iterate (2 items)

<a id="trg-9edbab4d"></a>
- **Campaign autonomous loop never marks the running sub-iterate in_progress (status.json)** `id=trg-9edbab4d | severity=medium | kind=improvement → P2/engineering`
  - Producer follow-up to webui iterate-2026-06-08-campaign-attached-run-guard (side b shipped). campaign-mode.md step 3g c…
  - Promote: `triage_promote.py --id trg-9edbab4d --task-ref EXT:<ref>`

<a id="trg-786eab1f"></a>
- **Serve the WebUI over HTTPS so terminal Ctrl+V paste works over Tailscale** `id=trg-786eab1f | severity=medium | kind=enhancement → P2/engineering`
  - Follow-up to iterate-2026-05-18-terminal-copy-paste (PR #38), user-approved as a separate iterate during the copy/paste…
  - Promote: `triage_promote.py --id trg-786eab1f --task-ref EXT:<ref>`

### Source: ux (1 item)

<a id="trg-6ead6610"></a>
- **Campaign/Triage launch CTAs have no running-guard + loop never writes in_progress** `id=trg-6ead6610 | severity=medium | kind=improvement → P2/engineering`
  - Two related gaps in the campaign launch surface. (1) DOUBLE-LAUNCH FOOTGUN: CampaignLaneCard.tsx renders 'Launch (Cx)'…
  - Promote: `triage_promote.py --id trg-6ead6610 --task-ref EXT:<ref>`

