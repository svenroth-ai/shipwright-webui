# Triage Inbox

> Auto-generated 2026-07-08T08:42:03.071892Z. Items waiting for triage decision.
> Promote via WebUI Triage tab (when v1b lands) or `shared/scripts/tools/triage_promote.py --id <id> --task-ref EXT:<ref>`.

## Status summary

- Total: 84
- Triage: 2 | Promoted: 1 | Dismissed: 81 | Snoozed: 0

## Top 2 items (severity-sorted)

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

