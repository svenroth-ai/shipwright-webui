# Architecture Brief: accept the daemon's proposal header in the WebUI

## The problem
The leadwright daemon writes proposals to decisions-proposed.md as `## Proposed <ts> — <decisionKey>` preceded by a hidden dedup marker comment, with the lead id only in a `- **Lead:**` bullet. The WebUI only recognises `## [<ts>] <leadId>`, so no real daemon proposal is listed or can be countersigned.

## What would newly, permanently exist
Nothing standing. This changes parsing machinery that already exists (server `decisions-lock.ts` parse/toLoggedBlock, client `orgDecisionsApi.ts` mirror): one extra tolerated header form, a pinned fixture and a contract doc.

## Options on the table
- **A:** WebUI parser accepts both header forms; identity stays (timestamp, leadId).
- **B:** Change only the daemon to write the WebUI header; WebUI untouched.
- **C:** Do nothing.
