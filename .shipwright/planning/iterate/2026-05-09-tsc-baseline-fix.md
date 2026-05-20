# Iterate Spec: tsc-baseline-fix

- **Run ID:** iterate-2026-05-09-tsc-baseline-fix
- **Type:** bug
- **Complexity:** medium (user override; classifier said small + touches_build)
- **Status:** draft

## Goal

Retire the 4 documented TSC baseline errors so `cd server && npm run build`
exits 0. The `scripts/install-windows.ps1` autostart installer fails at step
[3/4] today because of these errors; production-builds (`node dist/index.js`)
are therefore unbuildable on a fresh checkout. ADR-035's "no regression"
policy was explicit that the baseline was carried as documented debt, not
permanent architecture — this iterate pays it down.

## Acceptance Criteria

- [ ] **AC-1 — `cd server && npm run build` exits 0.** No TS errors, no
      missing-types errors, no ambient-module errors. Verified empirically
      at F0.5 via the `cli` surface runner.
- [ ] **AC-2 — `scripts/install-windows.ps1` runs step [3/4] without an
      error.** No regression on the install autostart path. Verified
      MANDATORY by asserting that `server/dist/index.js` exists post-build
      (the VBS shortcut depends on this artifact). The check is part of
      F0.5 surface_verification (post-runner artifact check), not
      "optional cheap" as originally drafted. Catches OpenAI review
      finding #6.
- [ ] **AC-3 — Drift-guard test stops re-introduction of cross-package
      type imports.** Vitest spec `server/src/test/no-cross-package-imports.test.ts`
      walks every `.ts` file under `server/src/**` (excluding `**/*.test.ts`,
      `**/*.d.ts`, `dist/`) using built-in `fs.readdirSync` (no `glob`
      dep, no `recursive:true` Node-version dependency). Each file is
      grep'd against a regex that matches `import` / `export ... from`
      / dynamic `import()` with ANY relative-path depth pointing into
      `client/`: `/from\s+['"](?:\.\.\/)+client\//`. Test asserts ZERO
      matches and reports offender + line on failure. Catches OpenAI
      review finding #2 + Gemini finding #1.
- [ ] **AC-4 — Stray tsc artifacts under `client/src/types/*.{js,d.ts,d.ts.map,js.map}`
      are removed.** These were emitted by an aborted tsc run that pulled
      cross-package files into compilation; they are unused by the client
      (which transpiles via Vite) and clutter `git status`.
- [ ] **AC-5 — CLAUDE.md DO-NOT guard #7 + conventions.md baseline note
      are retired.** Both currently document "4 pre-existing errors,
      no-regression policy". After this iterate they describe the
      duplicated-type / drift-guard architecture and reference ADR-080.

## Affected FRs

None directly. This is a pure type-system + build-tooling change with no
user-visible behavior shift. Indirectly all server FRs benefit from a
clean `tsc` build (production deployments via `install-windows.ps1`
were impossible before this iterate).

## Out of Scope

- TypeScript Project References / composite-project setup. Considered
  and rejected for this iterate — bigger surgery (composite tsconfig in
  client, references in server, switch from `tsc` to `tsc -b`, possibly
  affects vite/tsx behavior) and over-engineered for 3 small interface
  files. Kept as the documented escalation path in ADR-080 if shared
  surface ever grows beyond types.
- Shared-package monorepo workspace. Out of scope by the same logic;
  also breaks the project's "no root package.json" invariant.
- Reformatting / migration of existing ADR length budgets. ADR-080
  itself follows the 1-3-sentence-per-field budget but does not touch
  prior entries.
- CLAUDE.md Structure-section drift (CHANGELOG-unreleased.d/, docs/,
  e2e/, server/profiles/, …) flagged in SessionStart hook. Separate
  housekeeping; not blocking this iterate.

## Design Notes

n/a — no UI surface touched.

## Affected Boundaries

`touches_io_boundary` does NOT fire for this iterate: the diff touches
type-only TypeScript imports for the `Project` and `GlobalSettings`
shapes, never the JSON producers (`sdk-sessions-store.ts`,
`settings.ts` route PUT handler) or consumers
(`run-config-reader.ts`, settings GET handler) that actually serialize
or parse those shapes. The wire format is unchanged. No `parse_env`,
`json.dump`, `json.load`, `yaml.*` keyword anchors hit.

| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| n/a | n/a | n/a — type-only refactor |

## Confidence Calibration

- **Boundaries touched:** none — type-only refactor, no JSON producer/consumer
  pair changes (see "Affected Boundaries" above).
- **Empirical probes run:**
  1. **RED→GREEN drift-guard.** Wrote `no-cross-package-imports.test.ts`
     BEFORE the import retarget, ran vitest, observed both offenders
     reported with file+line+content. Then retargeted, re-ran vitest,
     test passed. Proves the test is non-trivial.
  2. **Comment-aware regex sanity.** 3 sub-tests in the same spec verify
     that (a) real cross-package imports ARE flagged, (b) JSDoc block
     references to the pattern are NOT flagged, (c) line-comment
     references to the pattern are NOT flagged. Proves
     `stripCommentsPreserveLines` works as documented.
  3. **Full server test suite green.** 52 files / 769 tests pass after
     the fix — no regression on existing server functionality (CORS,
     CLI compat, scrollback rotation, session-watcher torn-read,
     launcher escapes, action-schema-sync, all path-guards, …).
  4. **Full client test suite green.** 68 files / 735 tests pass — no
     regression from the stray-file deletion (Vite never imported
     `.js` siblings of `.ts` types; tests confirm).
  5. **AC-1 empirical.** `cd server && npm run build` exit 0, no TS
     errors. Verified live in this run.
  6. **AC-2 empirical.** `node -e "fs.accessSync('dist/index.js')"`
     exits 0 from `server/`. The VBS shortcut from
     `install-windows.ps1` will find this artifact.
  7. **Client build green.** `cd client && npm run build` exit 0,
     Vite output produced. Confirms stray-file deletion didn't break
     the client transpile path.
  8. **Repo-wide sweep.** `git grep -E "(\.\./)+client/"` across the
     whole repo returns only the 3 legitimate hits (config.ts runtime
     path, action-schema-sync.test.ts fs.readFileSync, and now-empty
     ones — see mini-plan repo-wide-sweep table).
- **Edge cases NOT probed + why acceptable:**
  - **Drift between client and server type copies AT RUNTIME.** Not
    empirically probed in this iterate — would require an integration
    test that round-trips a JSON shape through both halves. ADR-080
    documents this as accepted residual risk; the existing
    action-schema-sync.test.ts pattern can be extended later if drift
    incidents appear. Surfaces today as a compile error in the consumer
    or a runtime contract violation (server emits a field client
    doesn't know about — non-breaking by JSON conventions; opposite
    direction = consumer compile error).
  - **`@types/proper-lockfile` API drift vs runtime package.** Pinned
    to `^4.0.0` (resolved to `4.1.4` by npm), runtime is `^4.1.0` —
    same major. Existing `index.ts` only uses `lock` / `unlock` /
    `check`, all stable across DefinitelyTyped v4 minor versions.
    Future runtime version bumps should be matched on the types side.
- **Confidence-pattern check:** No "are you confident?" → "yes" →
  bug pattern fired in this run. Each step (RED, GREEN, build, full
  suite, repo-sweep) produced concrete observable output that
  validated the next step deterministically.

**Stopping rule met:** most-recent probe (client build green) returned
no findings; all applicable categories covered; no asymptote pattern.

## Verification (medium+)

- **Surface:** cli
- **Runner command:** `cd server && npm run build`
- **Evidence path:** stdout/stderr captured via
  `.shipwright/runs/iterate-2026-05-09-tsc-baseline-fix/surface_verification.json`
  by `surface_verification.py`. Exit 0 = empirical proof of AC-1.
- **Justification (only if surface=none):** n/a — `cli` surface fits
  perfectly for a build-tooling fix; the build script IS the empirical
  test. AC-2 is verified by the same runner artifact (`server/dist/index.js`
  presence post-build).
