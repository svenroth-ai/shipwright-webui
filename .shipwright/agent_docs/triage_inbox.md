# Triage Inbox

> Auto-generated 2026-06-02T10:38:40.112238Z. Items waiting for triage decision.
> Promote via WebUI Triage tab (when v1b lands) or `shared/scripts/tools/triage_promote.py --id <id> --task-ref EXT:<ref>`.

## Status summary

- Total: 1
- Triage: 1 | Promoted: 0 | Dismissed: 0 | Snoozed: 0

## Top 1 items (severity-sorted)

### Source: compliance (1 item)

<a id="trg-9e199e31"></a>
- **Compliance: 5 open finding(s)** `id=trg-9e199e31 | severity=high | kind=compliance → P1/compliance`
  - 5 open compliance finding(s): A/A5.0, B/B7, D/D3, D/D5, G/G2  - A/A5.0: A5 setup — PyYAML unavailable (ModuleNotFoundEr…
  - Launch payload (copy into a new Claude session):
    ```text
    /shipwright-compliance
    
    Context: 5 open compliance finding(s): A/A5.0, B/B7, D/D3, D/D5, G/G2.
    Dashboard: .shipwright/compliance/dashboard.md
    Each finding + hint is listed in this item's detail.
    ```
  - Promote: `triage_promote.py --id trg-9e199e31 --task-ref EXT:<ref>`

