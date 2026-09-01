# Mini-Plan: Org-page conversation thread (FR-04.42, V4c)

- **run_id:** iterate-2026-09-01-org-thread-view
- **Complexity:** small (FEATURE)
- **Source:** FR-04.42 / §10.6 in leadwright's `spec/lead-model-spec.md` and
  `.shipwright/planning/01-adopted/spec.md` (leadwright repo) — PO decided
  option (b) 2026-08-16: the thread lives in leadwright's own store, never
  in the card's `description` field, and the Org page (V4a's scaffold) is
  the only surface that reads it back.

## 1. Files to create/modify

- `client/src/components/org/OrgThread.tsx` (new) — `ThreadRound` /
  `OrgThreadCard` types + `OrgThread` (one card's rounds) + `OrgThreadList`
  (every follow-up card for one lead) presentational components.
- `client/src/components/org/OrgThread.test.tsx` (new) — fixture-driven
  acceptance tests (AC-a/b/c/d).
- `client/src/hooks/useOrgThreads.ts` (new) — stub seam returning `{}`;
  leadwright's round-store producer (L8, FR-04.17-FR-04.19) does not exist
  yet, so this is honestly empty, not a fake data source.
- `client/src/pages/OrgPage.tsx` (edit) — mount `<OrgThreadList>` under each
  lead's `<LeadCard>` in the existing lead-list loop.
- `client/src/pages/OrgPage.thread.test.tsx` (new) — proves the component is
  actually wired into the page (mounted state + empty-by-default state).
- `client/src/styles/org.css` (edit) — `.thread*` rules, styled to match the
  existing `.rolebox`/`.nowline` blocks (not part of the original mockup,
  which predates this FR).

## 3. Component hierarchy

```
OrgPage
 └ OrgPageContent
    └ .leadlist (existing)
       └ [per lead] <div>
          ├ LeadCard          (existing, untouched — its 5-block-order
          │                    test stays exact; the thread is a sibling,
          │                    not a 6th block, to avoid touching that ratchet)
          └ OrgThreadList     (new; cards={threads[lead.leadId]})
             └ OrgThread × N  (one per follow-up card with rounds)
                └ round <li>  (question, then answer-or-open, in array order)
```

## 4. Data model changes

None. No server route, no `LeadRosterEntry` field, no `server/src/types/`
change — the round store is entirely leadwright-owned and unbuilt (L8).
`useOrgThreads()` is a client-only stub; wiring a real fetch is future work
once that producer ships.

## 5. Test strategy

- Unit/component tests only (Vitest + Testing Library), against fixtures —
  no E2E, since there is no real backend surface to drive yet.
- `OrgThread.test.tsx`: order with 3 rounds (out-of-chronological-order
  timestamps, to prove array order is trusted, not re-sorted), an
  unanswered round renders "open" (and an empty-string answer counts as
  unanswered too), untrusted markup+sentinel text renders as an inert text
  node (no real `<img>`/`<b>`, no `window.Notification` call), and every
  "no thread" shape (`undefined`, `[]`, a card with `rounds: []`) renders
  nothing.
- `OrgPage.thread.test.tsx`: mocks `useOrgThreads` to prove the thread
  actually mounts below its lead's card in DOM order, and that the
  page's real (unmocked, in `OrgPage.test.tsx`) default of `{}` keeps
  rendering cleanly — AC-d's production truth today.
