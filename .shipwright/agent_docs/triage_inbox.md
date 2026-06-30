# Triage Inbox

> Auto-generated 2026-06-30T19:23:34.378558Z. Items waiting for triage decision.
> Promote via WebUI Triage tab (when v1b lands) or `shared/scripts/tools/triage_promote.py --id <id> --task-ref EXT:<ref>`.

## Status summary

- Total: 76
- Triage: 4 | Promoted: 1 | Dismissed: 71 | Snoozed: 0

## Top 4 items (severity-sorted)

### Source: iterate (1 item)

<a id="trg-786eab1f"></a>
- **Serve the WebUI over HTTPS so terminal Ctrl+V paste works over Tailscale** `id=trg-786eab1f | severity=medium | kind=enhancement → P2/engineering`
  - Follow-up to iterate-2026-05-18-terminal-copy-paste (PR #38), user-approved as a separate iterate during the copy/paste…
  - Promote: `triage_promote.py --id trg-786eab1f --task-ref EXT:<ref>`

### Source: scorecard-followup (3 items)

<a id="trg-7e0aafc4"></a>
- **Resolve open dependency vulnerabilities (OSV)** `id=trg-7e0aafc4 | severity=high | kind=maintenance → P1/engineering`
  - OSV/Scorecard's Vulnerabilities check reports open advisories in the dependency tree. Triage and remediate via the secu…
  - Promote: `triage_promote.py --id trg-7e0aafc4 --task-ref EXT:<ref>`

<a id="trg-68c570d4"></a>
- **Tighten GitHub Actions workflow token permissions** `id=trg-68c570d4 | severity=high | kind=improvement → P1/engineering`
  - Workflows request broader GITHUB_TOKEN scopes than needed (OpenSSF Scorecard Token-Permissions = 0). Declare a minimal…
  - Promote: `triage_promote.py --id trg-68c570d4 --task-ref EXT:<ref>`

<a id="trg-6e1c6165"></a>
- **Supply-chain hardening: pin Actions by SHA + review branch protection** `id=trg-6e1c6165 | severity=medium | kind=improvement → P2/engineering`
  - OpenSSF Scorecard flagged Pinned-Dependencies and Branch-Protection. Pin GitHub Actions by full commit SHA; strengthen…
  - Promote: `triage_promote.py --id trg-6e1c6165 --task-ref EXT:<ref>`

