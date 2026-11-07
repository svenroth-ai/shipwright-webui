# Architecture Brief: WebUI reads per-run event files and bullet files

## The problem

The Shipwright plugin will soon write each run's events into its own file (`shipwright_events.d/`, later folded into
`shipwright_events.archive/`) and each architecture/convention bullet into its own small file, instead of appending to one shared
log and two shared docs. A WebUI that only reads the shared files would show finished runs as missing, campaign steps as pending
and recent documentation updates as absent. The plugin change cannot ship until a WebUI release that reads both layouts is out.

## What already exists here

- Six server modules read `shipwright_events.jsonl` directly (events route, runs route, campaigns route, Mission rail lookup with an
  mtime-keyed index, run-id recovery, and a `git show origin/main:` fallback for merged-but-not-pulled runs).
- A shared tolerant JSONL record splitter (`jsonl-records.ts`).
- A decision-drops reader for `<run_id>_NNN.json` files and a Ship's-Log Documents panel listing agent docs.

## What would newly, permanently exist

One assembling reader (TypeScript twin of the Python `read_events_assembled` contract: order, per-file status, duplicate rule,
amendments) used by every event reader, a git variant using `ls-tree` + `cat-file --batch`, and a bullet-file reader used by the
Documents panel and the Mission Decisions artifact. Kept correct by a parity test against the monorepo's unsplit/split fixture pair;
the monorepo owns the contract and changes it first.

## Options on the table

- **A:** one shared assembling reader that emits the assembled log as lines, every existing projection unchanged on top of it.
- **B:** each projection reads the per-file record lists itself and applies the order/dedup rules locally.
- **C:** read only the legacy file plus drops, no archive, no per-file status (minimum to see runs).
- **D:** do nothing in the WebUI and keep the plugin on the legacy layout.

## Constraints that are not negotiable

- The WebUI never writes these files (read-only observer).
- Without the new folders every page must render exactly as today.
- The order and duplicate rules must match the Python reader (the S9a flip precondition names this WebUI release as the minimum version).
