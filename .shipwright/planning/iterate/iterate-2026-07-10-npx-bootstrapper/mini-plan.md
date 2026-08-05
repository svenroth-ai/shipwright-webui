# Mini-plan — A06 npx bootstrapper (`@svenroth-ai/shipwright`)

Run ID: iterate-2026-07-10-npx-bootstrapper · FR-01.49 · change_type=feature ·
campaign webui-wow-usability-2026-07-10.

## Problem

Two install rituals (Claude plugins via `claude plugin install` per plugin +
WebUI via `git clone && make`), a plugin list that already drifted (README "13"
vs manifest 14), and — the silent killer — `claude plugin install` never
delivers the `shared/` tree the plugins' hooks resolve via
`${CLAUDE_PLUGIN_ROOT}/../../shared/…`, so every hook dies at session start
while the plugin still lists as installed. Make `npx @svenroth-ai/shipwright@latest`
the ONE install+update surface.

## Design (new `bootstrapper/` workspace — third independent workspace)

- `bin/shipwright.mjs` — self-version-check → preflight → plugins(+cache-sync) →
  server → summary. Flags: --no-open/--plugins-only/--webui-only/--port/--version/--help.
- `lib/util.mjs` — pure SemVer compare + platform install hints + ASCII marks.
- `lib/version-check.mjs` — registry stale-copy self-check, offline-safe (AC6).
- `lib/preflight.mjs` — claude/uv/python(TEST-RUN --version, MS-Store stub trap)/
  node-min/git/gh. Missing hard prereq → loud, non-zero (AC1a).
- `lib/plugins.mjs` (pure) + `lib/claude-cli.mjs` (OS seams) — manifest resolver
  (local cache → GitHub raw → `SHIPWRIGHT_MARKETPLACE_MANIFEST`; NO hardcoded
  list, defensive validation), install/update, before/after changed-set (AC1/2/3/5).
- `lib/cache-sync.mjs` (pure over paths) + `lib/cache-runtime.mjs` — port
  update-marketplace.sh BEHAVIOUR (shared/ sync = make-or-break, full file sync,
  plugins/ symlink layer + Windows copy fallback, GC stale versions) sans its
  hardcoded 14-list; `verifyCacheCoherent` post-condition (AC1b, RED-first).
- `lib/server.mjs` — probe 127.0.0.1:PORT/api/diagnostics; free→boot,
  same/newer→attach, older→SWAP via the DETACHED deploy-swap.mjs, foreign→loud
  fail (PORT= remediation), NEVER kill (AC1c/AC4). No kill path in lib/bin.
- `scripts/build-package.mjs` — stage server/dist + client/dist + profiles +
  vendored swap scripts + LICENSE into the package. `files` whitelist excludes
  Spec/.shipwright/tests/src. No prepublishOnly.

## Server change (only in-scope server/src edit)

`/api/diagnostics` additively exposes `app.version` (server/package.json) so the
bootstrapper decides attach-vs-swap honestly. `/api/health`'s unrelated
hardcoded "0.1.0" left untouched.

## Out of scope / stop points

`npm publish` is a MANUAL human gate — no publish attempted, no NPM_TOKEN, no
publish workflow. No sibling-repo edits. No `.github/workflows` changes.

## Risk — cross-repo coupling

Reads the monorepo's `.claude-plugin/marketplace.json`; a schema change there
breaks every user at once. Mitigation: defensive validation with a loud named
error (never a silent empty list) + a fixture-pinned parser test. The manifest
is now a PUBLISHED CONTRACT — flag a monorepo decision-drop.
