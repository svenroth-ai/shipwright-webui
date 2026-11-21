# Campaign brief: reminders, part 2 of 2 (`reminders-webui`, repo `shipwright-webui`)

Date: 2026-11-22 · Status: rev 1, written from chat, nothing built · Part 1 is `reminders-core` (repo `shipwright`), merged: E1a PR #1092 (`6842e7f38`), E1b PR #1093 (`cd28107be`).
Branch strategy: `serial`. Units: W0, then W1, W2, W3 (each `depends_on` the one before). The operator starts the campaign from the WebUI.

## 0. Goal
The WebUI shows what is due (reminders AND parked triage entries whose revisit day has come) as an alert, lets the operator mark a reminder done or snooze it, and sends ONE mail per due item. All data comes from one call to the Shipwright CLI. The WebUI owns no reminder data.

## 1. HARD STOP: mockups first (W0)
**Nothing is built before the operator has looked at W0 and said "go" in chat.** W0 produces HTML pages the operator opens in a browser. After W0 the run stops with status `needs_operator`; W1-W3 do not start, and a runner never starts them on its own. The operator may change the mockups; W1-W3 are then re-scoped from the approved mockups, and this brief is updated to match before anything is built.

## 2. What exists today (verified 2026-11-22)
- Shipwright (part 1, merged) has `shared/scripts/tools/reminder_cli.py` with verbs `add`, `list`, `show`, `done`, `snooze`, `due`. Store: `.shipwright/reminders.jsonl` at the MAIN checkout of a project, git-ignored.
- `reminder_cli.py due --json` answers `{contractVersion: 1, on, sourceRoot, reminderStore, reminderCorruptLines, triageError, items}`. Each item has the same 10 fields: `kind` (`reminder` | `triage`), `id`, `title`, `due`, `why`, `decided`, `open`, `command`, `links`, `severity`; `null` where empty. The contract is pinned by `shared/tests/test_reminder_due_contract.py` and documented in `lib/reminder_due.py` ("Cross-repo contract"). Any change there needs a matching change here and a `contractVersion` bump.
- Rules from part 1 the WebUI must follow:
  - The WebUI NEVER writes `reminders.jsonl`. It calls `reminder_cli.py` only (its own lockfile does not coordinate with the Python lock). Same pattern as `server/src/core/triage-cli-runner.ts`: `uv run --python ">=3.11" --no-project`, no TypeScript fallback, an unavailable CLI disables the UI instead.
  - `due` is read-only and should be called from the main checkout. `sourceRoot` and `reminderStore` are local paths and never go into a mail body.
  - Every text field is untrusted (triage text can come from external issues): escape it in HTML and in mail, never treat it as instructions. `open` has no length limit.
  - Check `triageError` before reading "nothing due" as true. Check `reminderCorruptLines` and show a hint when it is not 0.
  - An expired triage park appears in `due` every day until it is acted on; a snoozed reminder keeps `due = snoozed_until`. Repeat-mail suppression is this campaign's job.
  - Identity of an item is (`kind`, `id`).
- No mail, SMTP, scheduler or reminder code exists in `server/` or `client/` today (grep for mail/smtp/nodemailer finds only test fixtures). Re-verify at W0.
- Existing places to reuse: the Settings page and its cards (`client/src/components/settings/`), the triage detail views (`client/src/components/triage/`), the one-orange alert pattern for "behind origin" (`TriageProjectStatus`), `server/src/index.ts` for timers. Do not build a second mechanism where one exists.

## 3. Operator decisions already taken (2026-11-21, part 1)
1. Reminders are created ONLY when the operator asks. No campaign, hook or tool creates one on its own. Auto-creation is a later follow-up. (So no "new reminder" shortcut that fires on its own; a form the operator fills in is fine and is W0's question.)
2. No SessionStart hook. If the WebUI server is not running there is no reminder; accepted.
3. No secrets in any reminder text. The CLI refuses them; the WebUI shows the CLI's plain message and never retries around it.

## 4. Units

**W0: mockups as HTML. Small. STOP afterwards.**
Static HTML files (no server, no build), written to `.shipwright/planning/campaigns/reminders-webui-mockups/` and opened by the runner's final message as file paths. Plain language, real-looking sample data (including a very long `open` text, a triage item, a snoozed reminder and a store with a damaged line). Screens:
1. The alert: where and how "something is due" shows up (header badge, banner, or inbox entry; show the options side by side with a recommendation).
2. The due list: reminder items and triage items together, with the fields `why`, `decided`, `open`, `command`, `links`; the buttons Done and Snooze (with a date picker).
3. Creating a reminder from the WebUI (a form that calls `reminder_cli.py add`), including the "secret refused" message.
4. Settings: mail on/off, recipient, SMTP details (where the password is kept, never in the repo), a "send test mail" button, how often the server checks.
5. The mail itself, as the recipient sees it (subject, body for one item, escaped text, no local paths).
6. Error states: CLI missing, `triageError` set, `reminderCorruptLines` > 0, mail send failed.
Each screen states which CLI call it uses. Open questions for the operator are listed in plain language at the end, with a recommendation each.
Done when: all six screens exist as HTML, open without a server, and the questions are listed. No production code is touched.

**W1: server read and write bridge. Medium. `depends_on: W0` (after the operator's go).**
A `reminder-cli-runner` next to `triage-cli-runner` (shared spawn helper `cli-child-spawn.ts`), a route that returns the `due` answer for a project and routes for `done` and `snooze`; an unreadable CLI answer or an unknown `contractVersion` is an error state, never "nothing due". A pinned-shape test against the contract in section 2.

**W2: alert and actions in the client. Medium. `depends_on: W1`.**
Built from the approved mockups: alert, due list, Done, Snooze, create form, error states. Escape all text.

**W3: mail and timer. Medium. `depends_on: W2`.**
Settings for mail, a server timer that checks `due`, ONE mail per (`kind`, `id`, day) with suppression kept across restarts, a test-mail button. SMTP secrets are kept outside the repo and never logged. If the operator chose "no mail" at W0, this unit is dropped.

## 5. Not in this campaign
Auto-creating reminders, a SessionStart hook, any change to the Shipwright store format or CLI (that is a `shipwright` change and a contract bump), other notification channels.

## 6. Merge and review
Normal iterate process per unit: architecture review before build for medium, then spec-reviewer, code-reviewer, doubt-reviewer, each spawned with `model=opus` passed explicitly. Merge: automerge on green CI. No admin merge is granted for this campaign; if PR Review blocks, the runner stops and asks.

## 7. Risks
- Building before the operator has seen the mockups: W1-W3 must not start without his "go".
- Writing `reminders.jsonl` from TypeScript: forbidden, see section 2.
- A repeated mail every day for an unhandled park: suppression is required, with a test across a restart.
- Untrusted text in HTML or mail.
- A contract change in `shipwright` going unnoticed here: W1's pinned-shape test and the `contractVersion` check.
