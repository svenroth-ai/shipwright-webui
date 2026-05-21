# Mini-plan: triage-fix-now-and-phase-slash

## Files to touch

### Server
- `server/src/core/actions-substitute.ts`
  Change `buildSlashCommand(actionId, phase)`:
  ```ts
  const NAMESPACED_PHASES = new Set(["plan", "test", "security"]);
  function buildSlashCommand(actionId: string, phase: string): string | null {
    if (actionId === "new-task") {
      return NAMESPACED_PHASES.has(phase)
        ? `/shipwright-${phase}:${phase}`
        : `/shipwright-${phase}`;
    }
    if (actionId === "new-iterate") return `/shipwright-iterate`;
    if (actionId === "new-pipeline") return `/shipwright-run:run`;
    return null;
  }
  ```
  Header comment explains the workaround + lists the four flagged
  failure points + the empirical-evidence rationale for not changing the
  others.

- `server/src/core/actions-substitute.test.ts`
  - NEW: add per-phase parametrized cases asserting the 4 namespaced
    outputs.
  - UPDATE: existing `renders /shipwright-run for new-pipeline` at L685
    becomes `renders /shipwright-run:run for new-pipeline` — replace
    `"'/shipwright-run'"` with `"'/shipwright-run:run'"`.
  - UPDATE: autonomous-pipeline composition at L717-724 (`'/shipwright-run
    --autonomous'` becomes `'/shipwright-run:run --autonomous'`).
  - KEEP: every existing `/shipwright-build` and `/shipwright-iterate`
    assertion as-is (regression guards for AC-5 + AC-6).

### Client
- `client/src/components/external/NewIssueModal.tsx`
  Add five optional pre-fill props to `NewIssueModalProps`:
  ```ts
  initialTitle?: string;
  initialDescription?: string;
  initialPhaseId?: string;
  initialPriority?: "P0" | "P1" | "P2" | "P3";
  initialDomain?: string;
  ```
  In the `useEffect(() => { if (!open) return; ... }, [open])` reset:
  - Replace `setTitle("")` → `setTitle(ctx.initialTitle ?? "")`.
  - Replace `setDescription("")` → `setDescription(ctx.initialDescription ?? "")`.
  - Replace `setPhaseId(ctx.firstPhaseId)` → `setPhaseId(ctx.initialPhaseId ?? ctx.firstPhaseId)`.
  - Add `setPhaseOverridden(Boolean(ctx.initialPhaseId))` so the debounced
    title-classifier doesn't overwrite the chosen phase.
  - Replace `setLeadPriority("")` → `setLeadPriority(ctx.initialPriority ?? "")`.
  - Replace `setLeadDomain("")` → `setLeadDomain(ctx.initialDomain ?? "")`.
    (NB: there is no existing `setLeadDomain`; this iterate adds it
    because the existing `useState<string>("")` for `leadDomain` was
    only ever reset implicitly via setting the empty string. After this
    iterate it gets seeded with the triage `suggestedDomain`.)
  - All five values flow through `resetCtxRef` (same ref pattern as the
    existing autonomy / firstPhaseId / initialProjectId fields — read
    through ref so background refetches don't trigger re-resets and so
    a parent re-render between modal open + close doesn't re-arm the
    reset on every render).

  Belt-and-suspenders: the existing `NewIssueModal.test.tsx` 39 tests
  must keep passing without changes — props are optional, defaults
  match current behaviour.

- `client/src/components/triage/TriageDetailModal.tsx`
  - Replace `onFixNow` clipboard-copy with an "open modal" handler.
  - `fixNowEnabled` derived from `item.status === "triage"` only (no
    longer gated on `launchDecision.kind === "render"`).
  - Add `useProjectActions(projectId)` hook call to fetch the catalog.
    Disable Fix-now while it's loading.
  - Heuristic (source-only, validated against Sven's screenshot
    2026-05-21):
    ```ts
    const isSecurity = item.source === "github";
    const actionId = isSecurity ? "new-task" : "new-iterate";
    const action = projectActions?.actions.find(a => a.id === actionId);
    const phaseId = isSecurity ? "security" : undefined;
    ```
    Defensive: when `projectActions` hasn't loaded OR the catalog lacks
    the resolved action id, surface an inline failure and keep
    TriageDetailModal open (don't half-route the user into a broken
    state).
  - Local state for the spawned NewIssueModal:
    ```ts
    const [fixNowModal, setFixNowModal] = useState<{
      open: boolean;
      action: ActionDefinition | null;
      initialTitle: string;
      initialDescription: string;
      initialPhaseId?: string;
      initialPriority?: "P0" | "P1" | "P2" | "P3";
      initialDomain?: string;
    }>({ open: false, action: null, initialTitle: "", initialDescription: "" });
    ```
  - On Fix-now click:
    1. Build initial values:
       - `initialTitle = "Fix for " + item.title`
       - `initialDescription = item.detail`
       - `initialPriority = item.suggestedPriority`
       - `initialDomain = item.suggestedDomain`
       - `initialPhaseId = "security"` only when `item.source === "github"`
    2. Set `fixNowModal` state.
    3. Call `onOpenChange(false)` to close the TriageDetailModal.
    The NewIssueModal mount lives outside `<Dialog.Root>` so it survives
    the parent close; Radix handles overlay z-index cleanly.
  - Title format: `"Fix for " + item.title` (verbatim from user
    request).
  - Drop the `FIX_NOW_CONFIRMATION_MS` timer + the "Copied — paste into
    your Claude session." / "Copy failed" inline messages — both tied
    to the removed clipboard semantics.

### Tests
- `server/src/core/actions-substitute.test.ts` — additions per above
  (already RED→GREEN before this update).
- `client/src/components/triage/TriageDetailModal.test.tsx` —
  REWRITE of the `iterate-2026-05-20` Fix-now CTA describe block
  (8 tests removed, ~6 new added). Existing dialog-shell styling test
  preserved.
  - Test 1 (AC-7): Fix-now button renders for an item with no
    launchPayload (was previously gated off).
  - Test 2 (AC-8): Fix-now click on a `source="github"` item closes the
    TriageDetailModal and renders the NewIssueModal stub with
    `action.id="new-task"`, `initialPhaseId="security"`,
    `initialTitle="Fix for …"`, `initialDescription=item.detail`,
    `initialPriority="P1"`, `initialDomain="engineering"` (matches
    Sven's screenshot — the only github item there has those exact
    values).
  - Test 3 (AC-9): Fix-now click on a `source="iterate"` item opens
    NewIssueModal with `action.id="new-iterate"`, no `initialPhaseId`,
    title + description + priority + domain pre-filled the same way.
  - Test 4 (AC-9 — compliance is iterate, not security — regression
    guard): Fix-now click on a `kind="compliance"` item still routes
    to `new-iterate` (the discriminator is source-only).
  - Test 5 (AC-10): TriageDetailModal `onOpenChange(false)` is invoked
    when Fix-now is clicked.
  - Test 6 (defensive): When the action catalog has not loaded yet,
    Fix-now click surfaces the inline-failure line and does NOT call
    `onOpenChange(false)` (don't strand the user with no open modal).

  Test architecture: mock `useProjectActions` to return a synthetic
  catalog with both `new-task` and `new-iterate` actions, mock the
  `NewIssueModal` component as a `data-testid="new-issue-modal-stub"`
  placeholder that exposes captured props via `data-*` attributes the
  tests can read. Avoids spinning up the full NewIssueModal tree (which
  needs router + ProjectFilter context).

## Test strategy

- RED first: write the new assertions in
  `actions-substitute.test.ts` and the new `TriageDetailModal.test.tsx`
  BEFORE touching production code. Watch them fail loudly.
- GREEN: minimal patch to `buildSlashCommand` + `NewIssueModal` props +
  `TriageDetailModal` rewire.
- Regression: full vitest suite at both halves (server + client) must
  pass. The 1 existing TriageDetailModal test (if any) and all
  NewIssueModal tests must remain green.
- F0.5 surface_verification: drive the real UI flow against an isolated
  Hono build — open a project with triage items, click an item, click
  Fix-now, assert NewIssueModal opens with the right title.

## Alternative approach considered

**Reject A**: introduce a separate `FixNowModal` component wrapping
`NewIssueModal`. **Why rejected:** the user explicitly asked for the
"New Task" / "New Iterate" dialog to open — re-using the existing modal
is the literal user request and keeps the visual rhythm consistent.
Code budget is also smaller.

**Reject B**: emit the namespaced slash form for ALL phases, not just
the four flagged ones. **Why rejected:** the user has been running
`/shipwright-build`, `/shipwright-deploy`, `/shipwright-changelog` etc.
and they work. Broadening the workaround risks breaking flows that
currently work — touch only what the user empirically observed broken.
Adds a one-line code comment listing the four to make extension trivial
if more phases break later.

**Reject C (REVERSED 2026-05-21 after Sven UAT review)**: I originally
proposed `source === "shipwright-security" || kind === "compliance"`
for the security branch. **Why now rejected:** Sven's screenshot of the
live Triage Tab is unambiguous — `source: "github"` is the actual
producer label for security-scan rollups in this repo (no
`shipwright-security` source appears today), and compliance items in
this repo's history have all been refactor / spec-update work, NOT
security findings. Compliance therefore correctly routes to iterate
(see new test 4). The pure source-only rule matches the visible Triage
Tab grouping (one source per section header). If a future producer
ever emits `source: "shipwright-security"` directly, that branch gets
added then — defer until empirically observed.
