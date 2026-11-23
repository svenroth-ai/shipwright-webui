# Campaign brief: reviewing lead proposals (`shadow-proposals-webui`, repo `shipwright-webui`)

Date: 2026-11-23 · Status: rev 1, drafted for operator approval, nothing built · Branch strategy: `serial`. Units: W1, W2, W3, W4 (dependencies in section 3). Counterpart: the leadwright campaign `shadow-slice-1` (its unit S1-E carries the entry-header change in section 2). The operator starts the campaign; it does not start autonomously from chat.

## 0. Goal
When a lead in shadow mode proposes something, the operator can read the evidence, change the wording, approve or reject it, and every decision is recorded with who made it. Nothing the lead quoted from a chat is copied into the learnings.

## 1. What exists today (verified 2026-11-23 against the code)
- The proposals window already lists entries and offers one action, Countersign (`client/src/components/org/DecisionEntryRow.tsx`, `OrgDecisionsProposedModal.tsx`). The body is rendered as sanitised Markdown; the evidence line is shown as plain text.
- Countersign moves the whole entry block from the proposed file to the decisions log under an ADR number, atomically and under a lock (`server/src/external/org/countersign-core.ts`). It records no author and has no reject path. `audit.jsonl` is read-only in the WebUI.
- **The two repositories disagree on the entry header.** The WebUI parses `## [<timestamp>] <leadId>` (`server/src/external/org/decisions-lock.ts`). The leadwright daemon writes `## Proposed <timestamp> — <decisionKey>` (`lib/decisions-proposed.ts`). As things stand no real daemon proposal is listed or can be countersigned.
- Reject, edit, quote-and-pointer display and an audit record of decisions do not exist.

## 2. Operator decisions (2026-11-23)
1. Leadwright writes the header the WebUI already reads (`## [<timestamp>] <leadId>`); the WebUI first accepts both forms so nothing breaks during rollout.
2. No new entry kind for now. In the shadow stage every proposal is a learning line; charter changes keep their own existing route.
3. Reject is recorded as an audit entry with the author. Parking an entry is out of scope.
4. When the operator edits a proposal, only the edited line goes to the learnings. The audit entry records "edited" and a pointer to the original observation, never the original text.
5. Quotes are shown to the operator in the window but are never written to the learnings or copied into the decisions log. There is no black-out feature: the operator rewrites the line instead.
6. No separate mockup stop: the operator has approved the mockups; the only change is that "black out" became "edit".

## 3. Units

Shared rules: keep each file under the 300-line limit (the modal and row are close, split before adding); reuse the existing lock and atomic-write helpers; the WebUI never writes the leadwright files except through the countersign routes below; tests use real files.

**W1: one entry format in both repos. Medium. No dependency.**
The WebUI accepts both header forms and treats an entry's identity as before (timestamp and lead). A real sample of what the daemon writes is pinned as a test fixture in both repositories.
- Given an entry with the WebUI header, When the window loads, Then it is listed as today.
- Given an entry with the daemon header, When the window loads, Then it is listed with the same fields.
- Given either entry, When countersigned, Then it moves to the log exactly once and cannot be countersigned twice.
- Done when the three cases pass and the pinned sample is documented as a cross-repo contract.

**W2: structured entry view. Medium. `depends_on: W1`.**
Each entry shows the proposed line, the lead, the beat, the evidence pointer (session, time, message number) and each quote as its own element, with an "Open source session" link only where a target exists.
- Given an entry with two quotes, When the window loads, Then each quote is shown separately with its pointer.
- Given an entry whose pointer is malformed, Then it is shown as "unknown source", never hidden.
- Done when the row stays under the line limit and screen-reader and keyboard checks pass.

**W3: reject, with a record. Medium. `depends_on: W1`.**
A reject route removes the entry from the proposed file and writes an audit entry naming the author, the lead, the decision key and the reason. Countersign also writes an audit entry with the author. An existing countersign must not change behaviour for old entries.
- Given a proposed entry, When the operator rejects it, Then it disappears from the window and one audit entry exists with author and decision key.
- Given a rejected entry, When the same key is proposed again later, Then the new entry is shown as a repeat of a rejected proposal.
- Done when both audit entries appear in the audit view and the reject is idempotent under a double click.

**W4: edit before approving. Medium. `depends_on: W2, W3`.**
The operator edits the proposed line in the window; countersign takes the edited line. The original text is not stored in the log; the audit entry says "edited" and points to the observation. Quotes are not carried into the log.
- Given an edited line, When countersigned, Then the log holds the edited line and no quote.
- Given an unedited line, When countersigned, Then the audit entry says "approved as proposed".
- Done when a test proves no quote text from the entry appears in the log or the audit entry.

## 4. Not in this campaign
Parking proposals, a black-out feature, the daily report, the stage controls on the Org page, the lead chat session, the question inbox bundle. These follow once the proposal flow works.

## 5. Merge and review
Normal iterate process per unit: architecture review before build for medium, then spec-reviewer, code-reviewer and doubt-reviewer, each spawned with `model=opus` passed explicitly. Merge on green CI; no admin merge. The bloat pre-commit hook is installed in every worktree before the first commit. Rollout order across repositories: W1 (WebUI tolerant of both forms) lands first, then the leadwright header change, then W2 to W4.

## 6. Risks
- The two repositories write the same file under different locks; the WebUI must only change it through the countersign routes.
- Quotes could leak into the decisions log because countersign moves the whole entry block; W4 has to prove they do not, not assume it.
- Old entries in the proposed file must keep working after W1.
- The modal and row are near the line limit; adding views without splitting will trip the bloat gate.
- Not yet checked: how the WebUI parses the org chart that leadwright writes, whether any other WebUI code writes `audit.jsonl`, and whether "Open source session" has a target.
