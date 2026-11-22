# Mini-plan: W4 Mail and timer with repeat suppression

Run: iterate-2026-11-22-w4-mail-timer. Complexity: medium.

## Goal
Mockup pages 04 (Settings card), 05 (the mail), 06d (failed-send banner), decisions of page 07: mail off by default, format per item / daily summary / both, summary time, send-when-empty, WebUI address for links, SMTP in `.env.local` of the central user folder, check interval (15 min / hourly / daily) plus one check at start, repeat suppression across restarts, failure shown, at most 3 tries per item and day.

## Design
1. `core/reminder-mail/` (new, all < 300 lines): `json-store` (proper-lockfile RMW + atomic rename), `settings` (JSON settings + `.env.local` password, refuses a git-repo folder, write-only), `ledger` (keys reminder|id|day, triage|id|once, summary||day; tries per day), `compose` (escape, 1000-char cut, path redaction, http(s)-only links, command as inert text), `transport` (nodemailer, exact-pinned, injectable; password scrubbed from errors), `service` (collect due across projects via the W1 bridge, dedupe shared stores, send, ledger, status), `timer` (1-minute tick deciding "due", injectable clock, start check).
2. `routes/reminder-mail.ts` (GET/PUT settings, POST test; JSON content-type, cross-site refused, test rate limit) and `routes/reminder-mail-wiring.ts` (index.ts gets 2 lines; it is at its bloat baseline).
3. Client: `lib/reminderMailApi`, `hooks/useReminderMail`, `ReminderMailCard` + `ReminderMailFields` (Settings), `MailFailedBanner` (Inbox).
4. ADR notes the new dependency (nodemailer 10.6.1, exact pin) and `@types/nodemailer` (dev).

## Tests
Compose (hostile text, paths, links, subject injection), service (off = no CLI call, once per day, triage once ever, across restart, 3 tries per day, summary rules, never "nothing due" when degraded, shared store, secret never in logs/status/ledger/errors), settings/secret (not in JSON, refuses repo), timer with fake clock, routes (password never returned, rate limit, cross-site), client card + banner. Real-browser run of the Settings card and Inbox banner.

## Risks
A new dependency enters the build graph; STARTTLS is required on non-loopback relays (exact failure shown otherwise); the timer ticks every minute even with mail off (cheap file read only).
