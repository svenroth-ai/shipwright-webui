/*
 * triageCheckHelp.ts — plain-English texts for the audit-check codes
 * (split out of triageHelpText.ts to keep both files under 300 lines).
 */

import type { HelpText } from "./triageHelpText";

const STALE_WHY = "The data it is built from changed after the report was last produced.";
const STALE_TODO = "Fix now opens a new task, pre-filled with this item, meant to regenerate the report. The code itself does not change.";

export const CHECK_HELP: Record<string, HelpText> = {
  "A/A5.0": {
    title: "Audit setup problem",
    what: "The audit could not run one of its own setup steps, for example because a tool is missing on this machine.",
    why: "Without that step some checks cannot be judged at all.",
    todo: "Fix now opens a new task, pre-filled with this item, meant to install or repair the missing tool and run the audit again.",
  },
  "A/A5.6": {
    title: "Audit input check failed",
    what: "A check of the data the audit reads failed.",
    why: "Some of that data is missing or broken, so the audit's results may be wrong.",
    todo: "Fix now opens a new task, pre-filled with this item, meant to find the cause named in the line and repair it.",
  },
  "B/B7": {
    title: "Commits not in the project log",
    what: "Some saved changes (commits) since the last release are missing from the project's history log, usually because they were made outside a tracked task.",
    why: "Without a log entry nobody can see why the change was made.",
    todo: "Fix now opens a new task, pre-filled with this item, meant to add the missing log entries.",
  },
  "C/C1": {
    title: "Requirement without plan or design",
    what: "A requirement is not linked to any plan or design.",
    why: "Without a plan, nobody can tell how the requirement will be built.",
    todo: "Fix now opens a new task, pre-filled with this item, meant to add the missing plan or design reference.",
  },
  "D/D-layer": {
    title: "Test missing at a required level",
    what: "A requirement has no passing test at a level it must be tested at, for example unit tests exist but no test in a real browser.",
    why: "Each requirement declares the test levels it needs.",
    todo: "Fix now opens a new task, pre-filled with this item, meant to add and run the missing test, or correct the declared levels.",
  },
  "D/D-orphan": {
    title: "Test without a requirement",
    what: "A test points to a requirement that no longer exists, or names none.",
    why: "A test that is not linked to a requirement proves nothing anyone asked for.",
    todo: "Fix now opens a new task, pre-filled with this item, meant to link the test to the right requirement, or remove it if it is obsolete.",
  },
  "D/D1": {
    title: "Requirement never worked on",
    what: "Some requirements have no recorded work at all.",
    why: "They may be forgotten, or done without a record.",
    todo: "Fix now opens a new task, pre-filled with this item, meant to record work already done, or schedule it.",
  },
  "D/D2": {
    title: "Requirement changed without follow-up",
    what: "A requirement was changed after the last recorded work on it.",
    why: "The existing work may no longer match the new wording.",
    todo: "Fix now opens a new task, pre-filled with this item, meant to check whether the work still matches and confirm it.",
  },
  "D/D3": {
    title: "Promised requirements not delivered",
    what: "Requirements planned for this release are not delivered yet.",
    why: "The release would ship without them.",
    todo: "Fix now opens a new task, pre-filled with this item, meant to deliver them or move them to a later release.",
  },
  "D/D4": {
    title: "Last work on a requirement had failing tests",
    what: "The latest recorded work for a requirement ended with failing tests.",
    why: "The requirement cannot be counted as working.",
    todo: "Fix now opens a new task, pre-filled with this item, meant to fix the tests and record a new passing run.",
  },
  "D/D5": {
    title: "Change not linked to a requirement",
    what: "A feature or change is not linked to any requirement.",
    why: "Changes without a requirement cannot be traced back to a purpose.",
    todo: "Fix now opens a new task, pre-filled with this item, meant to link it to a requirement, or note that it needs none.",
  },
  "E/E1": {
    title: "Traceability report out of date",
    what: "The report linking each requirement to its plan, code and tests is out of date.",
    why: STALE_WHY,
    todo: STALE_TODO,
  },
  "E/E2": {
    title: "Test evidence report out of date",
    what: "The report showing which tests ran and passed is out of date.",
    why: STALE_WHY,
    todo: STALE_TODO,
  },
  "E/E3": {
    title: "Change history out of date",
    what: "The report listing every change and why it was made is out of date.",
    why: STALE_WHY,
    todo: STALE_TODO,
  },
  "E/E4": {
    title: "Component list (SBOM) out of date",
    what: "The list of all third-party components the software contains is out of date.",
    why: STALE_WHY,
    todo: STALE_TODO,
  },
  "E/E5": {
    title: "Compliance dashboard out of date",
    what: "The summary page of all compliance results is out of date.",
    why: STALE_WHY,
    todo: STALE_TODO,
  },
  "F/F4": {
    title: "Oversized decision records",
    what: "Some entries in the decision log (the record of why the project is built this way) are very long and point to no detailed document.",
    why: "Long entries make the log hard to read.",
    todo: "Fix now opens a new task, pre-filled with this item, meant to move each long entry into its own document and link it.",
  },
  "F/F5": {
    title: "Architecture document not set up for updates",
    what: "The architecture document lacks the starting point that automatic updates need.",
    why: "Without it, new architecture notes are not copied into the document.",
    todo: "Fix now opens a new task, pre-filled with this item, meant to set that starting point once.",
  },
  "F/F6": {
    title: "Project instructions too long",
    what: "The file that instructs the AI assistant about this project grew past its size cap.",
    why: "Very long instructions are followed less reliably.",
    todo: "Fix now opens a new task, pre-filled with this item, meant to move the detail into separate files and shorten it.",
  },
  "G/G2": {
    title: "Change labelled with an unknown area",
    what: "A saved change is tagged with a project area (for example 'standalone') that does not exist.",
    why: "Changes in unknown areas are hard to find and report on.",
    todo: "Fix now opens a new task, pre-filled with this item, meant to correct the tag, or register the name as another name for an existing area.",
  },
  "H/H1": {
    title: "File too large",
    what: "A source file grew past the size limit and is not on the list of allowed exceptions.",
    why: "Very large files are harder to change safely.",
    todo: "Fix now opens a new task, pre-filled with this item, meant to split the file into smaller ones.",
  },
  "H/H2": {
    title: "Size limit can be tightened",
    what: "A file is now smaller than its allowed limit, so the limit can be lowered.",
    why: "Lowering it stops the file from growing back.",
    todo: "Fix now opens a new task, pre-filled with this item, meant to lower the limit for that file.",
  },
  "H/H6": {
    title: "Outdated size-limit entry",
    what: "The list of allowed file sizes has an entry that no longer matches a file.",
    why: "An entry for a file that no longer exists or was renamed checks nothing.",
    todo: "Fix now opens a new task, pre-filled with this item, meant to correct or remove the entry.",
  },
  "I/I5": {
    title: "Audit housekeeping",
    what: "The audit found a small tidy-up item; the line names it.",
    why: "Left alone, these pile up and hide real problems.",
    todo: "Fix now opens a new task, pre-filled with this item, meant to tidy it up.",
  },
  C1: {
    title: "Phase completion record missing",
    what: "A phase finished without recording that it ended.",
    why: "The phase shows as done, but the quality check found no completion record.",
    todo: "Fix now opens a new task, pre-filled with this item, meant to write the record, using the command shown in the item's details.",
  },
  C5: {
    title: "Changelog entry missing",
    what: "The changelog has no 'Added' entry for this phase.",
    why: "The phase shows as done, but the quality check found no changelog entry.",
    todo: "Fix now opens a new task, pre-filled with this item, meant to add the changelog entry.",
  },
  W3: {
    title: "Work summary missing",
    what: "A phase finished without recording what was done (files changed, tests run).",
    why: "The phase shows as done, but the quality check found that summary missing.",
    todo: "Fix now opens a new task, pre-filled with this item, meant to write the summary, using the command shown in the item's details.",
  },
};
