# AC-7 — falsification evidence

Run: `iterate-2026-08-01-semgrep-suppression-ratchet`

A ratchet nobody has watched fail is not yet a ratchet. Eleven mutations were
applied to the real tree, one at a time, each reverted to its exact original
bytes before the next. **All eleven turn the suite RED**, and the suite returns
to GREEN after every restore.

Cases 9-11 are the ones that matter most: each was **GREEN** before the Stage-2
code review found it, i.e. each was a working suppression the ratchet could not
see. A false positive costs an argument; a false negative costs the guard.

Run **with the four new modules TRACKED** (`git add -N`). That is not a detail:
discovery reads `git ls-files`, so an untracked guard cannot see its own source
— which is precisely how the self-suppression defect below survived to review.

Suite under test:

```
scripts/ci/tests/test_semgrep_scan_scope.py
scripts/ci/tests/test_semgrep_inline_suppressions.py
scripts/ci/tests/test_semgrep_channels_scanner.py
```

## Scan-SCOPE channel (`.semgrepignore`)

| # | Mutation | Result | Message |
|---|---|---|---|
| 1 | ADD an unregistered pattern (`client/src/lib/`) | **RED** | `these .semgrepignore patterns are live but not pinned: ['client/src/lib/']` |
| 2 | REMOVE a registered pattern (`build/`) | **RED** | `these patterns are pinned here but no longer in .semgrepignore: ['build/']` |
| 3 | ADD an unsupported pattern shape (`!client/src/keep.ts`) | **RED** | `these .semgrepignore patterns are live but not pinned: ['!client/src/keep.ts']` |
| 8 | ADD an unsupported shape **and register it**, so the set-equality test passes and execution reaches the matcher | **RED** | `semgrep_channels.UnsupportedPattern: !client/src/keep.ts` |

Case 8 exists because case 3 alone does not prove what it looks like it proves:
it is caught by the *set* test, which would still fire if the syntax allowlist
were absent. Case 8 satisfies the set test first, so it is the one that shows
the allowlist itself fails closed.

## Inline-directive channel

| # | Mutation | Result | Message |
|---|---|---|---|
| 4 | ADD a directive at a NEW site — `server/scripts/copy-assets.mjs`, the file this iterate's narrowing put back in scope | **RED** | `the inline suppression set has drifted` (live but NOT pinned) |
| 5 | ADD a SECOND directive for an already-registered `(file, rule)` pair | **RED** | `the inline suppression set has drifted` (count mismatch) |
| 6 | ADD a BARE directive naming no rule | **RED** | `these lines carry a suppression marker but name no rule` |
| 7 | DELETE a registered directive | **RED** | `the inline suppression set has drifted` (pinned but NOT live) |

Case 4 is doing double duty: it also proves the `.semgrepignore` narrowing is
real. Before this change `server/scripts/` was excluded wholesale, so a
directive there would have been invisible.

## The four false-negative classes the Stage-2 code review found

Each of these was a **working suppression that the ratchet reported as GREEN**
until the review. They are the reason the parser is now deliberately over-broad.

| # | Mutation | Result | Why it was invisible before |
|---|---|---|---|
| 9 | UPPER-CASE directive at a new site | **RED** | Semgrep's inline matcher runs under `re.IGNORECASE`; ours did not, so `NOSEMGREP:` suppressed for real and scanned as nothing. (F1) |
| 10 | A second, WHITESPACE-separated rule id smuggled onto an already-blessed directive | **RED** | The old regex captured only the first comma-run, so the pinned count stayed 1 while Semgrep honoured both ids — an evasion against the very count-pinning that exists to stop "add it beside a blessed one". (F4) |
| 11 | Directive in `scripts/hooks/pre-commit` (extensionless, `#!/usr/bin/env bash`) | **RED** | The extension allowlist classified every extensionless file as "not source". Semgrep's language guesser reads shebangs, so that file IS analysed as bash — and it is the bloat anti-ratchet gate, executable code. (F3) |

The fourth, **F2**, has no single mutation because it was a whole-parser change:
`.py` was read through `tokenize` so that only COMMENT tokens counted. Semgrep
does not parse comments at all — it regex-matches a finding's raw line — so a
marker inside a Python STRING was honoured by Semgrep and invisible here, inside
`scripts/ci/` and `scripts/hooks/`, the CI trust boundary. Every language is now
read line by line, and the one file that cannot comply (the vendored
`accepted_risk_scan.py`) carries a rot-guarded `PROSE_EXEMPT` entry instead.
Fixtured by `test_python_is_scanned_line_by_line_exactly_like_every_other_language`
and `test_the_prose_exemptions_still_point_at_a_marker`.

Note what the F2 fix did on its own: it immediately turned the suite red on two
docstrings in the fixture module that still carried the marker literal — the
guard catching the same class of mistake a second time, this time unaided.

## The evasions an ADVERSARIAL review found (Stage 3)

Stage 3 was asked to find a fifth evasion after Stage 2's four. It found three,
plus a bypass. All were GREEN at the time.

| # | Mutation | Result | Why it was invisible before |
|---|---|---|---|
| 12 | A second rule id separated by a FORM FEED | **RED** | `str.splitlines()` breaks on VT/FF/FS/GS/RS/NEL/LS/PS; Semgrep's line reader does not. So `<marker>: blessed\fsmuggled` was ONE line to Semgrep (both ids honoured) and TWO to us, the second carrying no marker — with the blessed count unchanged. Now `split("\n")`. (D-1) |
| 13 | A BARE marker earlier on the same line as a named one | **RED** | We searched for the first marker *followed by a colon*, skipping an earlier bare one. Semgrep matches the FIRST occurrence, finds no ids, and applies the BLANKET form — silencing every rule on the line. Now every marker on the line is parsed and one bare marker anywhere voids it. (D-2) |
| 14 | A second block-comment directive after the first terminator | **RED** | We truncated at the first `*/` and discarded the rest of the line. (D-3) |
| 15 | A `PROSE_EXEMPT` entry pointing at a NON-vendored file | **RED** | The exemption table suppressed the suppression-detector with no ratchet of its own: one entry made any directive invisible. Now vendored-only, rule-less-only, and count-pinned. (D-7) |

Three further doubts were closed without a mutation because they are guards
rather than parser behaviour: the scanner's invocation is now asserted
(`--config auto`, whole tree, no `--exclude`/`--include`), a nested
`.semgrepignore` is forbidden, `REQUIRED_SCANNED` floors the languages that
cannot be relabelled away, and the ratchet modules assert each other's existence.

## Two probe bugs worth recording

**(a) A no-op mutation reads exactly like a gap.** Pass 1 reported case 2 as
GREEN — "the ratchet does not cover this". It was a **probe** bug: the working
tree is CRLF (`git ls-files --eol` reports `w/crlf`) and the mutation matched on
`\n`, so it changed nothing and the suite was correctly green on an unchanged
file. Re-run line-based (EOL-agnostic) in pass 2, case 2 is RED. Recorded because
"the guard did not fire" and "the guard was never given anything to fire on" look
identical in a green line of output. Every probe now asserts its own mutation is
not a no-op before running the suite.

**(b) A KILLED falsification run poisons the next one.** Pass 4 was once launched
inside a loop that hit a 2-minute timeout and was terminated mid-case, so the
`finally:` that restores the original bytes never ran. The mutation stayed on
disk; the next run read it as the baseline, mutated on top, and "restored" to the
poisoned state — reporting `4/4 falsified` alongside a suite that was still red.
Caught by checking the tree after every pass rather than trusting the summary
line. Falsification harnesses mutate real files: verify the tree, not the report.

## The defect this evidence would have missed

The Stage-1 spec review found that `semgrep_channels.py` carried the marker
literal in a `#:` comment above the rule-id grammar. The module's own scanner
classified it as a rule-less directive, so `test_every_directive_names_the_rule_
it_silences` went red the moment the files were tracked — CI red for the wrong
reason, on the commit that introduced the guard.

It was invisible locally because every falsification run up to that point used
an UNTRACKED working tree. Reproduced, then fixed by moving the prose into the
module docstring (a STRING token, invisible to `tokenize`) and re-auditing all
four modules: **0 comment-position markers in each**. Both falsification passes
were then re-run on the tracked tree with the results above.
