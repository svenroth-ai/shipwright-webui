# Triage Inbox

> Auto-generated 2026-07-22T07:21:46.920230Z. Items waiting for triage decision.
> Promote via WebUI Triage tab (when v1b lands) or `shared/scripts/tools/triage_promote.py --id <id> --task-ref EXT:<ref>`.

## Status summary

- Total: 127
- Triage: 4 | Promoted: 1 | Dismissed: 121 | Snoozed: 0

## Top 4 items (severity-sorted)

### Source: compliance (1 item)

<a id="trg-77bdf9c5"></a>
- **Compliance: 10 open finding(s)** `id=trg-77bdf9c5 | severity=high | kind=compliance → P1/compliance`
  - 10 open compliance finding(s): B/B7, C/C1, D/D1, D/D2, D/D3, D/D4, F/F5, G/G2, H/H1, H/H2  - B/B7: Every commit since r…
  - Launch payload (copy into a new Claude session):
    ```text
    /shipwright-compliance
    
    Context: 10 open compliance finding(s): B/B7, C/C1, D/D1, D/D2, D/D3, D/D4, F/F5, G/G2, H/H1, H/H2.
    Dashboard: .shipwright/compliance/dashboard.md
    Each finding + hint is listed in this item's detail.
    ```
  - Promote: `triage_promote.py --id trg-77bdf9c5 --task-ref EXT:<ref>`

### Source: internal-code-review (1 item)

<a id="trg-53b00a71"></a>
- **Transcript pane still requests the whole JSONL every second (client cursor unused)** `id=trg-53b00a71 | severity=medium | kind=improvement → P2/engineering`
  - Two follow-ups left by the positional-tail-read run, both deliberately out of that reader-level charter.  1. CLIENT CUR…
  - Promote: `triage_promote.py --id trg-53b00a71 --task-ref EXT:<ref>`

### Source: iterate (1 item)

<a id="trg-786eab1f"></a>
- **Serve the WebUI over HTTPS so terminal Ctrl+V paste works over Tailscale** `id=trg-786eab1f | severity=medium | kind=enhancement → P2/engineering`
  - Follow-up to iterate-2026-05-18-terminal-copy-paste (PR #38), user-approved as a separate iterate during the copy/paste…
  - Promote: `triage_promote.py --id trg-786eab1f --task-ref EXT:<ref>`

### Source: operator (1 item)

<a id="trg-4c020c34"></a>
- **Inbox: answer Claude's question in place - options ARE in the JSONL; spike whether the TUI takes a numeric hotkey** `id=trg-4c020c34 | severity=low | kind=feature → P3/engineering`
  - DEFERRED BY DECISION (Sven, 2026-07-14). The WOW campaign (trg-3edbc478, A19) ships the safe half: the Inbox SURFACES C…
  - Promote: `triage_promote.py --id trg-4c020c34 --task-ref EXT:<ref>`

