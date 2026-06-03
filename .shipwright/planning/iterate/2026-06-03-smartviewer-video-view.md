# Iterate Spec — SmartViewer Video View

- **Run ID:** iterate-2026-06-03-smartviewer-video-view
- **Date:** 2026-06-03
- **Intent:** FEATURE
- **Complexity:** medium
- **Branch / Worktree:** `iterate/smartviewer-video-view` (`.worktrees/smartviewer-video-view`)
- **Spec Impact:** ADD (new media route + new viewer kind)

## Motivation

The SmartViewer right-pane already previews markdown / code / text / **images**.
Video is the last open file kind. Content-management sessions produce screen
recordings and demo clips that currently render as the "Unsupported file type"
chip. We add inline `<video>` playback.

Open in Explorer was dropped (not buildable over Tailscale — host-local only).
Auto-reload is deferred to a separate later iterate.

## Why images ≠ video (the real work)

The existing `/file` route is deliberately atomic: `readFileSync` whole file,
**5 MB cap**, documented race-avoidance rationale (Chesterton's Fence). Video
breaks both invariants:

1. Real videos exceed 5 MB → `/file` would 413 them.
2. `<video>` issues **HTTP Range** requests; without `206 Partial Content`
   Safari refuses to play and seeking re-downloads everything; loading a
   200 MB file into RAM per request is untenable.

→ We add a **separate streaming route** `GET …/media` with Range support and
**no size cap**, leaving `/file` untouched (isolates the risk, preserves the
fence). `<video>` streams bytes directly via `src=mediaUrl(...)`, exactly like
`<img>` streams via `fileUrl(...)`.

## Acceptance Criteria

- **AC1** — `GET /api/external/projects/:id/media?path=<video>` returns
  `200` with full body, `Accept-Ranges: bytes`, correct video MIME, when no
  Range header is sent.
- **AC2** — With `Range: bytes=start-end`, the route returns `206 Partial
  Content`, `Content-Range: bytes start-end/size`, `Content-Length` = chunk
  size, and exactly the requested byte slice.
- **AC3** — An unsatisfiable Range (start ≥ size, or start > end) returns
  `416` with `Content-Range: bytes */size`.
- **AC4** — A non-video extension returns `415 unsupported_media_type`; the
  allowlist is `mp4, m4v, webm, ogv, ogg, mov`.
- **AC5** — Path-guard parity with `/file`: traversal / absolute / drive-hop
  → `400 path_traversal`; missing file → `404`; directory → `400 not_a_file`;
  symlink-escape → `400` (realpath).
- **AC6** — Client: `SmartViewer.resolveKind` maps video extensions to a new
  `video` kind; the SmartViewer dispatches to a `VideoRenderer` that renders
  `<video controls preload="metadata">` with the same broken-media fallback
  chip pattern as `ImageRenderer`.

> **AC7 descoped (FolderTree video icon).** Originally specced; dropped under
> YAGNI + the bloat anti-ratchet: `FolderTree.tsx` is grandfathered at exactly
> its 398-line ceiling (zero headroom), so a cosmetic icon would force a module
> extraction for no functional gain. Video files keep the generic file icon in
> the tree; clicking still opens them in the video viewer. Trivial follow-up if
> wanted later.

## Affected Boundaries

- **HTTP boundary (new):** `GET …/media` — binary streaming + Range. Shares
  `core/path-guard.ts` (realpath, null-byte reject) per CLAUDE.md rule 10.
- **MIME allowlist:** new `VIDEO_MIME_BY_EXTENSION` (video-only; 415 otherwise).
- **Client render dispatch:** `resolveKind` + SmartViewer branch.
- No new dependencies (native `<video>`, native `fs.createReadStream`).
- No write surface touched (read-only streaming).

## Out of scope

- Server-side transcoding (unsupported codec → browser shows its own error,
  caught by the fallback chip). Container is served as-is.
- Audio files (could reuse `/media` later — YAGNI now).
- Auto-reload of the open document / tree (separate deferred iterate).

## Risk flags

- New binary-streaming route with user-influenced path → **mandatory code
  review** + path-guard tests. Mitigated: path confined to project root via
  `pathGuard` + `realPathGuard`; no shell, no spawn; read-only.
- backend-affects-frontend (UI consumes the route) → **F0.5 surface=web**.

## Test plan (RED first)

- Server `media-route.test.ts`: 200-no-range, 206-range (+ byte-exact slice),
  416-unsatisfiable, 415-non-video, 404-missing, 400-traversal/absolute/dir,
  Accept-Ranges header, MIME-per-extension table.
- Client `VideoRenderer.test.tsx`: renders `<video>` with mediaUrl src + onError
  chip; `SmartViewer` video dispatch; `resolveKind` mapping.
- F0.5 E2E (surface=web): open an mp4 fixture in the SmartViewer → `/media`
  answers a Range request with 206 and the `<video>` element mounts.

## Confidence Calibration

- **Boundaries touched:** new `GET /api/external/projects/:id/media` HTTP route
  (binary Range streaming via `createReadStream`); `SmartViewer.resolveKind`
  render dispatch (new `video` kind, unified image/video branch); new client
  `mediaApi.mediaUrl` URL builder.
- **Empirical probes run:**
  - Range slices are **byte-exact**, not just length-correct — tests assert
    `body.equals(RAMP.subarray(start, end+1))` for `bytes=10-19`, open-ended
    `90-`, suffix `-10`, and an over-long `95-200` (clamped to `95-99`).
  - Status matrix verified against `app.request`: 200 (no Range, full body +
    `Accept-Ranges`), 206 (+ `Content-Range`), 416 (`bytes */size`), 415
    (non-video), 404 (missing), 400 (traversal/absolute/dir).
  - MIME-per-extension verified for all 6 containers (mp4/m4v/webm/ogv/ogg/mov).
  - `<video>` issues **no JS fetch** — SmartViewer test asserts the fetch mock
    is never called; src points at `/media`.
  - Full suites green: server 1450/1450, client 1436/1436; `tsc --noEmit` 0;
    oxlint clean. No regression in the untouched `/file` route.
- **Test Completeness Ledger:**

  | Behavior | Disposition | Evidence |
  |---|---|---|
  | AC1 200 full + Accept-Ranges + MIME | tested | media-route.test "AC1" |
  | AC2 206 byte-exact slice (4 range shapes) | tested | media-route.test "AC2"×4 |
  | AC2 malformed Range → 200 | tested | media-route.test "malformed Range" |
  | AC3 416 unsatisfiable + `bytes */size` | tested | media-route.test "AC3" |
  | AC4 415 non-video + 6-MIME table | tested | media-route.test "AC4"×7 |
  | AC5 path-guard (traversal/abs/404/dir) | tested | media-route.test "AC5"×4 |
  | AC6 resolveKind video mapping (6 ext) | tested | SmartViewer.test matrix |
  | AC6 SmartViewer dispatch → `<video>` no fetch | tested | SmartViewer.test "video extension" |
  | AC6 VideoRenderer src + onError chip | tested | VideoRenderer.test ×2 |
  | AC7 FolderTree video icon | untestable | `covered-by-existing-test` — descoped (YAGNI + bloat ceiling), no behavior shipped |
  | Real-browser playback (codec decode) | untestable | `requires-manual-visual-judgment` — verified at F0.5 (206 served + `<video>` mounts); actual pixel decode is browser/codec-dependent |

  0 testable-but-untested behaviors.
- **Confidence-pattern check:** asymptote (depth) — Range arithmetic probed to
  the byte level across 4 range shapes + clamp + malformed, not "looks right".
  Coverage (breadth) — all 6 shipped ACs + every allowlisted container + the
  full HTTP error matrix; the one un-unit-testable behavior (codec decode) is
  named with a reason_code and deferred to the F0.5 surface check.
