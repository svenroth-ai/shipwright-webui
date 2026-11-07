# Iterate: event log drop files and bullet drops in the WebUI readers (events-drop-files S1 + S5b)

- **Run-ID:** iterate-2026-11-07-events-drop-files-reader
- **Type:** feature · **Complexity:** medium (Repo Scout: 8 reader modules, 2 API routes, client panel) · **Risk flags:** touches_public_api (additive response fields), touches_io_boundary (reads a file format another repo writes)
- **Source:** shipwright monorepo campaign `events-drop-files` (issue #978): `2026-11-04-events-drop-files-DESIGN.md` (4.1, 4.3, 4.4, 10.2), `-BRIEF.md` units S1 and S5/S5b, `2026-11-07-events-drop-files-FLIP-READINESS.md` (S9a precondition 1).
- **Spec Impact:** MODIFY — `.shipwright/planning/01-adopted/spec.md` gains an **Updates** sentence on FR-01.47 (event log, both layouts), FR-01.66 (Decisions: documentation updates) and FR-01.59 (Documents column: pending doc updates). No FR is added, renamed or merged.

## Why

The Shipwright plugin is about to stop appending every run to the single `shipwright_events.jsonl`. Each run writes its own file
under `shipwright_events.d/`; a release fold moves old ones into `shipwright_events.archive/`. Architecture / convention bullets move
out of `architecture.md` / `conventions.md` into one-line files under `.shipwright/agent_docs/decision-drops/bullets/` until a release folds
them. A WebUI that reads only the old file would show finished runs as missing and campaign steps as pending. The plugin flip (S9a)
is blocked until a WebUI release that reads both layouts is in use; this run is that release's content.

## Contract (mirrors the Python reference `shared/scripts/lib/events_read.py`, `doc_bullets.py`)

1. **Assembled order.** Legacy `shipwright_events.jsonl` lines in FILE order, then the records of `shipwright_events.archive/*.jsonl`
   and `shipwright_events.d/*.jsonl` merged and sorted by (parsed instant, id); ties keep folder order (archive, then drops), file
   name, in-file order. `shipwright_events.quarantine/` is never read. Only direct `*.jsonl` children are read: symlinks,
   sub-folders and other names (the writer's temp files end in `.tmp`) are not. A dot-named `*.jsonl` IS read, as Python's
   `pathlib.glob` does. Folders are read whatever `events_layout` says.
2. **Per-file status** `ok | corrupt | empty | unreadable` for every file read (legacy with zero records is `ok`; an empty drop or
   archive file is `empty`). Recovery is the existing `splitRecords` (records around a bad span are still returned).
3. **Duplicate-id rule** (archive + drops only, never the legacy file): same id + same content (the stamped `run` field is not
   content) collapses to one record; same id + different content keeps both and lists the id in `duplicateIds`.
4. **Amendments.** An `event_amended` record that lives in an archive or drop file (the drops-layout form of `attach_commit_to_event`)
   overlays its `fields` onto the target event (`amends` = target id), shallow, last in assembled order wins, for the RUN projections
   (Mission rail, Ship's-Log runs, run data). Amendments inside the legacy file keep today's behaviour (not overlaid) so a repo
   without drop folders renders byte-identically to today. Campaign status applies no amendments (parity with Python
   `campaign_status`, which reads raw `event_lines_at`).
5. **Absence vs unavailability.** `findWorkCompleted` keeps `found | absent | unavailable`; it now answers `unavailable` instead of
   `absent` when a drop file that may belong to the run (its key equals the sanitized run id, or its name does not follow the
   writer's shape) is not `ok`, or when ANY archive file (or an unlistable drops/archive folder) is not `ok` (kill criterion 8: a
   damaged own file must never read as "the run has no record").
6. **Git reads.** Where the WebUI reads the event log from `origin/main` (the merged-but-not-pulled fallback), it lists the three
   paths with `git ls-tree -z <ref> -- shipwright_events.jsonl shipwright_events.d/ shipwright_events.archive/` and reads every blob
   with ONE `git cat-file --batch` (no `git show` per file). A ref that resolves to none of the files stays `unavailable`.
7. **No drop folders = no change.** Without `shipwright_events.d/` and `shipwright_events.archive/` every reader produces exactly
   what it produces today (same lines, same counts, same API payload). The per-file status appears in API payloads only when an
   archive or drop file was read.
8. **Bullets.** A bullet file is `<target>--<key>--<wt8>--<nonce8>.md` (target `architecture | conventions | learnings`, key
   `[A-Za-z0-9._-]{1,80}`) holding exactly one `- ` line. Anything else under `bullets/` is skipped and counted, never rendered. No
   `.md` file anywhere under `decision-drops/` is ever rendered as an ADR / decision entry (the ADR reader stays `<run_id>_NNN.json`
   only, non-recursive).
9. **Bullets, folded + pending.**
   - Ship's-Log Documents panel: a new group lists the pending bullet files (label names the target doc) with a plain note that
     they merge into Architecture / Conventions at the next release; skipped files are counted.
   - Mission Decisions artifact: the run's documentation updates = folded entries of `## Architecture Updates` /
     `## Convention Updates` whose leading anchor is the run id, plus the run's pending bullets (file key = sanitized run id).
     A pending bullet whose anchor is already folded in the same section is not shown again (Python `insert_bullets` rule);
     two pending bullets with the same anchor and different text keep the first in Python fold order (date, key, name) and the
     rest are counted as conflicts.

## Acceptance criteria

- AC1 Assembled order, quarantine ignored, `.tmp`/symlink/non-jsonl/sub-folder names ignored, dot-named `*.jsonl` read (unit tests on the pure assembler and the fs loader).
- AC2 Per-file status for each kind incl. corrupt-with-recovery, empty, unreadable, vanished-after-listing (re-read once).
- AC3 Duplicate-id rule: identical collapses (also with a differing `run` stamp), different content kept + flagged; legacy never deduped.
- AC4 KC1: campaign status (`applyEventsProjection` over `readCampaignEvents`) is byte-identical (JSON) on the unsplit log vs the
  same log split by the content-only splitter (port of `shared/tests/_events_split.py`), on the monorepo S0 fixture pair and on a
  campaign-rich fixture; the run projection and run-data bundle are identical too.
- AC5 Every fs reader (events route, runs route, Mission `findWorkCompleted` + run-id recovery, campaigns route) sees a run that
  exists only as a drop; its cache and the Mission `sourceRev` move when a drop file is added or appended.
- AC6 `origin/main` reader uses `ls-tree` + one `cat-file --batch`, finds a drop-only run, stays `unavailable` on an unreadable ref
  (unit with fake runner + one real-git test).
- AC7 Amendment from a drop overlays `commit` on the run projection; a legacy-file amendment does not (unchanged behaviour).
- AC8 `findWorkCompleted` answers `unavailable` when the run's own drop file is corrupt/unreadable, `absent` when only another run's
  drop is damaged.
- AC9 No-folder regression: existing reader tests unchanged and green; the event-log payloads have no new field without folders (the
  Documents payload always carries the three additive pending-doc fields; the panel hides the group when they are empty).
- AC10 Bullets: grammar, skipped files counted, never an ADR; Documents panel group; Decisions artifact doc updates (folded + pending,
  folded-wins, conflict count) incl. a run with doc updates but no ADR.

## Not in scope

- Writing anything (the WebUI stays a read-only observer). Fold/quarantine tooling, the layout sentinel, CI checks (monorepo units).
- `scripts/ci/pr_review_generated.py` classifying the drop folders as generated: a CI review-policy change for this repo's own PRs,
  only relevant once this repo flips its own layout; follow-up.
- A run-scoped fast reader (Python has none in production either).

## Divergences from Python, by decision

- **Corrupt fragments of an archive/drop file** are appended as raw lines after the assembled records (Python `event_lines_at`
  omits them). They never decode; they only keep the existing "corrupt line" counters honest.
- **Legacy-file amendments are not overlaid** (contract 4). Python applies amendments per consumer over every source. Kept so a
  repo without the folders renders byte-identically to today; disclosed consequence: a release fold that ever moves an
  `event_amended` record INTO the legacy file (a full-fold rollback) stops overlaying it.
- **Campaign status ignores drop-file amendments** — exact Python parity (`campaign_status.py` reads raw `event_lines_at`). Effect
  after the flip: a campaign step's commit, attached by amendment, is not shown on the board. Monorepo follow-up, not a WebUI bug;
  pinned by `event-log-files.test.ts › campaign status ignores a drop-file amendment`.
- **Documents panel:** a separate "Pending doc updates" group instead of rendering pending bullets inside Architecture /
  Conventions. The BRIEF's KC7 "identical render pending vs folded" is a Python-side fold check; the WebUI opens the raw document
  file, so splicing bullets into it would show a document that does not exist on disk. The Mission Decisions artifact does show
  folded and pending updates the same way (one note line differs).
- **Learnings bullets** are left out of a run's Decisions doc updates (once folded they carry no run anchor, so they would vanish at
  the release); they do appear in the Documents panel pending group.
- **Merged-but-not-pulled pending bullets** are not read from `origin/main` (the main tree catches up on pull).

## Internal Plan Review

`opus-plan-reviewer` (opus), 13 findings (6 medium, 7 low). Dispositions:

| # | Finding | Disposition |
|---|---|---|
| 1 | Documents panel shows pending as a separate group, not "identical render" | Kept by decision, disclosed (see Divergences) |
| 2 | Pending bullets read from the main tree, not the live run's worktree | Fixed: `docsRoot = chosen.root` (resolver-iterate → slice2-sources) |
| 3 | Learnings break folded+pending symmetry | Fixed: learnings excluded from run doc updates |
| 4 | Doc updates bypass the available/unavailable state | Fixed: unreadable doc/folder or malformed own bullet → `unavailable` when no ADR; doc-updates-only run → `available` |
| 5 | Campaign commit lost under drops | Python parity; disclosed + pinning test; monorepo follow-up |
| 6 | Drops-only (no legacy file) not specified | Tested (`event-log-files.test.ts` drop-only run, every reader) |
| 7 | AC4 identity vs optional fields | Compared without `files`/`duplicateIds` |
| 8 | Legacy parsed more often | Fixed: legacy status row computed lazily |
| 9 | Double listing per Mission poll | Accepted (stat-only, small folders); disclosed |
| 10 | Python mismatches: dot-files, instant ranges, lost-drop key | All three fixed + tested |
| 11 | Only lexical pathGuard on event files | Accepted: names come from readdir of fixed folders, symlinks skipped by `lstat`/`isFile`; same trust as the legacy reader |
| 12 | Torn tail of a live drop flickers to `unavailable` | Accepted, fails closed; disclosed |
| 13 | `unavailable` skips the origin/main fallback | Accepted, fails closed (never "no record") |

## Internal Architecture Review

`architecture-internal-reviewer` (opus), 9 findings: build it (option A, one shared assembler — every reader goes through it,
done); legacy-amendment asymmetry checked against `events_read.py` and kept by decision (Divergences); GitRunner cannot carry
`cat-file --batch` → separate byte-framed `BlobReader` (done); an odd-named damaged drop blocks every run's absence verdict →
accepted, fail closed, visible in `files`; cache key must include every file's (name, size, mtime) → done (`eventLogFingerprint`);
bullets are repo text rendered in the browser → rendered only through `DocumentMarkdown` (escaping renderer), one line each.

## Architecture Review

External `--mode architecture` (GPT + GLM): both approve option A. Raw: `iterate-2026-11-07-events-drop-files-reader/external-architecture-review-raw.json`.

## External Plan Review

GLM approve, OpenAI revise. OpenAI #1 recursive ls-tree → fixed (`-r` + direct-child filter); #2 re-list on vanish → fixed (full
re-listing, `event-log-files.race.test.ts`); #3 own corrupt file that still yields a `work_completed` → declined, Python parity
(blockers gate only absence); #4 unreadable legacy with drops present → declined, Python raises (reader returns null = unreadable).
GLM notes (fragments at end, non-transitive amendment chains, same-size append in one mtime tick, ref timeout = unavailable) are
disclosed above or accepted. Raw: `iterate-2026-11-07-events-drop-files-reader/external-plan-review-raw.json`.

## External Code Review

GPT (revise, 2 findings), GLM (no usable reply). #1 a later amendment replaces the earlier overlay of the same target instead of
merging → declined: Python `events_amend.apply_amendments` builds `{amends: fields}` (last wins per target, whole overlay), and the
reader must match the plugin. #2 an unlistable folder read as "no files" → fixed: a folder that exists but cannot be listed is an
`unreadable` source (drops: key null, so it blocks every run's absence verdict); ENOENT/ENOTDIR stay "nothing to read". Python
silently lists nothing there; this is a deliberate fail-closed divergence. Raw:
`iterate-2026-11-07-events-drop-files-reader/external-code-review-raw.json`.

## Code Review

`code-reviewer` (opus): APPROVE WITH FIXES, 4 medium + 7 low. Fixed: F1 raw NUL bytes made `merged-events.test.ts` a binary diff
(now `\0` escapes); F2 the Documents group said "could not be read" and "none" together (list hidden when unreadable, asserted);
F3 a run with an ADR hid unreadable doc updates (summary clause, tested); F4 caches held the lazy legacy row and its text (legacy row
settled when extra files exist, caches keep drop/archive rows only); F5 broken bullet files no longer counted as decision records,
the unavailable note names documentation updates; F6 conflicts-only run no longer hidden (server + client); F11 `iterEntries` uses
Python `splitlines` boundaries and `entryAnchor` slices code points. Disclosed, not changed: F7 the shared 64 MB per-file cap now
also bounds the events/runs/campaigns routes (before: unbounded) — a >64 MB legacy log reads as unreadable, never as empty-and-fine;
F8 the overlay prefilter matches the raw id, so a non-ASCII id written as an escaped code unit by Python is not overlaid (run ids
are ASCII); F9 per-poll work: three folder listings and the run's bullet files read twice; F10 AC9 narrowed to the event-log payloads.

## Doubt Review

`doubt-reviewer` (opus), 2 medium + 3 low. D2 (archive damage never blocked absence, so a run whose only record was folded into a
torn/unreadable archive file, or behind an unlistable archive folder, read `absent`) → fixed: any non-ok archive row blocks every
run's absence verdict (fail-closed divergence; Python blocks on drops only), tested. D1 (a fold that reaches the tree via `git
pull`/`checkout` unlinks the drops BEFORE it writes the archive, so for one poll neither folder holds the run and it reads `absent`;
a half-written archive reads `corrupt`) → rebutted and narrowed: the "fold racing a read loses nothing" claim holds for a fold run by
`events_fold` in this tree (archive first, then unlink — the re-list covers it). The git-checkout window is transient (the next poll
after git finishes is correct), identical in Python, and the torn-archive half of it is now `unavailable` via D2; a finished
Mission run additionally falls back to `origin/main`. D3 (Mission `sourceRev` is statted after the events read) is a pre-existing,
unchanged race. D4 the `origin/main` reader resolves paths relative to the project root, so a project registered at a sub-folder of
its git repo now reads its own sub-folder's log on the ref (matches the working-tree reader). D5 the duplicate-id content compare
uses JS numbers, so `1.0` vs `1` or >2^53 integers collapse where Python flags them (events carry no such id-colliding values).

## Spec Review

`spec-reviewer` (opus) round 1: REJECT — AC1 names symlinks and the fs loader had no symlink test. Fixed (ledger row 7).

## Affected Boundaries

| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| shipwright `events_write.py` (drop files) / `events_fold.py` (archive) | `event-log-files.ts` → `event-log-assemble.ts` | JSONL, one file per run |
| git `origin/main` tree | `ref-event-log.ts` (`ls-tree -z`, `cat-file --batch`) | git plumbing, byte-framed |
| shipwright `doc_bullets.py` | `doc-bullets.ts` → `doc-updates.ts`, `shipslog-pending-docs.ts` | one-line Markdown file |
| WebUI server | WebUI client (`missionContextApi.ts`/`missionSlice3Types.ts`, `shipsLogDocsApi.ts`) | JSON API, mirrored types + sync tests |

## Confidence Calibration

- **Boundaries touched:** the four rows above.
- **Empirical probes run:** the monorepo's own S0 fixture pair (unsplit vs split, copied verbatim) replayed through every
  projection — identical (KC1); a real `git` repo with multi-byte content read through `ls-tree` + `cat-file --batch`; a fold
  racing a read (drop renamed into the archive between listing and reading) — event kept, re-listed; Python `splitlines`
  boundaries (U+2028, form feed, lone CR) and a non-UTF-8 byte in a bullet; impossible ISO dates and two-digit years.
- **Confidence-pattern check:** the plan review found 3 small Python mismatches after I believed the reader matched; one more
  pass was made (dot-files, instant ranges, lost-drop key) and each got a test. Every ledger row is tested; 0 untested-testable.

### Test Completeness Ledger

| # | Testable behavior | Disposition | Evidence |
|---|---|---|---|
| 1 | Assembled order: legacy file order, then extras by (instant, id), folder/name/in-file ties | tested | event-log-assemble.test.ts › order |
| 2 | Per-file status ok/corrupt/empty/unreadable, legacy-zero = ok | tested | event-log-assemble.test.ts › per-file status |
| 3 | Duplicate-id rule (collapse identical incl. differing `run`, keep+flag different, legacy never deduped) | tested | event-log-assemble.test.ts › duplicate-id rule |
| 4 | Drop/archive amendments overlay run projections; legacy amendments do not | tested | event-log-assemble.test.ts › amendments; event-log-files.test.ts › per-file status and amendments |
| 5 | KC1: campaign status + run projection identical unsplit vs split | tested | event-log-replay.test.ts (4 cases) |
| 6 | Every fs reader sees a drop-only run; cache + sourceRev move on add/append | tested | event-log-files.test.ts |
| 7 | Quarantine, `.tmp`, non-jsonl, sub-folders, symlinked files and folders never read; dot-named jsonl read | tested | event-log-files.test.ts › never reads…; › Python listing parity; › never reads a symlinked drop file or a symlinked archive folder (runs where the OS allows symlinks — CI Linux; skipped on Windows without the privilege) |
| 8 | Fold racing a read re-lists, event kept, vanished file stays unreadable with its key | tested | event-log-files.race.test.ts |
| 9 | findWorkCompleted unavailable on own damaged drop, absent on another run's | tested | event-log-files.test.ts |
| 10 | origin/main read via ls-tree + one cat-file --batch, byte framing, unavailable on bad ref | tested | ref-event-log.test.ts (6, incl. real git); merged-events.test.ts (8) |
| 11 | No-folder regression: payload has no new field, existing reader tests unchanged | tested | event-log-files.test.ts › exposes per-file status ONLY…; full server suite |
| 12 | Campaign status ignores drop amendments (Python parity) | tested | event-log-files.test.ts › campaign status ignores a drop-file amendment |
| 13 | instantKey rejects impossible dates/times/offsets; year < 100 not mapped to 19xx | tested | event-log-assemble.test.ts › treats a NAIVE timestamp as UTC (not local time) |
| 14 | Bullet grammar, Python splitlines, strict UTF-8, fold order, skipped files, .gitkeep | tested | doc-bullets.test.ts (10) |
| 15 | Run doc updates: folded + pending, folded wins, conflict, learnings out, unreadable | tested | doc-updates.test.ts › readRunDocUpdates |
| 16 | Decisions artifact: doc-updates-only run available; unreadable doc → unavailable; no `.md` ever an ADR | tested | doc-updates.test.ts › Decisions artifact… |
| 17 | Decisions detail renders doc updates (folded/pending note, conflicts), none when empty | tested | MissionDecisionsDetail.test.tsx |
| 18 | Documents panel pending group: rows in fold order, skipped count, unreadable note, hidden when none | tested | shipslog-docs-reader.test.ts; ShipsLogDocumentsPanel.test.tsx |
| 19 | Client/server type mirrors stay identical | tested | mission-context-types-sync.test.ts; shipslog-docs-mirror-sync.test.ts |
| 21 | A run with an ADR still discloses unreadable doc updates; conflicts alone are not hidden | tested | doc-updates.test.ts › a run WITH an ADR still discloses…; › conflicts alone still surface |
| 22 | A non-ok archive file blocks every run's absence verdict | tested | event-log-files.test.ts › a damaged ARCHIVE file blocks every run's absence; event-log-assemble.test.ts › absence blockers |
| 23 | End to end: a drop-only finalized run shows in Mission with its pending doc update under Decisions, never as an ADR; the Documents column lists the pending bullet and opens it | tested | client/e2e/flows/E1-events-drop-files.spec.ts (2 tests) |
| 20 | A drop/archive folder that exists but cannot be listed is an `unreadable` row (key null) → absence blocked | tested | event-log-files.race.test.ts › a folder that exists but cannot be listed |

## Verification

- **Surface:** web
- **Runner command:** `node e2e/isolated-stack.mjs --project=chromium e2e/flows/E1-events-drop-files.spec.ts e2e/flows/mission-artifacts-s1.spec.ts e2e/flows/A16b-shipslog-documents-panel.spec.ts`
  (from `client/`, through a node wrapper because the F0.5 runner has no shell). The new E1 spec seeds a project whose only run
  record is a drop file plus a pending architecture bullet, and drives the real Mission Decisions artifact and the real Documents
  column; the existing Mission S1 and Documents specs re-run unchanged. 8 passed.
- **Evidence path:** `.shipwright/runs/<run_id>/surface_verification.log`; Playwright JSON + merged vitest JSON staged as run evidence.
- **Full suites:** server `npx vitest run` 466 files / 5005 passed / 16 skipped; client 556 files / 5002 passed (run with
  `--testTimeout=30000`: `standaloneView.test.tsx › real router wiring` times out at the 5 s default on this machine and fails
  identically on unmodified origin/main; not touched by this diff).

## Self-Review

1. Spec coverage — every contract item and AC1–AC10 maps to a ledger row: pass.
2. Read-only observer — no write anywhere under the project tree: pass.
3. No-folder regression — payloads unchanged without the folders, existing tests green: pass.
4. Python parity — divergences listed above, each by decision: pass.
5. Fail closed — every unreadable/damaged source reads as "could not be read", never "none": pass.
6. Path safety — fixed folders, readdir names only, symlinks skipped, pathGuard on every root-relative path: pass.
7. Size rules — every touched file under 300 lines or at/below its bloat baseline (MissionSlice2Details 313 → 256): pass.
8. Mirrors — client types mirror the server and both sync tests pass: pass.
