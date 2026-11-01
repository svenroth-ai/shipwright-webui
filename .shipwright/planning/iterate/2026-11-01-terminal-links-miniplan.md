# Mini-Plan: terminal-links

Run ID: iterate-2026-11-01-terminal-links

## Files
New (client only):
1. `client/src/components/terminal/terminalLinkMatch.ts` - pure text -> candidates (`findFileLinkCandidates(text)`); validates through the existing `parseFileRef`.
2. `client/src/components/terminal/terminalFileLinkProvider.ts` - xterm `ILinkProvider` over the buffer: joins soft-wrapped rows into one logical line, maps string offsets to cells (wide chars), emits ranges, activation guarded by `term.hasSelection()`.
3. `client/src/components/terminal/useTerminalFileLinks.ts` - hook: registers the provider on `termRef.current` (options via ref, registered once), activation = resolve target (`resolveViewerTarget`), outside target -> probe the session-file route, evidenced/inside -> `open(target)`, 403 -> `notify("link-not-in-session")`.
4. `client/src/hooks/useTerminalFileOpen.ts` - builds the `FileOpenValue` (projectRoot, cwd, ready, open) for the Files & Terminal page from the task; shares the project-root/`ready` derivation with `useMissionFileOpen`.
5. Tests: `terminalLinkMatch.test.ts`, `terminalFileLinkProvider.test.ts`, `useTerminalFileLinks.test.tsx`, `client/e2e/flows/106-terminal-file-links.spec.ts`.

Edited:
- `EmbeddedTerminal.tsx` (+2 lines: prop destructure + hook call; file sits at its bloat ceiling 311, currently 309), `EmbeddedTerminal.types.ts` (prop `fileLinks`).
- `terminal-clipboard.ts` + `TerminalBanners.tsx` (new notice kind `link-not-in-session`, token-coloured).
- `lib/sessionFileApi.ts` (`probeSessionFile`), `hooks/useMissionFileOpen.ts` (export the shared root/ready helper).
- `pages/TaskDetailPage.tsx` (+~8 lines: `openFromTerminal` + hook + prop; ceiling 560, now 529).
- spec.md FR-01.28 ACs.

## Work breakdown
1. Red: unit tests for `findFileLinkCandidates` (AC-2) -> implement.
2. Red: provider tests with a fake xterm buffer incl. wrapped rows, wide chars, selection guard (AC-3) -> implement.
3. Notice kind + `probeSessionFile` + hook tests (inside / outside evidenced / 403 -> notice / non-403 error -> still opens viewer) -> implement.
4. Wire EmbeddedTerminal + TaskDetailPage; compact: switch active pane to right like `handleSelect`.
5. E2E (isolated stack): web link, project file, evidenced outside, unevidenced outside + Pixel-5 touch-scroll case.
6. Spec FR-01.28 ACs, architecture.md note, changelog drop, ADR.

## Test strategy
Vitest unit (match, provider, hook), existing `openTerminalLink` tests untouched, Playwright E2E via `isolated-stack.mjs` at desktop and Pixel-5 viewport. The E2E prints text into the real pty (`echo`/`printf` of fixture paths) so the real buffer, real link provider and real routes are exercised. Evidence for the "evidenced" case: a task JSONL under the isolated HOME that mentions the outside file.

## Alternative approach (medium only)
Extend the existing `WebLinksAddon` regex to also match paths: rejected - the addon only builds http(s) links through a single regex and its handler cannot distinguish kinds, so the https-only safety of `openTerminalLink` would have to be loosened; a separate `registerLinkProvider` keeps the two kinds isolated.
Server-side path detection in the pty stream: rejected - touches the pty/replay rules that are explicitly frozen.
