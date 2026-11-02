# HTML preview loads page resources (images, fonts, imported CSS)

Run: `iterate-2026-11-02-smartviewer-html-images` (bug, small + `touches_auth`).

## Context
The SmartViewer shows `.html` in a sandboxed `srcdoc` iframe (no base URL, no `allow-same-origin`, CSP `connect-src 'none'`). Relative resources can never load there. The previous iterate inlined relative `.css` for project files only; pages outside the project (served by the task-scoped session-file route, which needs session evidence per path) got nothing, and no page got images.

## Decision
- Client: a per-page `ResourceLoader` reads referenced files through the existing path-guarded file APIs and rewrites the markup: `<img src|srcset>`, `<source srcset>`, `<video poster>`, CSS `url()` (image/font) and tail-less `@import "x.css"` become inline data. Bounds: 40 files, 20 MB fetched, 30 MB output, 6 in flight, 5 s per request, 20 imports, import depth 3, abort on replace.
- Server: `GET /tasks/:id/session-file?path=&assetOf=<html>`. The owner page must pass the normal evidence decision and be `.html/.htm`; the asset must be an allowlisted image/font/css file inside the owner's folder tree (lexical and realpath), no `.`-segment, not sensitive, folder not broad (root, home or ancestors, tmp, Desktop/Documents/Downloads/Pictures/cloud-sync roots), no NTFS stream colon. The owner proof is memoized 15 s (positives only) so a burst costs one transcript scan.

## Accepted residual risk
A scripted page can read the data URIs of the image/font/css files it names in its own folder tree and forward them over allowed channels (`img-src https:`, popups). Tightening the CSP does not close it (the page reads the data in-script). Bounded by the evidence gate, extension allowlist, folder-breadth denylist and the page having to name the files. Possible follow-up: a "click to load local images" prompt for outside pages.

## Not handled (documented)
`<base href>`, `style=""` attributes, entities inside paths, `url()` inside CSS comments (spends budget), `@import` with a media/supports/layer tail, relative scripts, video/audio. Fonts load via `assetOf` only; the project file route does not list woff/woff2, so fonts of project pages stay unloaded.

## Rejected
- Add `allow-same-origin` / a base URL: breaks the sandbox isolation.
- Serve pages from a dedicated origin: large change, new attack surface.
- Server-side HTML rewriting: server would parse untrusted markup; the client already owns the rewrite.
- Per-asset full evidence scan: found by review to starve the process-wide scan queue; replaced by the memoized owner proof.

## Process note
Planning/spec artifacts were written after the build had started (user asked for the build first); the review cascade (spec, code, doubt, external) ran on the finished diff and its findings were fixed.
