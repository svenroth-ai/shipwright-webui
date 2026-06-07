# Triage Inbox

> Auto-generated 2026-06-07T22:17:13.277042Z. Items waiting for triage decision.
> Promote via WebUI Triage tab (when v1b lands) or `shared/scripts/tools/triage_promote.py --id <id> --task-ref EXT:<ref>`.

## Status summary

- Total: 38
- Triage: 3 | Promoted: 1 | Dismissed: 34 | Snoozed: 0

## Top 3 items (severity-sorted)

### Source: compliance (2 items)

<a id="trg-7006ff42"></a>
- **Compliance: 3 open finding(s)** `id=trg-7006ff42 | severity=medium | kind=compliance → P2/compliance`
  - 3 open compliance finding(s): A/A5.6, F/F5, G/G2  - A/A5.6: Dormant-trigger contract honored — non-dormant trigger acti…
  - Launch payload (copy into a new Claude session):
    ```text
    /shipwright-compliance
    
    Context: 3 open compliance finding(s): A/A5.6, F/F5, G/G2.
    Dashboard: .shipwright/compliance/dashboard.md
    Each finding + hint is listed in this item's detail.
    ```
  - Promote: `triage_promote.py --id trg-7006ff42 --task-ref EXT:<ref>`

<a id="trg-eb965f28"></a>
- **[monorepo] A5.6 dormant-trigger: add a5_phase_b_activated opt-in (deliberate Phase B is a false-positive)** `id=trg-eb965f28 | severity=low | kind=improvement → P3/compliance`
  - PRODUCER-SIDE FIX (shipwright monorepo, NOT webui).  WHERE: plugins/shipwright-compliance/.../scripts/audit/group_a5.py…
  - Promote: `triage_promote.py --id trg-eb965f28 --task-ref EXT:<ref>`

### Source: iterate (1 item)

<a id="trg-786eab1f"></a>
- **Serve the WebUI over HTTPS so terminal Ctrl+V paste works over Tailscale** `id=trg-786eab1f | severity=medium | kind=enhancement → P2/engineering`
  - Follow-up to iterate-2026-05-18-terminal-copy-paste (PR #38), user-approved as a separate iterate during the copy/paste…
  - Promote: `triage_promote.py --id trg-786eab1f --task-ref EXT:<ref>`

