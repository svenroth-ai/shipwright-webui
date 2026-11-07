# Mini-plan: iterate-2026-11-07-events-drop-files-reader

1. **New pure module `server/src/core/event-log-assemble.ts`.** Input: a list of sources `{path, kind, text | null}` (null = unreadable).
   Output `AssembledEventLog { lines, effectiveLines, files, duplicateIds, hasExtraFiles }`. `lines` = legacy text split on `\n`
   verbatim, then each archive/drop record re-serialized as one JSON line (parity with Python `event_lines_at`), then each corrupt
   fragment of an archive/drop file as its own raw line at the very end (so existing line counters `totalLines`/`skippedLines` count
   them; they never decode). `effectiveLines` = `lines` with drop/archive `event_amended` overlays applied (identity when none).
   Sort key = (epoch ms, sub-millisecond fraction digits, id string) — keeps Python's microsecond order. Dedup by canonical
   sorted-key JSON minus `run`. Drop key regex `^(.+)--[0-9a-f]{8}--[0-9a-f]{8}\.jsonl$`, `sanitizeKey` port, `absenceBlockers`.
2. **New fs loader `server/src/core/event-log-files.ts`.** Lists legacy + archive + drops (pathGuard on the fixed relative paths,
   `readdirSync(withFileTypes)` regular files only, no hidden names, sorted), reads each with the bounded single-descriptor reader,
   re-reads once when a listed file vanished (fold race), returns the assembled log or `null` when the legacy file exists but cannot
   be read (today's "unreadable legacy" behaviour). Also `eventLogFingerprint(root)` (names + mtime + size) for caches and
   `eventLogRevPaths(root)` for `computeSourceRev`.
3. **Switch the readers** (each keeps its own policy, only the input changes):
   - `event-log-reader.readEventLog` → assembled `effectiveLines`; adds `files` / `duplicateIds` to the projection only when an
     extra file was read (event-log-types additive optional fields).
   - `run-data-join.readRunData` → assembled `effectiveLines` (no new field; skipped counts include drop fragments).
   - `campaign-events.readCampaignEvents` → assembled `lines` (raw, no amendments — Python parity).
   - `mission-context/iterate-record.findWorkCompleted` → fingerprint-keyed index over the assembled log; `unavailable` when an
     absence blocker exists for the run and the run is not found. `run-id-recovery` inherits it.
   - `mission-context/resolver.ts` base rev paths → `eventLogRevPaths`.
   - `mission-context/merged-events.loadRef` → `ls-tree -z` + one `cat-file --batch` (new injectable `catBlobs` dep, default spawns git
     with stdin, bounded 64 MB, 8 s timeout), assembled the same way.
4. **New `server/src/core/doc-bullets.ts`** (pure + fs): bullet grammar, `pendingBullets(root)` → `{bullets, skipped, status}`,
   `iterEntries` / `entryAnchor` / `entryDate` ports, Python sort order.
5. **Docs panel**: `shipslog-docs-reader` adds `pendingDocUpdates` rows + `skippedDocUpdates` (types + client mirror + mirror test),
   `ShipsLogDocumentsPanel` renders a "Pending doc updates" group with the plain note.
6. **Decisions artifact**: new `mission-context/doc-updates.ts` (`readRunDocUpdates(root, runId)`), wired through `slice2-sources`
   (rev paths: bullets dir + the run's bullet files + architecture.md + conventions.md) into `buildDecisionsArtifact(record, events,
   docUpdates)`; detail gains `docUpdates` + `docUpdateConflicts` (types-slice2 + client mirror); `DecisionsDetail` renders them
   under "Documentation updates" with folded / pending wording; artifact becomes `available` when only doc updates exist.
7. **Tests first** for each: assembler unit tests, fs loader tests (tmp dirs), KC1 replay test (copied S0 fixture pair + campaign
   fixture split by a TS port of the content-only splitter), merged-ref tests (fake runner + one real git repo), bullets tests,
   Decisions/Docs panel component tests. Existing tests must stay green unchanged except merged-events tests whose fake runner
   answered `git show`.

**Alternative considered:** teach each projection to take a list of per-file record arrays and do its own ordering — rejected
because it spreads the order/dedup contract over six modules and makes KC1 parity a per-module property instead of one function.

**Alternative considered (git):** keep `git show <ref>:<path>` once per file — rejected: the design names `ls-tree` + `cat-file --batch`,
and 300 drops would be 300 processes.
