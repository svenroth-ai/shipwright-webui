# Triage page — help texts for review

Shown behind the "?" icons on the Triage page. Source of truth: `client/src/lib/triageHelpText.ts` — edit the wording there; this file is generated from it (a test keeps the two in sync). Severities (critical, high, medium, low) have no help marker on purpose.

> Drafted prose — not yet verified against the compliance check implementations.

## Sources

### Compliance  `compliance`
- **What is it:** A regular health check compared the project's requirements, code, tests and documents and found gaps.
- **Why is it here:** All open findings of one check run sit on this card. It stays until the gaps are closed or you decide they are fine.
- **What Fix now does:** Fix now starts a task that works through the findings on this card. For single lines use Promote (turn it into a planned task) or Dismiss (ignore it).

### Phase quality  `phaseQuality`
- **What is it:** A finished step of the project's build process (a phase) is missing a required record, such as its completion note or changelog entry.
- **Why is it here:** The phase shows as done, but the project's own quality check found that bookkeeping step missing.
- **What Fix now does:** Fix now starts a short task that writes the missing record.

### Manual  `manual`
- **What is it:** Added by a person, or by an AI work session on their behalf, not by an automatic check.
- **Why is it here:** Somebody decided it was worth keeping.
- **What Fix now does:** Fix now starts a task from this note, using its text as the brief.

### Operator  `operator`
- **What is it:** A note or request you added yourself.
- **Why is it here:** You decided it should be kept, even though no automatic check found it.
- **What Fix now does:** Fix now starts a task from this note, using its text as the brief.

### GitHub  `github`
- **What is it:** A finding reported by GitHub.
- **Why is it here:** It happened outside this app and is kept here so it is not lost.
- **What Fix now does:** Fix now starts a task that uses the title and description as its brief.

### Drift  `drift`
- **What is it:** The project's documentation and the files on disk no longer match.
- **Why is it here:** A file or folder exists that the documentation does not mention, or the other way round.
- **What Fix now does:** Fix now starts a task that updates the documentation to match, or removes the file if it is a leftover.

### Required checks  `required-checks`
- **What is it:** Some automatic checks run on every change but are not marked as must-pass for merging.
- **Why is it here:** Because they are not required, a failing check would not stop a change from being merged.
- **What Fix now does:** Fix now starts a task that adds them to the must-pass list, or marks them as optional on purpose.

### GitHub  `github: security scan summary`
- **What is it:** Security scan results reported by GitHub for this project.
- **Why is it here:** GitHub reported these outside this app. One card collects the findings of one scan so none is lost.
- **What Fix now does:** Fix now starts a task that reviews the findings, most serious first, and fixes what it safely can.

### GitHub  `github: failing pull-request check`
- **What is it:** A pull request (a proposed change) has an automatic check on GitHub that fails.
- **Why is it here:** A failing check usually keeps the change from being merged.
- **What Fix now does:** Fix now starts a task that finds out why the check fails and tries to fix it.

## Any other source

Sources are free text and differ per project, so every other source shows this generic text.

### any-other-source  `any other source`
- **What is it:** Reported by a tool or a working session in this project.
- **Why is it here:** This app has no built-in explanation for this source. The card's own text describes the problem.
- **What Fix now does:** Fix now starts a task that uses the title and description as its brief. Open the card to read the details first.

## Audit checks

### Audit setup problem  `A/A5.0`
- **What is it:** The audit could not run one of its own setup steps, for example because a tool is missing on this machine.
- **Why is it here:** Without that step some checks cannot be judged at all.
- **What Fix now does:** Fix now starts a task that installs or repairs the missing tool and runs the audit again.

### Audit input check failed  `A/A5.6`
- **What is it:** A check of the data the audit reads failed.
- **Why is it here:** Some of that data is missing or broken, so the audit's results may be wrong.
- **What Fix now does:** Fix now starts a task that finds the cause named in the line and repairs it.

### Commits not in the project log  `B/B7`
- **What is it:** Some saved changes (commits) since the last release are missing from the project's history log, usually because they were made outside a tracked task.
- **Why is it here:** Without a log entry nobody can see why the change was made.
- **What Fix now does:** Fix now starts a task that adds the missing log entries.

### Requirement without plan or design  `C/C1`
- **What is it:** A requirement is not linked to any plan or design.
- **Why is it here:** Without a plan, nobody can tell how the requirement will be built.
- **What Fix now does:** Fix now starts a task that adds the missing plan or design reference.

### Test missing at a required level  `D/D-layer`
- **What is it:** A requirement has no passing test at a level it must be tested at, for example unit tests exist but no test in a real browser.
- **Why is it here:** Each requirement declares the test levels it needs.
- **What Fix now does:** Fix now starts a task that adds and runs the missing test, or corrects the declared levels.

### Test without a requirement  `D/D-orphan`
- **What is it:** A test points to a requirement that no longer exists, or names none.
- **Why is it here:** A test that is not linked to a requirement proves nothing anyone asked for.
- **What Fix now does:** Fix now starts a task that links the test to the right requirement, or removes it if it is obsolete.

### Requirement never worked on  `D/D1`
- **What is it:** Some requirements have no recorded work at all.
- **Why is it here:** They may be forgotten, or done without a record.
- **What Fix now does:** Fix now starts a task that records work already done, or schedules it.

### Requirement changed without follow-up  `D/D2`
- **What is it:** A requirement was changed after the last recorded work on it.
- **Why is it here:** The existing work may no longer match the new wording.
- **What Fix now does:** Fix now starts a task that checks whether the work still matches and confirms it.

### Promised requirements not delivered  `D/D3`
- **What is it:** Requirements planned for this release are not delivered yet.
- **Why is it here:** The release would ship without them.
- **What Fix now does:** Fix now starts a task that delivers them or moves them to a later release.

### Last work on a requirement had failing tests  `D/D4`
- **What is it:** The latest recorded work for a requirement ended with failing tests.
- **Why is it here:** The requirement cannot be counted as working.
- **What Fix now does:** Fix now starts a task that fixes the tests and records a new passing run.

### Change not linked to a requirement  `D/D5`
- **What is it:** A feature or change is not linked to any requirement.
- **Why is it here:** Changes without a requirement cannot be traced back to a purpose.
- **What Fix now does:** Fix now starts a task that links it to a requirement, or notes that it needs none.

### Traceability report out of date  `E/E1`
- **What is it:** The report linking each requirement to its plan, code and tests is out of date.
- **Why is it here:** The data it is built from changed after the report was last produced.
- **What Fix now does:** Fix now regenerates the report. The code itself does not change.

### Test evidence report out of date  `E/E2`
- **What is it:** The report showing which tests ran and passed is out of date.
- **Why is it here:** The data it is built from changed after the report was last produced.
- **What Fix now does:** Fix now regenerates the report. The code itself does not change.

### Change history out of date  `E/E3`
- **What is it:** The report listing every change and why it was made is out of date.
- **Why is it here:** The data it is built from changed after the report was last produced.
- **What Fix now does:** Fix now regenerates the report. The code itself does not change.

### Component list (SBOM) out of date  `E/E4`
- **What is it:** The list of all third-party components the software contains is out of date.
- **Why is it here:** The data it is built from changed after the report was last produced.
- **What Fix now does:** Fix now regenerates the report. The code itself does not change.

### Compliance dashboard out of date  `E/E5`
- **What is it:** The summary page of all compliance results is out of date.
- **Why is it here:** The data it is built from changed after the report was last produced.
- **What Fix now does:** Fix now regenerates the report. The code itself does not change.

### Oversized decision records  `F/F4`
- **What is it:** Some entries in the decision log (the record of why the project is built this way) are very long and point to no detailed document.
- **Why is it here:** Long entries make the log hard to read.
- **What Fix now does:** Fix now starts a task that moves each long entry into its own document and links it.

### Architecture document not set up for updates  `F/F5`
- **What is it:** The architecture document lacks the starting point that automatic updates need.
- **Why is it here:** Without it, new architecture notes are not copied into the document.
- **What Fix now does:** Fix now starts a task that sets that starting point once.

### Project instructions too long  `F/F6`
- **What is it:** The file that instructs the AI assistant about this project grew past its size cap.
- **Why is it here:** Very long instructions are followed less reliably.
- **What Fix now does:** Fix now starts a task that moves the detail into separate files and shortens it.

### Change labelled with an unknown area  `G/G2`
- **What is it:** A saved change is tagged with a project area (for example 'standalone') that does not exist.
- **Why is it here:** Changes in unknown areas are hard to find and report on.
- **What Fix now does:** Fix now starts a task that corrects the tag, or registers the name as another name for an existing area.

### File too large  `H/H1`
- **What is it:** A source file grew past the size limit and is not on the list of allowed exceptions.
- **Why is it here:** Very large files are harder to change safely.
- **What Fix now does:** Fix now starts a task that splits the file into smaller ones.

### Size limit can be tightened  `H/H2`
- **What is it:** A file is now smaller than its allowed limit, so the limit can be lowered.
- **Why is it here:** Lowering it stops the file from growing back.
- **What Fix now does:** Fix now starts a task that lowers the limit for that file.

### Outdated size-limit entry  `H/H6`
- **What is it:** The list of allowed file sizes has an entry that no longer matches a file.
- **Why is it here:** An entry for a file that no longer exists or was renamed checks nothing.
- **What Fix now does:** Fix now starts a task that corrects or removes the entry.

### Audit housekeeping  `I/I5`
- **What is it:** The audit found a small tidy-up item; the line names it.
- **Why is it here:** Left alone, these pile up and hide real problems.
- **What Fix now does:** Fix now starts a task that tidies it up.

### Phase completion record missing  `C1`
- **What is it:** A phase finished without recording that it ended.
- **Why is it here:** The phase shows as done, but the quality check found no completion record.
- **What Fix now does:** Fix now starts a task that writes the record, using the command shown in the item's details.

### Changelog entry missing  `C5`
- **What is it:** The changelog has no 'Added' entry for this phase.
- **Why is it here:** The phase shows as done, but the quality check found no changelog entry.
- **What Fix now does:** Fix now starts a task that adds the changelog entry.

### Work summary missing  `W3`
- **What is it:** A phase finished without recording what was done (files changed, tests run).
- **Why is it here:** The phase shows as done, but the quality check found that summary missing.
- **What Fix now does:** Fix now starts a task that writes the summary, using the command shown in the item's details.

