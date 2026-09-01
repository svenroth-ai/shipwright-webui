# ADR-288 spec — Root cause of the residual embedded-terminal table smear

**Linked decision:** `.shipwright/agent_docs/decision_log.md` → ADR-288.
**Run-ID:** iterate-2026-09-01-terminal-table-smear-root-cause.
**Type:** Investigation (BUG intent, F-debug protocol) — no code change, by
explicit user choice.
**Predecessors:** rule 28 (WebGL glyph-atlas, PR #325), rule 29 / ADR (CUF
stale-cell post-replay redraw nudge, `cuf-stale-cell-repro.test.ts`), #335
(dropped-WS-bytes resync).

## Iron Law compliance (F-debug four phases)

1. **Read Error** — user-reported symptom, screenshot of the "npx Activation"
   task: stray single characters (`y`, `l`, `u`, `*`, `e`) surviving at the
   same column position across three consecutive rows of a live status table
   ("Where it stands" — Item/State). Prior smear classes (idle tab-switch,
   WebGL atlas, dropped-byte reattach) are fixed; this one is now confined to
   tables.
2. **Reproduce** — reproduced from the actual raw pty byte log for this exact
   task, not a synthetic fixture. Task `ea5b4233-b8c4-4164-b0b8-f2b3bebc1f27`
   (title "npx Activation"), scrollback rotation file
   `~/.shipwright-webui/terminal-scrollback/ea5b4233-b8c4-4164-b0b8-f2b3bebc1f27.log.1`.
   The literal string `"Blocking check"` (one cell of the affected table)
   recurs **20 times** in that file — the row is redrawn in place repeatedly
   over the task's live lifetime, never just once.
3. **Recent changes** — not a regression from rule 28/29/#335: those fixes
   target divergences the CLIENT introduces (WebGL atlas staleness,
   reattach-restored cell-state snapshot, dropped WS bytes). None of those
   apply here — this reproduces from the raw byte stream alone, with zero
   reconnect / resize / replay involved on our side.
4. **Component-boundary instrumentation** — extracted raw bytes around three
   consecutive redraws of the same table row (offsets 956835, 961634, 977969
   in the log; `ESC` written out, `CR`/`LF` marked):

   ```
   === offset 956835 (row 18) ===
   ...│ Blocking check ␣│ ESC[38;2;177;185;249mPR Review ESC[m=␣ESC[1C🔴 BLOCK │ ESC[1mby policy, not by defect ESC[22m
   ESC[10X ESC[11C␣␣␣␣␣␣ ESC[1C ESC[15X ESC[16C␣␣␣␣␣ ESC[1C␣␣␣ ESC[3C│ ESC[19;3H└───...

   === offset 961634 (row 21) ===
   [identical pattern, row shifted 18→21 — the table grew 3 lines taller
    between these two redraws]

   === offset 977969 (row 8, later — after a full clean reprint elsewhere) ===
   ...│ Blocking check  │ ESC[38;2;177;185;249mPR Review ESC[m= 🔴 BLOCK │ by policy, not by defect
   [pure literal spaces padding to the border — no ESC[X / ESC[C gaps at all]
   ```

   `ESC[nX` is ECH (erase n characters, cursor stays). `ESC[nC` is CUF
   (cursor forward n columns, **does not erase**). In both live redraws:
   `ESC[10X` then `ESC[11C` — erases 10 characters but advances 11 columns,
   leaving column 11 untouched. Same pattern at 15/16. And the row ends with
   a bare `ESC[3C` — three columns skipped with **no erase at all**. Those
   skipped columns are written only if the row is later redrawn again with
   content that happens to reach them; if not, whatever was there from an
   **earlier, differently-laid-out edition of the same row** (before the
   table grew/re-flowed) survives forever once the row scrolls into
   scrollback. That is exactly the artifact in the screenshot: isolated stale
   characters at a fixed column across several rows.

   **Root-cause statement:** Claude Code's own live in-place table-row
   redraw pads cell content with erase (`ECH`) + cursor-forward (`CUF`) in a
   way that leaves a 1-or-more-column gap un-erased per padding segment. When
   the table's layout changes shape between two live redraws of the *same*
   row (observed: the box grew 3 rows taller between the two mid-run
   redraws captured above), text from an earlier, differently-shaped
   rendering of that row can occupy exactly those skipped columns, and is
   never erased because Claude's own diff model assumes they were already
   blank. The final full reprint (offset 977969, pure spaces, no gaps) shows
   Claude *does* eventually redraw cleanly once the value is final — but the
   smeared intermediate edition, once scrolled past, is permanent, because
   nothing ever revisits scrollback.

## Why this is a distinct mechanism from rule 28 / rule 29 / #335

All three prior fixes correct a divergence **we (the client) introduce**
between the actual buffer and what Claude's own screen model believes is
there (a stale GPU atlas, a restored cell-state snapshot Claude never drew,
bytes dropped in transit). The fix in each case is to force Claude into a
full repaint at the moment the divergence is created (reattach / atlas
mutation / resize nudge).

This case has **no such moment** to hang a fix on: the byte stream shown
above was captured with **no client reconnect, no browser-side resize, and
no dropped bytes** — Claude produced these exact ECH/CUF-gap bytes during
ordinary, uninterrupted live operation, redrawing its own still-open status
table as steps completed. It is why the previous three fixes closed every
other manifestation of "smear" but left tables (the one content type
Claude repeatedly rewrites in place while a task is still running)
unaffected.

## Decision

**Document the root cause; do not attempt a client-side mitigation now.**
Rationale given by the user: the defect originates entirely in Claude Code's
own live table-redraw output (verified from raw captured bytes, zero
replay/resize/reconnect involvement on the webui side), so a durable fix
belongs upstream. A client-side workaround would require a live ANSI-stream
sanitizer that recognizes an ECH-count/CUF-count mismatch (or a bare CUF with
no preceding erase) and pads the gap itself before handing bytes to xterm.js
— judged too invasive/fragile to justify today, given the failure mode is
already understood, cosmetic (scrollback-only, does not corrupt the live
task state or any completed value), and self-limited to the pre-final
edition of a table row.

## Consequences

- The residual table-smear class is now understood and documented — future
  iterations should not re-litigate rule 28/29/#335 against it; it is a
  fourth, distinct, **upstream** mechanism.
- No code changed. No test added (nothing to pin — there is no client-side
  behavior to assert against).
- If a client-side mitigation is wanted later, the shape is known: detect
  `ESC[<n>X` immediately followed by `ESC[<m>C` with `m > n` (or a bare
  `ESC[<n>C` with no preceding `X` in the same redraw burst) in the pty
  output pipe, and re-emit spaces for the `m - n` gap columns before
  forwarding to xterm.js / the cell-state mirror.

## Rejected alternatives

1. **Build the ANSI-gap sanitizer now** — rejected per the user's explicit
   choice (documentation only, no code this iterate).
2. **Treat it as a regression of rule 28/29** — rejected; verified from raw
   bytes that neither mechanism (WebGL atlas, cell-state snapshot restore)
   is present in this reproduction.
3. **File it upstream to Anthropic in this same iterate** — left to the user
   to decide separately; out of scope for this documentation-only run.
