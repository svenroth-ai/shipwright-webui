# Security Policy

## Supported Versions

The Shipwright Command Center is currently in beta. Security updates are provided for the latest `main` branch only. Older releases do not receive backports.

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, report them via **[GitHub Security Advisories](https://github.com/svenroth-ai/shipwright-webui/security/advisories/new)**. This creates a private channel between you and the maintainer.

### What to include

- **Description** of the vulnerability
- **Affected component** — server route, client component, terminal pty bridge, or build tooling
- **Steps to reproduce** — a minimal reproducer is most helpful
- **Impact assessment** — what can an attacker do?
- **Suggested fix** if you have one (not required)

### Response expectations

| Timeframe | What to expect |
|-----------|----------------|
| Within 48 hours | Initial acknowledgment |
| Within 7 days | Triage and severity assessment |
| Within 14 days | Mitigation plan or fix in progress |
| Within 30 days | Fix released for critical issues (when feasible) |

These are best-effort targets for a solo-maintainer project.

## Threat Model

The Command Center is a **local-first** developer tool. By design it runs on the operator's own workstation (or a private Tailscale-reachable host) and observes Claude Code session transcripts on disk. The following surfaces are the security-relevant boundaries:

### 1. Embedded terminal pane (`server/src/terminal/`)

The terminal hosts a real shell process per task (node-pty + xterm.js). Hardening rules — enforced by tests and documented as DO-NOT guards in `CLAUDE.md`:

- **Shell-binary whitelist** (`pty-manager.ts`): only `pwsh`, `powershell.exe`, `cmd.exe`, `bash`, `zsh`, `sh`, `fish`. **Never `claude` directly.** Basename-normalised so absolute paths are checked.
- **Loopback-only WS upgrade by default**: the `/api/terminal/:taskId/ws` endpoint mirrors the HTTP CORS gate. Tailscale / LAN exposure is opt-in via `HONO_HOST` + `WEBUI_TRUSTED_ORIGINS`.
- **Image-paste path-guard**: `realPathGuard` resolves the target directory at write time (defeats symlinked-redirect attacks). 8 MiB body cap + 9 MiB `Content-Length` precheck + magic-byte mime sniff.
- **Scrollback files**: stored under `~/.shipwright-webui/terminal-scrollback/<taskId>.log` with 0600 perms (POSIX best-effort on Windows). 24h TTL; UUID format strictly validated on every public method.

### 2. HTTP / WebSocket surface (`server/src/external/routes.ts`)

- **Origin gate**: `resolveTrustedOrigins` derives policy from `SHIPWRIGHT_NETWORK_PROFILE` (`local` → loopback only; `tailscale` → loopback + tailnet IPs + `*.ts.net`; `open` → any Origin) with `WEBUI_TRUSTED_ORIGINS` as the narrow override.
- **No SSE / no chokidar**: transcript reads are stateless byte-range GETs (`?fromByte=<n>&expectFingerprint=<fp>`); no per-session state lives server-side.
- **Read-only on Claude's JSONL files**: `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl` is observed but never mutated.

### 3. Subprocess spawning (Preview server)

The Preview Button spawns the user-configured `dev_server.command` from each project's stack profile. To prevent command-injection:

- **`shell: false`**: tokenised argv via `preview-session-manager.ts`. The `shell: true` path was explicitly rejected (DO-NOT guard #9).
- **Path-guard for the tree + file routes**: `realpath + path.relative`, NOT `startsWith` (defeats symlinks, junction points). Null-byte input is hard-rejected.

### 4. Persistent state (`~/.shipwright-webui/`)

- `sdk-sessions.json`, `projects.json`, `settings.json` — written via `proper-lockfile` (directory-based lock). `PATCH /tasks/:id` surfaces `ELOCKED` as 409 so the client can retry.
- Stale lock cleanup on boot.

### 5. Dependency hygiene

- Dependency CVEs are surfaced by the **Trivy SCA scan** in CI (`trivy fs --scanners vuln`) on every PR. There is no Dependabot config in this repo; GitHub Dependabot **alerts** may be enabled separately in repository settings.
- xterm.js + addons are **exact-pinned** (server + client; matched paired-set per ADR-097). DO NOT switch to caret ranges — version drift between client and server would break the snapshot-replay envelope contract.

## Known Limitations

Because the Command Center observes Claude Code sessions, **it is not a sandbox**. By design, it:

- Spawns real shell processes via the embedded terminal (whitelisted binaries)
- Runs user-configured dev-server commands via the Preview Button
- Reads JSONL transcripts from `~/.claude/projects/`
- Persists task metadata under `~/.shipwright-webui/`

**Do not expose the Command Center to untrusted networks** without setting an explicit `WEBUI_TRUSTED_ORIGINS` allowlist. The default `local` profile binds to loopback only and is safe to leave running on a personal workstation.

## Acknowledgments

Security researchers who responsibly disclose vulnerabilities will be credited in the release notes and the repository's security advisories (unless they request anonymity).

---

For general questions about the Command Center's security posture, open a public issue with the `security-question` label. For actual vulnerabilities, use GitHub Security Advisories as described above.
