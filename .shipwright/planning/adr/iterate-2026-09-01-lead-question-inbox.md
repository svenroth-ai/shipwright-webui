# Lead-question inbox kind

## Context

leadwright (sibling repo) needed a way for its "lead" agent to ask the PO a
follow-up question that shows up in webui's Inbox, gets an answer, and feeds
that answer back into leadwright's own context (FR-04.15–FR-04.40 in
leadwright's spec; leadwright #32/L7 already landed the writer side).
webui's Inbox today has three kinds — `ask_tool`, `text_question`,
`terminal_prompt` — all DERIVED from a JSONL/terminal read and all carrying
a mandatory `bestEffort: true`. A lead question is neither: it is WRITTEN
by another process straight into the task's `description` field, and once
surfaced it is a fact, not an inference.

## Decision

Add a fourth kind, `lead_question`, detected by a `<!-- lead-question:TYPE
-->` marker at the top of `description` (`server/src/external/inbox/_lead.ts`,
a verbatim independent mirror of leadwright's own marker regex per DO-NOT
#7 — no cross-package import). No `bestEffort` field: split
`InboxItemCommon`'s `bestEffort: true` off a new `InboxItemBase` the other
three still extend, so their contract is unchanged (proved by a
compile-time type test). Dismiss reuses the existing
`dismissedToolUseIds: string[]` field via a synthetic `lq-<taskId>` id — no
schema change. Answering PATCHes `poFeedback` with the PO's text plus a
generic `<!-- answered-at:<ISO> -->` marker (`client/src/lib/leadQuestionApi.ts`)
— deliberately NOT leadwright's per-question-type answer encoding, which
stays leadwright's own concern (FR-04.18). `InboxCard.LeadQuestion.tsx`
renders an inline answer `<textarea>` + Send/Dismiss; this is a documented,
narrow exception to the Inbox Fence (`inbox-no-writepath.test.ts`) — a
lead_question is not a live Claude turn, so there is no pty to protect, and
the PATCH goes over the same REST surface the Edit Task dialog already
uses. `InboxCard.tsx`'s `inboxItemKey()`/`InboxCard()` dispatchers gained a
`never`-typed `unhandledInboxItemKind()` exhaustiveness guard so a future
fifth kind left unhandled is a compile error, not a silent wrong-card
render or an `undefined` React key.

Suppression (both "already answered" and "already dismissed") is
per-TASK, not per-question — there is no per-question id to key a
narrower suppression on, and inventing one was explicitly out of scope
(that would be leadwright's FR-04.18 concern, not webui's). This is
documented as a by-design contract in `_lead.ts`'s header: if leadwright
ever needs to re-ask on the same task while an old answer is still
present, it must clear `poFeedback` first.

## Consequences

webui can now surface and answer a leadwright follow-up without any new
schema — reuses `dismissedToolUseIds` and `poFeedback` — and the three
existing kinds are provably unaffected. The `InboxItemBase`/`InboxItemCommon`
type split was extracted into a new `client/src/lib/inboxItemTypes.ts` file
(re-exported from `externalApi.ts` for back-compat) to keep the grandfathered
bloat-ceiling file from growing. Trade-off: a task can surface only one
"round" of lead_question at a time — a second follow-up on the same task
before the first is cleared stays invisible until leadwright clears
`poFeedback`. Reading answers back into leadwright's own context (L8) and
per-question-type answer decoding (FR-04.18) are explicitly out of scope
here.

## Rationale

Reusing existing fields (`dismissedToolUseIds`, `poFeedback`) instead of
adding new schema keeps this webui-side change additive and small, matching
the "small" complexity classification. A compile-time exhaustiveness guard
(rather than a runtime `console.warn` or silent fallthrough) was chosen
because the existing three-kind dispatcher already had two documented traps
(a silently-`undefined` React key, a silent wrong-card render) that a type
system can close for free.

## Rejected alternatives

1. A hash-based per-question dismiss/answer key (to allow re-asking on the
   same task without clearing `poFeedback` first) — rejected as inventing
   an answer schema, which is explicitly leadwright's FR-04.18 concern, not
   this card's; documented as a known, accepted trade-off instead.
2. Keeping `bestEffort: true` on `lead_question` for interface uniformity —
   rejected because a written fact is categorically different from a
   best-effort derived inference, and the acceptance criteria required its
   absence to be provable at the type level, not just by convention.
3. A full Playwright E2E spec for this pass — deferred as disproportionate
   to a "small"-complexity, additive change already covered by real
   component-level RTL tests (real DOM, real click/keyboard, real
   mocked-network fetch calls) and real server route-level HTTP tests.
