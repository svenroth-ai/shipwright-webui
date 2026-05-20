# Contributing to the Shipwright Command Center

Thanks for your interest. This document explains how to set up your environment, the rules for code contributions, and what to expect from the review process.

> **Early Access:** The Command Center is currently in Early Access. Breaking changes are possible. Please open an issue before investing significant time in a large contribution.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Before You Contribute](#before-you-contribute)
- [Development Setup](#development-setup)
- [Running Tests Locally](#running-tests-locally)
- [Architecture Rules of Record](#architecture-rules-of-record)
- [Pull Request Process](#pull-request-process)
- [Commit Guidelines](#commit-guidelines)
- [Reporting Security Issues](#reporting-security-issues)

---

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating you agree to uphold it. Report unacceptable behavior via the channel described in [SECURITY.md](SECURITY.md).

## Before You Contribute

- **Small changes** (typos, docs, tests for existing code): open a PR directly.
- **Bug fixes**: open an issue first or reference an existing one.
- **New features**: open a discussion or issue first. The Command Center is a thin layer on top of Claude Code sessions; we keep its scope focused and reject changes that re-introduce architectural surfaces removed by ADRs (see the DO-NOT guards in `CLAUDE.md`).
- **Architectural changes**: read `.shipwright/agent_docs/decision_log.md` first. Decisions with broad reach (terminal pty bridge, transcript reader, snapshot envelope) are codified as ADRs and have regression tests that block their reversal.

## Development Setup

Prerequisites: Node 20+, npm 10+, a Claude Code CLI install at version ≥ `MIN_SUPPORTED_CLI` (see `server/src/core/cli-compat.ts`).

This repo has **no root `package.json`**. `server/` and `client/` are independent npm workspaces:

```bash
# One-time install
cd server && npm install
cd ../client && npm install

# Terminal 1 — Hono backend (tsx watch, port 3847)
cd server && npm run dev

# Terminal 2 — Vite client (port 5173, proxies /api to 3847)
cd client && npm run dev
```

Then open <http://localhost:5173>.

For environment variables (`PORT`, `VITE_PORT`, `SHIPWRIGHT_NETWORK_PROFILE`, `HONO_HOST`, `WEBUI_TRUSTED_ORIGINS`, …) see [`docs/guide.md`](docs/guide.md) and `.env.example`.

## Running Tests Locally

Per workspace:

```bash
# Server
cd server
npm run build         # tsc + copy-assets
SHIPWRIGHT_NETWORK_PROFILE=local npm test
npm run lint          # oxlint (warnings allowed)

# Client
cd ../client
npm run build         # tsc -b + vite build
npm test              # vitest
npm run lint          # oxlint
npm run typecheck     # tsc --noEmit
```

**Server tests require `SHIPWRIGHT_NETWORK_PROFILE=local`**: the CORS test in `index.test.ts` reads the network profile from the environment, and a Tailscale-profile host would fail it.

### End-to-end tests

```bash
cd client
npx playwright install --with-deps   # one-time
npm run test:e2e
```

The E2E suite needs a running stack (server on `:3847`, client on `:5173`). Some specs spin up an isolated `USERPROFILE` to avoid polluting the real `~/.shipwright-webui/` registry.

## Architecture Rules of Record

Two load-bearing rules. Violating either breaks the architecture; both have regression tests:

1. **Webui spawns no Claude process directly.** The embedded terminal hosts only a whitelisted shell (`pty-manager.ts` enforces this). Claude is launched user-initiated, inside that shell, via a client-side WS data-frame. See ADR-034 + ADR-067 + ADR-068-A1.
2. **The server is stateless on transcript reads.** Clients pass `?fromByte=<offset>&expectFingerprint=<fp>`; no per-session byte-offset cache lives server-side. Multi-tab support comes for free.

Full list of DO-NOT guards: see the "DO-NOT regression guards" section in [`CLAUDE.md`](CLAUDE.md).

## Pull Request Process

1. Branch from `main`. Use a descriptive name: `fix/<short-desc>`, `feat/<short-desc>`, `docs/<short-desc>`.
2. Make your change, including tests. Files over 300 LOC should be split if the addition pushes them past that.
3. Run the relevant local checks (build, test, lint, typecheck).
4. Add a CHANGELOG fragment under `CHANGELOG-unreleased.d/<Added|Changed|Deprecated|Fixed|Removed|Security>/<short-desc>.md` describing the user-facing impact. The fragment is consumed by the release tooling at version-bump time.
5. Open a PR. Keep the title under 70 characters; use the description body for detail.
6. Be patient on review — this is a solo-maintainer project.

The CI workflow runs build, lint, typecheck, and tests on every PR. PRs that fail CI block on red.

## Commit Guidelines

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short summary>

<optional body>

<optional footer>
```

Common types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`.

Typical scopes: `terminal`, `transcript`, `inbox`, `triage`, `wizard`, `preview`, `actions`, `compliance`, `tooling`.

Example: `fix(terminal): close pty on WS detach when no other reader is attached`.

Keep each commit a single coherent change. Squash trivial fix-up commits before opening the PR; do NOT squash commits that tell distinct empirical stories (e.g. "first attempt", "fix following review feedback"). Reviewers benefit from the per-commit narrative.

## Reporting Security Issues

**Do not report security issues via public GitHub issues.** See [SECURITY.md](SECURITY.md) for the private disclosure channel.

---

Thanks again for contributing.
