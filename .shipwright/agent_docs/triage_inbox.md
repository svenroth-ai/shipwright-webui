# Triage Inbox

> Auto-generated 2026-05-22T21:15:05.573157Z. Items waiting for triage decision.
> Promote via WebUI Triage tab (when v1b lands) or `shared/scripts/tools/triage_promote.py --id <id> --task-ref EXT:<ref>`.

## Status summary

- Total: 28
- Triage: 8 | Promoted: 0 | Dismissed: 20 | Snoozed: 0

## Top 8 items (severity-sorted)

### Source: compliance (5 items)

<a id="trg-3d801bba"></a>
- **F/F7: CLAUDE.md inline iterate-annotation leak** `id=trg-3d801bba | severity=medium | kind=compliance → P2/compliance`
  - 8 inline 'Iterate X (ADR-NN)' references in CLAUDE.md exceed the 5-reference cap — move per-iterate detail into .shipwr…
  - Promote: `triage_promote.py --id trg-3d801bba --task-ref EXT:<ref>`

<a id="trg-5db38cca"></a>
- **F/F6: CLAUDE.md size hygiene** `id=trg-5db38cca | severity=medium | kind=compliance → P2/compliance`
  - CLAUDE.md is 270 lines, exceeds the 200-line hygiene cap — consider moving per-iterate detail into .shipwright/planning…
  - Promote: `triage_promote.py --id trg-5db38cca --task-ref EXT:<ref>`

<a id="trg-72d0b5d9"></a>
- **F/F5: Architecture marker vs arch-impact drops** `id=trg-72d0b5d9 | severity=medium | kind=compliance → P2/compliance`
  - architecture.md has no shipwright:architecture marker, but 1 arch-impact drop(s) exist — run the first sync to establis…
  - Promote: `triage_promote.py --id trg-72d0b5d9 --task-ref EXT:<ref>`

<a id="trg-1cb29e00"></a>
- **F/F4: ADR bloat (> 60 lines without spec_ref)** `id=trg-1cb29e00 | severity=medium | kind=compliance → P2/compliance`
  - 5 ADR(s) exceed 60 lines without a spec_ref link — refactor each into .shipwright/planning/adr/<NNN>-<slug>.md and link…
  - Promote: `triage_promote.py --id trg-1cb29e00 --task-ref EXT:<ref>`

<a id="trg-b9cce6a1"></a>
- **B/B7: Every commit since release tag has a matching event** `id=trg-b9cce6a1 | severity=medium | kind=compliance → P2/compliance`
  - 14 commit(s) since v0.14.0 have no matching event: de956bce, c8a28d1b, c9b662b8, 63859305, eaeeb452, (+9 more) \| evide…
  - Promote: `triage_promote.py --id trg-b9cce6a1 --task-ref EXT:<ref>`

### Source: iterate (3 items)

<a id="trg-786eab1f"></a>
- **Serve the WebUI over HTTPS so terminal Ctrl+V paste works over Tailscale** `id=trg-786eab1f | severity=medium | kind=enhancement → P2/engineering`
  - Follow-up to iterate-2026-05-18-terminal-copy-paste (PR #38), user-approved as a separate iterate during the copy/paste…
  - Promote: `triage_promote.py --id trg-786eab1f --task-ref EXT:<ref>`

<a id="trg-cc7c7875"></a>
- **Re-open a Done/Closed task — counterpart to Move-to-Backlog** `id=trg-cc7c7875 | severity=low | kind=enhancement → P3/engineering`
  - Counterpart direction to iterate-2026-05-17-move-to-backlog, which added In-Progress->Backlog only. Done is a terminal…
  - Promote: `triage_promote.py --id trg-cc7c7875 --task-ref EXT:<ref>`

<a id="trg-88735427"></a>
- **Drag-and-drop TaskBoard cards to the Backlog / Done columns** `id=trg-88735427 | severity=low | kind=enhancement → P3/engineering`
  - Follow-up to iterate-2026-05-17-move-to-backlog (agreed deferral). Add @dnd-kit drag-and-drop so a card can be dragged…
  - Promote: `triage_promote.py --id trg-88735427 --task-ref EXT:<ref>`

