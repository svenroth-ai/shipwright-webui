# Bug report (small-complexity BUG iterate — no formal spec file)

## Symptom
Clicking Launch on a Codex task (guided and autonomous) in the embedded
terminal fails on Windows/PowerShell 7 (pwsh.exe). The user sees:

```
done:false: The term 'done:false' is not recognized as a name of a cmdlet,
function, script file, or executable program.
```

The Codex process never launches.

## Root cause (empirically verified against a real pwsh.exe via node-pty)
The Codex launch command embeds a multi-paragraph prompt (model pins,
SKILL.md pointer, task description, SHIPWRIGHT-STATUS footer — built by
`buildCodexPrompt()` in `server/src/core/launcher-codex.ts`, blank-line
separated) inside a PowerShell single-quoted string. The quoting itself
(`qPs()` in `server/src/core/shell-quote.ts`) is syntactically correct. But
PSReadLine (PowerShell 7's line editor), fed this text via pty
keystroke-injection (the webui's auto-execute mechanism writes the whole
command as one string to the pty — not real interactive typing or a true
terminal paste event), corrupts its own multi-line edit buffer whenever the
string contains a literal embedded newline. A trailing fragment of the
string is then parsed and executed as a bare command once Enter is
processed.

Proven NOT caused by `ChunkedPtyWriter` (server/src/terminal/pty-write-chunker.ts,
FR-01.28/ADR-308) — fails identically via one fully atomic `pty.write()`.
Not fixed by bracketed-paste wrapping (ESC[200~/ESC[201~). A control with
identical byte length but all newlines collapsed to spaces executed
cleanly — isolating the trigger to "any literal newline in a single-quoted
PowerShell arg delivered via pty keystroke injection to PSReadLine".

## Fix
New `qPsMultiline()` helper (`server/src/core/shell-quote.ts`): passes
through to `qPs()` unchanged when the input has no `\r`/`\n`; otherwise
Base64-encodes the text and wraps it in a PowerShell sub-expression
(`$([System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('<b64>')))`)
that decodes back to the exact original text before the enclosing command
ever runs — so no literal newline reaches the pty. `renderCodex()` in
`server/src/core/launcher-codex.ts` uses it only for the PowerShell form's
prompt argument; `cmd`/`posix` are untouched (bug is PowerShell/PSReadLine-
specific). Mirrors `launcher.ts`'s existing "Title cannot contain newlines"
guard for the Claude launcher, extended to preserve Codex's legitimately
multi-paragraph prompt instead of rejecting it outright.

Validated empirically end-to-end (real pwsh.exe, both the production
chunked-write path and an atomic-write path): `codex` now launches cleanly.

## Spec impact
NONE — restores intended behavior (Codex launches must execute), no FR
change.
