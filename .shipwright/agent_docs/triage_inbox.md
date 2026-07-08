# Triage Inbox

> Auto-generated 2026-07-08T08:46:53.879152Z. Items waiting for triage decision.
> Promote via WebUI Triage tab (when v1b lands) or `shared/scripts/tools/triage_promote.py --id <id> --task-ref EXT:<ref>`.

## Status summary

- Total: 84
- Triage: 3 | Promoted: 1 | Dismissed: 80 | Snoozed: 0

## Top 3 items (severity-sorted)

### Source: compliance (1 item)

<a id="trg-3b7224fd"></a>
- **Compliance: 5 open finding(s)** `id=trg-3b7224fd | severity=high | kind=compliance → P1/compliance`
  - 5 open compliance finding(s): B/B7, D/D3, G/G2, H/H1, H/H2  - B/B7: Every commit since release tag has a matching event…
  - Launch payload (copy into a new Claude session):
    ```text
    /shipwright-compliance
    
    Context: 5 open compliance finding(s): B/B7, D/D3, G/G2, H/H1, H/H2.
    Dashboard: .shipwright/compliance/dashboard.md
    Each finding + hint is listed in this item's detail.
    ```
  - Promote: `triage_promote.py --id trg-3b7224fd --task-ref EXT:<ref>`

### Source: github (1 item)

<a id="trg-612ff3f1"></a>
- **GitHub security: 2 shipwright-security finding(s) (low)** `id=trg-612ff3f1 | severity=low | kind=improvement → P3/engineering`
  - Repo svenroth-ai/shipwright-webui \| code-scanning: (unavailable) \| dependabot: (unavailable) \| shipwright-security:…
  - Launch payload (copy into a new Claude session):
    ```text
    /shipwright-security
    
    Context: the shipwright-security CI workflow reports 2 open finding(s) for svenroth-ai/shipwright-webui (GHAS Code Scanning is not configured).
    Severity breakdown — shipwright-security: 2 low.
    Workflow run: https://github.com/svenroth-ai/shipwright-webui/actions/runs/28854756284
    Re-scan locally: see docs/security-ci-setup.md
    Source: triage item gh-security:svenroth-ai/shipwright-webui
    ```
  - Promote: `triage_promote.py --id trg-612ff3f1 --task-ref EXT:<ref>`

### Source: iterate (1 item)

<a id="trg-786eab1f"></a>
- **Serve the WebUI over HTTPS so terminal Ctrl+V paste works over Tailscale** `id=trg-786eab1f | severity=medium | kind=enhancement → P2/engineering`
  - Follow-up to iterate-2026-05-18-terminal-copy-paste (PR #38), user-approved as a separate iterate during the copy/paste…
  - Promote: `triage_promote.py --id trg-786eab1f --task-ref EXT:<ref>`

