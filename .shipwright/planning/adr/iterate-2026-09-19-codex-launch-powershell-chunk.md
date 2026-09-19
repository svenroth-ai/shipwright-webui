# ADR — codex-launch-powershell-chunk

## Context

Clicking Launch on a Codex task (guided or autonomous) failed on
Windows/pwsh.exe with `done:false: The term 'done:false' is not recognized
as a name of a cmdlet, function, script file, or executable program.` — the
Codex process never started.

Empirically reproduced against a real `pwsh.exe` via `@lydell/node-pty`:
PSReadLine (PowerShell 7's line editor), fed the Codex launch command as one
pty-injected string (the webui's auto-execute mechanism — `ChunkedPtyWriter`
writing the whole command at once, not real interactive typing or a true
terminal paste event), corrupts its own multi-line edit buffer whenever the
single-quoted argument contains a literal embedded newline. Codex's prompt
(built by `buildCodexPrompt()`) is always multi-paragraph — model pins,
`SKILL.md` pointer, task description, `SHIPWRIGHT-STATUS` footer,
blank-line-separated — so this triggered on every fresh launch.

## Decision

Added `qPsMultiline()` (`server/src/core/shell-quote.ts`): pass-through to
the existing `qPs()` when the value has no `\r`/`\n`; otherwise Base64-encode
it and wrap it in a PowerShell sub-expression
(`$([System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('<b64>')))`)
that decodes back to the exact original text before the enclosing command
ever runs, so no literal newline ever reaches the pty. `renderCodex()` in
`launcher-codex.ts` uses it only for the PowerShell form's prompt argument;
`cmd`/`posix` forms and the resume path (which only embeds `threadId`, a
UUID) are untouched.

## Consequences

Codex launches (fresh, guided and autonomous) now work on Windows PowerShell
7 without truncating or corrupting the multi-paragraph prompt. `cmd.exe`'s
auto-execute path is left on the plain quoter — unproven for this class
(disclosed follow-up from code review, not reproduced or reported as broken).
No architectural surface changed: one new pure string-transform helper plus
its single call site.

## Rationale

Verified live and empirically rather than guessed. A control run with a
fully atomic (unchunked) `pty.write()` reproduced the bug identically,
ruling out `ChunkedPtyWriter`/ADR-308 chunking as the cause. Bracketed-paste
wrapping (`ESC[200~`/`ESC[201~`) also did not prevent the corruption.
Removing every literal newline from the wire (Base64 + a PowerShell-native
decode sub-expression) was the only approach that survived a real `pwsh.exe`
repro, both through the production chunked-write path and an atomic-write
path — `codex` launched cleanly and reached its TUI in both.

## Rejected alternatives

- **`ChunkedPtyWriter` chunking as root cause** — disproved by the atomic-write
  control test; chunking (ADR-308) stays, it is load-bearing for an unrelated
  macOS deadlock.
- **Bracketed-paste wrapping** — tested live, did not prevent the corruption.
- **Rejecting/truncating multi-line prompts outright** — mirrors
  `launcher.ts`'s existing "Title cannot contain newlines" guard for the
  Claude launcher, but Codex prompts are legitimately multi-paragraph, so
  preserving content via decode was preferred over rejection.

## Spec impact

NONE — restores intended, already-documented behavior (a Launch click must
start Codex); no FR-level behavior change.
