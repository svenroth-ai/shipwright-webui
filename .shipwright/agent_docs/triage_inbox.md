# Triage Inbox

> Auto-generated 2026-07-15T14:43:27.584673Z. Items waiting for triage decision.
> Promote via WebUI Triage tab (when v1b lands) or `shared/scripts/tools/triage_promote.py --id <id> --task-ref EXT:<ref>`.

## Status summary

- Total: 107
- Triage: 6 | Promoted: 1 | Dismissed: 99 | Snoozed: 0

## Top 6 items (severity-sorted)

### Source: compliance (1 item)

<a id="trg-e22f037e"></a>
- **Compliance: 5 open finding(s)** `id=trg-e22f037e | severity=high | kind=compliance → P1/compliance`
  - 5 open compliance finding(s): D/D3, F/F5, G/G2, H/H1, H/H2  - D/D3: Promised FRs delivered — FRs introduced via new_frs…
  - Launch payload (copy into a new Claude session):
    ```text
    /shipwright-compliance
    
    Context: 5 open compliance finding(s): D/D3, F/F5, G/G2, H/H1, H/H2.
    Dashboard: .shipwright/compliance/dashboard.md
    Each finding + hint is listed in this item's detail.
    ```
  - Promote: `triage_promote.py --id trg-e22f037e --task-ref EXT:<ref>`

### Source: iterate (1 item)

<a id="trg-786eab1f"></a>
- **Serve the WebUI over HTTPS so terminal Ctrl+V paste works over Tailscale** `id=trg-786eab1f | severity=medium | kind=enhancement → P2/engineering`
  - Follow-up to iterate-2026-05-18-terminal-copy-paste (PR #38), user-approved as a separate iterate during the copy/paste…
  - Promote: `triage_promote.py --id trg-786eab1f --task-ref EXT:<ref>`

### Source: iterate-A00 (2 items)

<a id="trg-f14dfc01"></a>
- **E2E snapshot-replay specs need the task forced to done/replay-only state (isolated stack)** `id=trg-f14dfc01 | severity=medium | kind=improvement → P2/engineering`
  - v0-9-5-task-type-matrix (and related snapshot-replay assertions) write a cell-state snapshot via writeSnapshotFor and a…
  - Promote: `triage_promote.py --id trg-f14dfc01 --task-ref EXT:<ref>`

<a id="trg-3f6cb64a"></a>
- **E2E full-suite flakes on Windows ConPTY exhaustion (error 267) under load** `id=trg-3f6cb64a | severity=medium | kind=bug → P2/engineering`
  - The pty-heavy E2E specs (75-launch-matrix, v0-9-5-replay-snapshot-envelope, 70-a, 36-rename-title, and others) pass ind…
  - Promote: `triage_promote.py --id trg-3f6cb64a --task-ref EXT:<ref>`

### Source: operator (2 items)

<a id="trg-3edbc478"></a>
- **WOW-Usability campaign v3 (A01-A21): guided Command Center - Weather-Deck glass, Mission Control, Ship's Log, npx launc…** `id=trg-3edbc478 | severity=medium | kind=feature → P2/engineering`
  - Umbrella item for the WebUI WOW-usability campaign, v3. Supersedes trg-6db81c59 (dismissed).  Turns the Command Center…
  - Promote: `triage_promote.py --id trg-3edbc478 --task-ref EXT:<ref>`

<a id="trg-4c020c34"></a>
- **Inbox: answer Claude's question in place - options ARE in the JSONL; spike whether the TUI takes a numeric hotkey** `id=trg-4c020c34 | severity=low | kind=feature → P3/engineering`
  - DEFERRED BY DECISION (Sven, 2026-07-14). The WOW campaign (trg-3edbc478, A19) ships the safe half: the Inbox SURFACES C…
  - Promote: `triage_promote.py --id trg-4c020c34 --task-ref EXT:<ref>`

