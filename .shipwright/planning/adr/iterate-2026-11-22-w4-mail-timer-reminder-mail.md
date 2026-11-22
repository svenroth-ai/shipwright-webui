# Reminder mail: in-process timer, persisted ledger, pinned SMTP library

Run: `iterate-2026-11-22-w4-mail-timer` (campaign `reminders-webui`, unit W4, FR-01.77). Complexity: medium.

## Context
Reminders and expired parked triage items reach the operator through the Inbox count only while a tab is open. The operator decided (mockup page 07) that mail is the second channel: off by default, one mail per item per day, an expired park once only, password in `.env.local` in the central WebUI user folder.

## Decision
A server-side check runs once at start and then on a configurable schedule (15 minutes / hourly / daily). It reads `due` for every registered project through the existing W1 bridge (the WebUI never reads or writes `reminders.jsonl`), mails what is new and records it in a persisted ledger. Code lives in `server/src/core/reminder-mail/` (settings, ledger, compose, transport, service, timer) with two thin route files; `index.ts` keeps its baseline line count.

## Delivery rule (at-most-once, on purpose)
The ledger key is CLAIMED under a `proper-lockfile` lock BEFORE the mail is sent and given back (with a counted try) when the send fails. Two overlapping checks or two server processes therefore cannot both send; a crash between the claim and the SMTP answer loses that one mail (it stays in the Inbox) instead of repeating it after a restart. Keys: `reminder|id|day`, `triage|project|id|once` (never pruned), `summary||day`. "Day" is the server-local calendar day, the same clock as the summary time. A damaged ledger fails CLOSED: nothing is sent and Settings says why.

## New dependency (touches the build / dependency graph)
`nodemailer` 10.6.1 (exact pin) and `@types/nodemailer` 8.0.2 (dev, exact). Writing an SMTP client by hand was rejected: TLS, STARTTLS, auth and encoding would become code this project owns forever. STARTTLS is required on every non-loopback relay (certificate checking stays on); a relay without it fails with the exact error shown in Settings. There is deliberately no "allow plain" override in this unit.

## Secrets
The password is write-only: stored only in `.env.local` (mode 0600; on Windows it inherits the user folder ACL) in the central user folder, never in the JSON settings, a log, the status file, the ledger or any API answer (only "set / not set"). The app refuses to store it inside a git work tree. Failure text is scrubbed of the literal password and its URL-encoded / base64 / AUTH-blob spellings and of credentials inside URLs. A saved password never follows a changed SMTP host or user: the operator types it again.

## Mail text
Plain text first; the HTML part is the same cleaned text, escaped, no scripts or remote images. Every field is cut at 1000 characters, control and bidi characters are removed, local paths (drive, UNC, MSYS, file://, any absolute multi-segment path) become `[path]`, only http(s) `url` links are carried (host shown next to an untrusted label), a stored command is shown as text labelled "not run". Links to the Inbox and Settings are built from the validated WebUI address (origin only).

## Architecture Review
External (glm, openai): both **approve** Option A (timer in the WebUI process + ledger + pinned library); a hand-rolled SMTP client and a separate OS job are the larger options. glm asks for a heartbeat so silent failure is noticeable: the "send summary even when nothing is due" option covers it. Internal architecture reviewer: **approve**; its medium findings (two server processes, send/record order, ledger keys, test-mail hardening, header and link hardening) are all addressed above.

## External-Plan-Review-Findings
| Finding | Disposition |
|---|---|
| Timezone / day boundary undefined | accepted-and-fixed: server-local day, pinned by a midnight test |
| Daily interval vs summary time | accepted-and-fixed: daily mode runs at the summary time; start check before it does not use up the day |
| STARTTLS required on non-loopback | accepted: documented above; exact failure is shown |
| Failure lifecycle after the 3rd try | accepted-and-fixed: retried with a fresh counter next day; banner clears on the next fully good check |
| Password omitted on PUT = keep | accepted-and-fixed: tested incl. the PUT answer |
| Check-then-send not atomic | accepted-and-fixed: claim-before-send under the lock, overlap test |
| Summary vs once-only triage | accepted-and-fixed: summary lists only unmailed parks and marks only what it lists |
| Error text may echo secrets | accepted-and-fixed: scrub of all spellings, credentials in URLs, short passwords |

## Internal plan review (opus-plan-reviewer)
Verdict approve with fixes, all applied: daily-timer skip bug, saved password following a new host, corrupt or unwritable ledger fails closed, exclusive create of state files, project-scoped triage keys, link host in HTML, MSYS paths and `file://` redaction. Accepted and recorded: the at-most-once rule above; a corrupt `reminder-mail.json` falls back to defaults (mail off) without a note; a project that stays unreadable produces a daily "could not read everything" summary (never a false "nothing due").

## External-Code-Review-Findings
| Finding | Disposition |
|---|---|
| Triage dedupe ignored the project (high) | accepted-and-fixed, test now expects both mails and a restart |
| Summary marked unlisted parks as mailed (high) | accepted-and-fixed: only the listed ones are marked |
| Short passwords not scrubbed (high) | accepted-and-fixed: the literal is always scrubbed |
| POSIX path redaction used a fixed root list | accepted-and-fixed: any absolute multi-segment path |
| Once-only keys pruned at 5000 | accepted-and-fixed: never pruned |
| Host-change guard skipped when no host was set; password written before settings; crashed check burned the daily slot | accepted-and-fixed |
| Corrupt settings file silently turns mail off | rejected-with-reason: tolerant read is the documented design; the Settings card shows mail off |

## Accepted review notes (orchestrator code review of b73b8aa8, doubt review)
- L2: 25 mails per check is a hard cap per check; in daily mode the first 25 entries win each day while they stay due. The Inbox still shows every item.
- L4: the password write and the settings write are two separately locked writes; a check between them in a millisecond window is accepted (a changed server without a retyped password is refused up front).
- L6: a daily timer makes one try per day in practice, so "3 tries per item and day" is an upper bound; the notice text says "one check a day" in daily mode.
- L7: in "both" a reminder appears in its own mail and in the summary (both channels on purpose); parked triage items are kept out of the summary.
- L8: http(s) link addresses are mailed as given; the link host is shown next to the label.
- At-most-once delivery stays (see above); a failed release of a claim is now retried once and, if it still fails, shown in the status.

## Confidence Calibration
Boundaries probed: SMTP (real nodemailer against a loopback server, in vitest and in a real browser), `.env.local` (quote / backslash round trip, git-repo refusal), ledger and settings files (missing, empty, damaged, concurrent), the `due` answer to mail (hostile text, long text, paths, links). Not probed: a real third-party SMTP relay with STARTTLS and a certificate (no relay available here), DST transitions on a real machine (day keys are local-calendar based and pinned across midnight only).
