# Campaign brief: reminders, part 2 of 2 (`reminders-webui`, repo `shipwright-webui`)

Date: 2026-11-22 · Status: rev 2 (operator GO 2026-11-22; mockups approved; W1-W4 re-scoped below), nothing built yet · Part 1 is `reminders-core` (repo `shipwright`), merged: E1a PR #1092 (`6842e7f38`), E1b PR #1093 (`cd28107be`).
Branch strategy: `serial`. Units: W0 (done, mockups merged), then W1, W2, W3, W4 (each `depends_on` the one before). The operator starts the campaign from the WebUI.

## 0. Goal
The WebUI shows what is due (reminders AND parked triage entries whose revisit day has come) as an alert, lets the operator mark a reminder done or snooze it, and sends ONE mail per due item. All data comes from one call to the Shipwright CLI. The WebUI owns no reminder data.

## 1. Mockups: approved (operator GO 2026-11-22)
W0 is done and approved. The approved mockups (`.shipwright/planning/campaigns/reminders-webui-mockups/`, open `index.html`) are the SPEC for the UI: W2-W4 build exactly those screens in the real app look (Weather-Deck tokens, sidebar, title bar, Triage-style rows, light dialog sheet). Where this brief and the mockups differ, the mockups win; page 07 lists the decisions. Any later change to the look is shown as a changed mockup first.

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

## 4. Units (rev 2, after the approved mockups)

Operator decisions taken at W0 (all in mockup page 07): reminders live in the **Inbox** (no banner, no bell, no separate page; the alert is the Inbox count in the sidebar plus mail); the **whole Inbox gets the Triage look** (filter bar, one card per project with a coloured top edge, compact rows, hover actions, details in the light dialog sheet), for reminders AND the existing "awaiting reply" entries; colours: reminder = green, awaiting reply = orange, parked triage = grey; reminders have a DAY only (no time); mail is off by default, format (per item / daily summary / both), summary time and "send when nothing due" are Settings; password in `.env.local` in the central WebUI user folder; WebUI address setting drives the mail links; parked triage items mail once at expiry; all registered projects; hourly check plus once at start; snooze = date picker + Tomorrow / Next week; "Start task" works like Fix now in Triage.

**W1: server read and write bridge. Medium.** A `reminder-cli-runner` next to `triage-cli-runner` (shared spawn helper `cli-child-spawn.ts`), routes that return the `due` answer per project (and across all registered projects) and routes for `done`, `snooze` and `add` (title, due, why required; decided, open, command, link optional). An unreadable CLI answer, an unknown `contractVersion`, `triageError` and `reminderCorruptLines` are surfaced as states, never as "nothing due". The CLI's plain refusal message for a secret is passed through unchanged. Pinned-shape test against the contract in section 2. Check what stored `command` strings look like (a resume command would need a decision).

**W2: Inbox in the Triage look (existing entries only, no reminders yet). Medium.** Restyle the existing Inbox page to the approved look: filter bar, project cards, compact rows, hover action (Answer in the terminal, which goes into the task's session terminal), click opens a detail dialog with the full text. No behaviour change for awaiting-reply entries. Keep all existing Inbox tests green; update visual baselines on the Linux flow.

**W3: reminders in the Inbox. Medium.** Reminder and parked-triage rows (green / grey chips), hover actions (Start task = like Fix now, Done, Snooze, Open in Triage), the detail dialog, the "+ New reminder" dialog in the New-Task style (Why visible, rest under More options, project picker when the board shows All projects), error states, the Inbox count in the sidebar includes due reminders and expired parks. Escape ALL text. Built from the approved mockups.

**W4: mail and timer. Medium.** Settings card (mail on/off default off, recipient, format, summary time, send-when-nothing-due, WebUI address, SMTP, test mail, check interval), server timer that checks `due` for all registered projects hourly and at start, repeat suppression kept across restarts (one mail per (`kind`, `id`, day); expired parked triage: once only), mail template per the mockup with links built from the WebUI address, SMTP secrets in `.env.local` in the central user folder, never logged. If the operator later says "no mail", this unit is dropped.

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
