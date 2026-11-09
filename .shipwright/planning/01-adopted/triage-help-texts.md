# Triage page — help texts for review

Shown behind the "?" icons on the Triage page. Source of truth: `client/src/lib/triageHelpText.ts` — edit the wording there; this file is generated from it (a test keeps the two in sync).

> Drafted prose — not yet verified against the compliance check implementations.

## Sources

### Compliance  `compliance`
- **What is it:** A recurring audit found gaps between requirements, code, tests and docs.
- **Why is it here:** One card bundles all open findings of one audit run. It does not go away on its own.
- **What do I do:** Open the lines below. Promote the real gaps, dismiss the ones that are intended.

### Phase quality  `phaseQuality`
- **What is it:** A finished phase skipped a mandatory record (event or changelog entry).
- **Why is it here:** The phase is marked done, but a quality check disagrees.
- **What do I do:** Fix now repairs the record.

### Campaign  `req3`
- **What is it:** Created by a campaign: a planned work package.
- **Why is it here:** The campaign wants a decision here before it continues.
- **What do I do:** Start the campaign, or park it until you are ready.

### Campaign  `req3-campaign`
- **What is it:** Created by a campaign: a planned work package.
- **Why is it here:** The campaign wants a decision here before it continues.
- **What do I do:** Start the campaign, or park it until you are ready.

### Tooling  `tooling`
- **What is it:** A problem noticed in the Shipwright tooling itself.
- **Why is it here:** Found while working on something else and kept so it is not lost.
- **What do I do:** Fix it now if it blocks you, otherwise park it.

### Manual  `manual`
- **What is it:** Added by hand, from you or from a session.
- **Why is it here:** Nothing detected it; a person decided to keep it.
- **What do I do:** Promote it when you are ready to work on it.

### Operator  `operator`
- **What is it:** A note or request you (the operator) added yourself.
- **Why is it here:** You decided it should be kept, even though no check found it.
- **What do I do:** Promote it when you are ready to work on it, or dismiss it if it is done.

### GitHub  `github`
- **What is it:** A finding from GitHub: a security scan roll-up or a failing check on a pull request.
- **Why is it here:** It happened outside this app and is kept here so it is not lost.
- **What do I do:** Check high severities first. Fix now starts a security task.

### Drift  `drift`
- **What is it:** Documentation and the files on disk disagree.
- **Why is it here:** A file exists that the docs do not list, or the other way round.
- **What do I do:** Update the docs or remove the stray file.

### Required checks  `required-checks`
- **What is it:** A check runs but does not block merging because it is not marked as required.
- **Why is it here:** The set of must-pass checks does not match the checks that actually run.
- **What do I do:** Add the check to the required set, or remove it.

## Severities

### Critical severity  `critical`
- **What is it:** Act now. Can endanger data, security or delivery.
- **Why is it here:** The tool that found it rates how much damage or risk it carries.
- **What do I do:** Higher severity is handled earlier. Change it with the pencil if the rating is off.

### High severity  `high`
- **What is it:** Fix soon. Noticeable damage or risk.
- **Why is it here:** The tool that found it rates how much damage or risk it carries.
- **What do I do:** Higher severity is handled earlier. Change it with the pencil if the rating is off.

### Medium severity  `medium`
- **What is it:** Plan it. No acute damage.
- **Why is it here:** The tool that found it rates how much damage or risk it carries.
- **What do I do:** Higher severity is handled earlier. Change it with the pencil if the rating is off.

### Low severity  `low`
- **What is it:** A small improvement.
- **Why is it here:** The tool that found it rates how much damage or risk it carries.
- **What do I do:** Higher severity is handled earlier. Change it with the pencil if the rating is off.

### Info severity  `info`
- **What is it:** For your information only.
- **Why is it here:** The tool that found it rates how much damage or risk it carries.
- **What do I do:** Higher severity is handled earlier. Change it with the pencil if the rating is off.

## Audit checks

### Audit setup problem  `A/A5.0`
- **What is it:** The audit could not run one of its own setup steps, for example a missing tool on this machine.
- **Why is it here:** Without that step some checks cannot be evaluated.
- **What do I do:** Install the missing tool named in the line and run the audit again.

### Audit setup problem  `A/A5.6`
- **What is it:** A setup check of the audit failed.
- **Why is it here:** The audit could not trust its own inputs.
- **What do I do:** Read the line for the cause and fix the setup.

### Commits not in the project log  `B/B7`
- **What is it:** Some commits since the last release have no matching entry in the project log, usually changes made outside an iterate.
- **Why is it here:** It is one line of an audit that found it.
- **What do I do:** Add the missing entries, or dismiss if the commits are intentional.

### Requirement without plan or design  `C/C1`
- **What is it:** A requirement has no link to a plan or a design.
- **Why is it here:** It is one line of an audit that found it.
- **What do I do:** Add the missing plan or design reference.

### Test missing at a required level  `D/D-layer`
- **What is it:** A requirement has no passing test at a level it must be tested at, for example only unit tests and no browser test.
- **Why is it here:** The requirement declares the levels it needs.
- **What do I do:** Add and run the missing test, or correct the declared levels.

### Test without a requirement  `D/D-orphan`
- **What is it:** A test refers to a requirement that no longer exists or is not named.
- **Why is it here:** It is one line of an audit that found it.
- **What do I do:** Re-tag the test or remove it.

### Requirement never worked on  `D/D1`
- **What is it:** Requirements exist for which the project log shows no work at all.
- **Why is it here:** It is one line of an audit that found it.
- **What do I do:** Plan the work, or retire the requirement.

### Requirement changed without follow-up  `D/D2`
- **What is it:** A requirement changed after its last recorded work.
- **Why is it here:** It is one line of an audit that found it.
- **What do I do:** Check whether the work still matches, then re-confirm it.

### Promised requirements not delivered  `D/D3`
- **What is it:** Requirements marked as promised are not delivered yet.
- **Why is it here:** It is one line of an audit that found it.
- **What do I do:** Check the list, deliver or re-plan.

### Last work on a requirement had failing tests  `D/D4`
- **What is it:** The latest recorded work for a requirement ended with red tests.
- **Why is it here:** It is one line of an audit that found it.
- **What do I do:** Fix the tests and record a new passing run.

### Change not linked to a requirement  `D/D5`
- **What is it:** A feature or change is not linked to any requirement.
- **Why is it here:** It is one line of an audit that found it.
- **What do I do:** Link it to the right requirement, or record that it changes none.

### Traceability report out of date  `E/E1`
- **What is it:** A generated report is out of date.
- **Why is it here:** The source it is built from changed after the report was last produced.
- **What do I do:** Regenerate it. No change in the code is needed.

### Test evidence report out of date  `E/E2`
- **What is it:** A generated report is out of date.
- **Why is it here:** The source it is built from changed after the report was last produced.
- **What do I do:** Regenerate it. No change in the code is needed.

### Change history out of date  `E/E3`
- **What is it:** A generated report is out of date.
- **Why is it here:** The source it is built from changed after the report was last produced.
- **What do I do:** Regenerate it. No change in the code is needed.

### Software bill of materials out of date  `E/E4`
- **What is it:** A generated report is out of date.
- **Why is it here:** The source it is built from changed after the report was last produced.
- **What do I do:** Regenerate it. No change in the code is needed.

### Compliance dashboard out of date  `E/E5`
- **What is it:** A generated report is out of date.
- **Why is it here:** The source it is built from changed after the report was last produced.
- **What do I do:** Regenerate it. No change in the code is needed.

### Oversized decision records  `F/F4`
- **What is it:** Some decision records are very long and have no link to a spec.
- **Why is it here:** It is one line of an audit that found it.
- **What do I do:** Split each into its own file and link it.

### Architecture note marker missing  `F/F5`
- **What is it:** The architecture document has no marker although architecture notes exist.
- **Why is it here:** It is one line of an audit that found it.
- **What do I do:** Run the first architecture sync to set a baseline.

### Project instructions too long  `F/F6`
- **What is it:** The project instruction file grew past its size cap.
- **Why is it here:** Long instructions are read less reliably.
- **What do I do:** Move the detail into separate files and shorten it.

### Unknown commit scope  `G/G2`
- **What is it:** A commit uses a scope (for example 'standalone') that matches no known area.
- **Why is it here:** It is one line of an audit that found it.
- **What do I do:** Rename the scope or add it to the alias map.

### File too large, not in baseline  `H/H1`
- **What is it:** A source file grew past the size limit and is not on the allowed list.
- **Why is it here:** It is one line of an audit that found it.
- **What do I do:** Split the file.

### Baseline can be lowered  `H/H2`
- **What is it:** A file is now smaller than its allowed limit, so the limit can be tightened.
- **Why is it here:** It is one line of an audit that found it.
- **What do I do:** Lower the baseline entry.

### Size baseline problem  `H/H6`
- **What is it:** The list of allowed file sizes has an entry that no longer matches.
- **Why is it here:** It is one line of an audit that found it.
- **What do I do:** Correct or remove the entry.

### Audit housekeeping  `I/I5`
- **What is it:** A housekeeping check of the audit found something to tidy.
- **Why is it here:** It is one line of an audit that found it.
- **What do I do:** Read the line for the detail.

### Phase-completed event missing  `C1`
- **What is it:** The phase finished without writing its completion event.
- **Why is it here:** The phase is marked done, but a quality check disagrees.
- **What do I do:** Run the record command named in the hint.

### Changelog entry missing  `C5`
- **What is it:** The changelog has no 'Added' entry for this phase.
- **Why is it here:** The phase is marked done, but a quality check disagrees.
- **What do I do:** Prepend an entry.

### Work-completed event missing  `W3`
- **What is it:** The phase finished without recording its work-completed event.
- **Why is it here:** The phase is marked done, but a quality check disagrees.
- **What do I do:** Run the record command named in the hint.

