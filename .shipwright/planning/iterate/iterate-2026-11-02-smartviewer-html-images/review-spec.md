# Iterate spec (compact) — iterate-2026-11-02-smartviewer-html-images

**Type:** bug · **Complexity:** small + risk flag `touches_auth` (path-evidence access rule) → full review cascade.

## Problem
The SmartViewer renders an `.html` file in a sandboxed `srcdoc` iframe (no base URL, no `allow-same-origin`, CSP
`connect-src 'none'`). A relative `<img src="shot.png">` therefore never loads. The previous iterate (#551/#552) fixed
relative stylesheets for PROJECT files only; pages OUTSIDE the project (served by `GET /api/external/tasks/:id/session-file`,
which only serves paths the session JSONL evidences) got neither stylesheets nor images.

## Requirements
1. Relative `<img src>`, `<img srcset>`, `<source srcset>`, `<video poster>` become `data:` URIs.
2. In CSS (a `<style>` block or an inlined stylesheet): relative `url()` of images/fonts and `@import "x.css"` are inlined.
3. Pages outside the project work too: new `assetOf=<evidenced html>` parameter on the session-file route.
4. Only image/font/.css extensions, no dot segments, limits (40 files, 20 MB, 5 s, 6 in flight, 20 imports, 30 MB output),
   no relative scripts, no video/audio sources, no `style=""` attributes.
5. The pop-out modal shows the same.

## Server rule (asset-access.ts)
An asset is served when: the owner page passes the normal evidence decision and is `.html/.htm`; the asset has an
allowlisted extension; it lies inside the owner's folder tree lexically AND by realpath; no `.`-prefixed segment; not a
sensitive location; the folder is not a root/home/ancestor-of-home/tmp/Desktop/Documents/Downloads/Pictures; no NTFS
stream colon. The owner decision is memoized for 15 s (positive results only) so a burst of images costs one scan.

## Accepted residual risk
A scripted page can read the inlined data URIs of the files it names in its own folder tree and leak them through
allowed outbound channels (img-src https, popups). Bounded by the evidence gate, extension allowlist, folder-breadth
denylist and the fact that the page must name the files.

## Verification
Unit (client + server), real-browser E2E on the real stack (project page; outside page inline + pop-out; server refusals),
E2E verified red when image loading is disabled.
