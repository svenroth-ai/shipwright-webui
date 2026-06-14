# Triage Inbox

> Auto-generated 2026-06-14T17:16:08.690099Z. Items waiting for triage decision.
> Promote via WebUI Triage tab (when v1b lands) or `shared/scripts/tools/triage_promote.py --id <id> --task-ref EXT:<ref>`.

## Status summary

- Total: 60
- Triage: 3 | Promoted: 1 | Dismissed: 56 | Snoozed: 0

## Top 3 items (severity-sorted)

### Source: compliance (1 item)

<a id="trg-d927f1a3"></a>
- **Compliance: 2 open finding(s)** `id=trg-d927f1a3 | severity=medium | kind=compliance → P2/compliance`
  - 2 open compliance finding(s): D/D3, G/G2  - D/D3: Promised FRs delivered — FRs introduced via new_frs but never reaffir…
  - Launch payload (copy into a new Claude session):
    ```text
    /shipwright-compliance
    
    Context: 2 open compliance finding(s): D/D3, G/G2.
    Dashboard: .shipwright/compliance/dashboard.md
    Each finding + hint is listed in this item's detail.
    ```
  - Promote: `triage_promote.py --id trg-d927f1a3 --task-ref EXT:<ref>`

### Source: iterate (1 item)

<a id="trg-786eab1f"></a>
- **Serve the WebUI over HTTPS so terminal Ctrl+V paste works over Tailscale** `id=trg-786eab1f | severity=medium | kind=enhancement → P2/engineering`
  - Follow-up to iterate-2026-05-18-terminal-copy-paste (PR #38), user-approved as a separate iterate during the copy/paste…
  - Promote: `triage_promote.py --id trg-786eab1f --task-ref EXT:<ref>`

### Source: manual (1 item)

<a id="trg-8b5a9fad"></a>
- **Phone responsive view (<768px) - iterate 2 of 2 (follow-up to FR-01.38 tablet)** `id=trg-8b5a9fad | severity=low | kind=feature → P3/engineering`
  - Follow-up to the tablet responsive view (FR-01.38, PR #139, merged d30d8a7). Make the WebUI usable on phones (375-480px…
  - Promote: `triage_promote.py --id trg-8b5a9fad --task-ref EXT:<ref>`

