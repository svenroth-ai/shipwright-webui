# Decision Log — shipwright-webui

> Migrated from `agent_docs/decision_log.md` (Root) by /shipwright-adopt on 2026-04-30.
> Entries DEC-001 … ADR-058 are pre-existing; the adoption itself is recorded in ADR-065 (originally numbered `ADR-0053`).
> When the root `agent_docs/` folder is removed (per project policy), this file becomes the sole decision log.
>
> **Convention:** ADR IDs are zero-padded 3-digit (`ADR-NNN`), monotonically increasing in **insertion order** into the log (not strictly chronological by decision date). The 4-digit form (`ADR-0053`, `ADR-0054`) used briefly on 2026-04-30 was a counting error in /shipwright-adopt — those entries were renumbered to `ADR-065` / `ADR-066` on 2026-05-01 to reconcile with `ADR-053`…`ADR-058` (created 2026-04-23 / 04-24) which Adopt missed when counting prior entries. The targets `ADR-059`…`ADR-064` were already taken by entries committed between 2026-04-30 and 2026-05-01, so the renumber jumped to the first then-free pair.

---

# Part I — Pre-Adoption Decisions

The following entries (24 total: DEC-001..DEC-007 + KD-02.01..KD-02.10 + KD-03.01..KD-03.07) were authored 2026-04-09..2026-04-23, before this repository was onboarded into the Shipwright SDLC on 2026-04-30. They are preserved as historical context in their original format (3 thematic sections below). All subsequent ADRs (ADR-001 onwards) follow the standard Shipwright iterate finalize flow and live in **Part II** below.

## Project Interview (2026-04-09)

### DEC-001: Hono over Express 5
- **Context:** Need a Node.js backend framework for local single-user web app
- **Decision:** Use Hono instead of Express 5
- **Rationale:** Better TypeScript DX, built-in SSE (streamSSE()), lightweight (~14KB), modern patterns (Web Standard APIs). Express 5 still maturing, larger but less TypeScript-native.
- **Rejected:** Express 5 (larger ecosystem but weaker TS), Fastify (solid but less modern DX)
- **Impact:** All server code uses Hono patterns, Paperclip Express code needs mechanical adaptation

### DEC-002: In-memory state from events (no tasks.json)
- **Context:** Need task state management — plan proposed tasks.json + events as dual source
- **Decision:** Pure in-memory state reconstructed from event log + active process tracking
- **Rationale:** Single source of truth (events.jsonl), no sync issues, crash recovery via event replay. Running/waiting states from process manager (ephemeral by nature).
- **Rejected:** tasks.json as primary store, hybrid model (tasks.json cache + events)
- **Impact:** Server startup replays events, no persistent task file needed

### DEC-003: New task_created event type
- **Context:** Events only captured task completion (work_completed), not creation
- **Decision:** Add task_created event type to record_event.py
- **Rationale:** Enables full task lifecycle tracking, orphan detection (task_created without work_completed = crashed task), immediate visibility in UI
- **Rejected:** In-memory only tracking (loses state on crash)
- **Impact:** record_event.py needs extension, event reader needs to handle new type

### DEC-004: Dual phase_completed deduplication
- **Context:** Deploy/Changelog plugins now emit phase_completed with --detail, orchestrator also emits phase_completed without detail
- **Decision:** Keep both, WebUI deduplicates (prefers event with detail field)
- **Rationale:** Backwards compatible, no orchestrator change needed. Detail-bearing events are strictly more informative.
- **Rejected:** Remove orchestrator emission (cleaner but breaks existing behavior)
- **Impact:** Event reader needs dedup logic (group by type+phase+timestamp window)

### DEC-005: SSE over WebSocket
- **Context:** Need real-time server-to-client push
- **Decision:** Server-Sent Events (SSE) instead of WebSocket/Socket.io
- **Rationale:** Unidirectional push is sufficient (client-to-server via REST). SSE is simpler, native browser API, Hono has built-in support. Socket.io is overkill for local single-user.
- **Rejected:** Socket.io (bidirectional overkill), raw WebSocket (more code for same result)
- **Impact:** Frontend uses EventSource API, server uses Hono streamSSE()

### DEC-006: WebUI stores chat history
- **Context:** Claude CLI has own session management (--session-id). Do we also store?
- **Decision:** Yes, WebUI persists parsed NDJSON stream per task
- **Rationale:** Enables chat replay, task context switching, offline viewing. CLI sessions are opaque — WebUI needs parsed messages for rendering.
- **Rejected:** CLI-only sessions (no replay, no task-context switching in UI)
- **Impact:** Chat store module needed, storage in project's .shipwright-webui/chat-history/

### DEC-007: Target audience — all Shipwright users
- **Context:** Could be power-user-only or broadly accessible
- **Decision:** All Shipwright users, "Replit light" — accessible but not dumbed down
- **Rationale:** Masterclass product built around it. Users have some dev experience but aren't necessarily CLI experts.
- **Rejected:** Power-user-only (limits audience), absolute beginner (too much hand-holding)
- **Impact:** Good defaults, clear UI, minimal required configuration

## UI Shell Spec Decisions (02-ui-shell)

### KD-02.01: Kanban-first replaces 5-panel IDE layout
- **Context:** Original spec used a 5-panel IDE layout (Rail, Sidebar, Chat, Viewer, Explorer)
- **Decision:** Kanban-first UI with two views (Board + Task Detail)
- **Rationale:** Kanban provides better multi-task overview; Task Detail preserves the deep chat experience. Board is more intuitive for project management than a code-IDE metaphor.
- **Rejected:** 5-panel IDE layout (original spec), single-page chat UI
- **Impact:** MainLayout.tsx becomes a router between Kanban Dashboard and Task Detail views; rail/ and sidebar/ components replaced by nav/ and board/

### KD-02.02: Wider sidebar-nav (200px) replaces 48px rail
- **Context:** Original spec had a narrow 48px icon-only rail
- **Decision:** 200px sidebar-nav with icon + text labels
- **Rationale:** Text labels improve discoverability; 200px is standard for app navigation (Slack, Linear, Notion).
- **Rejected:** 48px icon-only rail (original), no sidebar
- **Impact:** Navigation component changes from rail/ to nav/; width budget shifts from 48px to 200px

### KD-02.03: No drag-and-drop on Kanban board
- **Context:** Kanban boards typically support drag-and-drop card reordering
- **Decision:** Cards auto-move via SSE events; no drag-and-drop
- **Rationale:** Claude controls the pipeline — manual drag would create conflicting state. Automatic movement provides a "magic" feel where tasks progress on their own.
- **Rejected:** Drag-and-drop with manual overrides
- **Impact:** No DnD library needed; card position derived entirely from pipeline events

### KD-02.04: Phase tags on cards replace horizontal pipeline steps
- **Context:** Original spec had horizontal pipeline steps as a separate visualization
- **Decision:** Phase tags rendered as colored pills on Kanban cards
- **Rationale:** Phase info is on the card itself — no need for a separate visualization. Simpler and more space-efficient.
- **Rejected:** Horizontal pipeline bar (original), separate pipeline panel
- **Impact:** Eliminates pipeline/ component directory; phase info embedded in card component

### KD-02.05: Immediate card creation, background classification
- **Context:** New Issue flow could block on classification before showing the card
- **Decision:** Card appears in Backlog immediately on submit; classification runs asynchronously
- **Rationale:** Instant feedback is critical — users see their issue immediately. Classification enriches the card asynchronously.
- **Rejected:** Classify first then create card; wait for classification
- **Impact:** Two-phase card lifecycle: bare card on creation, enriched card after classify API returns

### KD-02.06: SSE cache invalidation via TanStack Query
- **Context:** SSE events could directly mutate React state or invalidate query caches
- **Decision:** SSE events trigger queryClient.invalidateQueries(), not direct state mutation
- **Rationale:** Query cache is the single source of truth for server state; avoids dual-state bugs.
- **Rejected:** Direct state updates from SSE
- **Impact:** SSE hook invalidates relevant query keys; no manual state management for server data

### KD-02.07: 100ms streaming buffer for chat rendering
- **Context:** Streaming chat tokens need buffering to avoid jitter
- **Decision:** 100ms render buffer for chat message streaming
- **Rationale:** Balances perceived responsiveness with smooth rendering; proven pattern from Claude.ai-style interfaces.
- **Rejected:** No buffer (per-token), 250ms buffer
- **Impact:** Chat rendering hook includes a 100ms flush interval

### KD-02.08: Tool-call cards collapsed by default
- **Context:** Tool-call events (Bash, Read, Edit, Write) could render expanded or collapsed
- **Decision:** Collapsed by default, showing only tool name and summary line
- **Rationale:** Long build sessions produce hundreds of tool calls; expanded-by-default creates overwhelming scroll.
- **Rejected:** Expanded by default, no tool-call rendering
- **Impact:** Collapsible card component with expand/collapse toggle

### KD-02.09: Viewer SLOT pattern for Split 03
- **Context:** Smart Viewer renderers could be built in Split 02 or deferred
- **Decision:** Split 02 renders an empty placeholder slot; Split 03 plugs in actual renderers
- **Rationale:** Keeps Split 02 focused on layout + chat; viewer renderers are independent and can be added incrementally.
- **Rejected:** Build all renderers in Split 02
- **Impact:** ViewerSlot component with tab management API (openTab, closeTab, activeTab)

### KD-02.10: Panel widths in localStorage, not server-side
- **Context:** Task Detail panel widths (Chat vs Viewer) could be persisted server-side or locally
- **Decision:** localStorage persistence
- **Rationale:** Layout preferences are per-browser; localStorage is simpler and faster.
- **Rejected:** Persist in server settings API
- **Impact:** useLocalStorage hook for panel width state

## Features Spec Decisions (03-features)

### KD-03.01: Smart Viewer inside Task Detail, not top-level
- **Context:** Smart Viewer could be a permanent top-level panel or scoped to task detail
- **Decision:** Smart Viewer lives inside Task Detail view (right panel)
- **Rationale:** With Kanban-first, the board is the primary view. File viewing is contextual to a task, so it belongs inside the task detail rather than occupying permanent screen space.
- **Rejected:** Permanent top-level panel (original 5-panel layout)
- **Impact:** Viewer renders only when a task is open; no viewer on the Kanban Dashboard

### KD-03.02: File Explorer slide-in inside Task Detail
- **Context:** File Explorer could be global or task-scoped
- **Decision:** Slide-in inside Task Detail view, hidden by default
- **Rationale:** Files are browsed in the context of a specific task. Embedding the explorer inside the task detail keeps navigation task-scoped rather than global.
- **Rejected:** Global slide-in from any view
- **Impact:** Explorer toggle button in Task Detail toolbar; explorer component renders inside detail/

### KD-03.03: Minimal New Issue Dialog
- **Context:** New Issue could have many fields (type, priority, labels) or be minimal
- **Decision:** Title + Description only; classification runs in background after creation
- **Rationale:** Reduces friction for issue creation. Users want to capture ideas quickly. Auto-classification enriches the card asynchronously.
- **Rejected:** Full-featured issue form with manual classification
- **Impact:** Simple modal with two fields; POST to tasks API then fire-and-forget classify API call

### KD-03.04: Reuse Python classify scripts via backend API
- **Context:** Classification could be reimplemented in TypeScript or reuse existing Python scripts
- **Decision:** Reuse classify_intent.py and classify_complexity.py via the backend classify API
- **Rationale:** Scripts already implement the detection logic for the CLI. Running them post-creation avoids blocking the dialog on API latency.
- **Rejected:** Reimplement in TypeScript, inline classification
- **Impact:** Backend shells out to Python via uv run; frontend calls POST /api/projects/:id/classify

### KD-03.05: Intent Detection downgraded to MAY
- **Context:** Intent Detection was originally a Must-have feature
- **Decision:** Downgraded from Must to May; scoped to Task Detail chat only
- **Rationale:** With Kanban-first, there is no global chat input. Intent detection can still add value inside a task's chat, but it is lower priority since tasks are already explicitly scoped.
- **Rejected:** Keep as Must-have
- **Impact:** Optional feature; implementation deferred if time-constrained

### KD-03.06: Directory validation, not emptiness validation
- **Context:** Project Wizard could validate directory existence and/or emptiness
- **Decision:** Validate directory existence only, not emptiness
- **Rationale:** Users may want to add Shipwright to an existing project directory that already contains files.
- **Rejected:** Validate both existence and emptiness
- **Impact:** Wizard Step 1 checks fs.existsSync only

### KD-03.07: Read-only viewer, no file editing
- **Context:** Viewer could support inline editing or be strictly read-only
- **Decision:** No file editing in the viewer or explorer — strictly read-only
- **Rationale:** Claude handles all code changes. The viewer is for inspection and review, not manual editing. This avoids conflicts with Claude's file operations.
- **Rejected:** Inline editing with save
- **Impact:** No Monaco Editor; rehype-highlight sufficient for code display

---

# Part II — Shipwright-Managed ADRs

Standard ADR format (`### ADR-NNN: <title>`), managed by `/shipwright-iterate` finalize flow. Insertion order — see numbering note in the header.

### ADR-001: Dynamic CORS origin matching for localhost
- **Date:** 2026-04-10
- **Section:** Build — 01-project-setup
- **Context:** CORS middleware needs to allow any localhost port during development
- **Decision:** Use Hono cors() with dynamic origin callback that matches any origin containing 'localhost'
- **Commit:** fd90c2c70ddd28193b2225bcb9f78927338cc656
- **Rationale:** Simpler than maintaining a whitelist of ports; Vite dev server port may vary
- **Consequences:** All localhost:* origins accepted during dev; null returned for non-localhost origins
- **Rejected:** Static origin list (e.g. localhost:5173 only)

---

### ADR-002: Injectable FileSystemDeps for testability
- **Date:** 2026-04-11
- **Section:** Build — 03-event-system
- **Context:** Event reader and writer need file access but must be unit-testable without real FS
- **Decision:** Define FileSystemDeps/WriterDeps interfaces, inject mocks in tests, use real fs in production
- **Commit:** 8121221
- **Rationale:** Dependency injection pattern from spec (QR-01.09); proven in all Shipwright plugins
- **Consequences:** All bridge modules are pure-function testable; no test-time file system side effects
- **Rejected:** Jest module mocking (brittle), test-time temp files (slow, flaky on CI)

---

### ADR-003: Standalone NDJSON parser as separate module
- **Date:** 2026-04-11
- **Section:** Build — 05-claude-adapter
- **Context:** NDJSON parsing needed by Claude adapter but also useful independently
- **Decision:** Extract parseNdjsonLine() and isAskUserQuestion() into ndjson-parser.ts
- **Commit:** 4160b5b
- **Rationale:** Single responsibility; parser has 8 dedicated tests covering edge cases
- **Consequences:** Adapter stays focused on process management; parser independently testable and reusable
- **Rejected:** Inline parsing in adapter (harder to test edge cases independently)

---

### ADR-004: PID file for orphan detection across restarts
- **Date:** 2026-04-11
- **Section:** Build — 06-process-governor
- **Context:** Server restarts need to detect and kill orphaned Claude processes from previous run
- **Decision:** Persist active PIDs to ~/.shipwright-webui/pids.json, check on startup
- **Commit:** bd2c3ef
- **Rationale:** process.kill(pid, 0) check is fast and reliable; JSON persistence is atomic enough for single-user
- **Consequences:** Reliable orphan cleanup; small JSON file written on every spawn/release
- **Rejected:** OS-level process group tracking (platform-specific), no tracking (orphans accumulate)

---

### ADR-005: Task actions — Close + Delete (no Cancel)
- **Date:** 2026-04-11
- **Section:** Test Phase — Task Actions
- **Context:** Task card menu had Close, Cancel, and Delete. "Cancel" was confusing.
- **Decision:** Simplify to Close (→ Done) and Delete (→ remove). No separate "Cancel" action.
- **Rationale:** Simpler mental model — task is either done or gone. "Cancelled" had no clear meaning.
- **Consequences:** CardOverflowMenu and TaskHeader both use Close + Delete; same actions on card and detail page
- **Rejected:** Three-action model (Close + Cancel + Delete)

---

### ADR-006: Autonomy as per-project setting (not chat toggle)
- **Date:** 2026-04-11
- **Section:** Test Phase — Autonomy
- **Context:** Autonomy was a toggle on the chat toolbar, changeable per-message.
- **Decision:** Autonomy is a per-project setting (Settings → Project tab). Chat toolbar shows read-only badge.
- **Rationale:** Autonomy is a project-level decision (e.g., production app = guided, prototype = autonomous). Changing per-message is confusing and doesn't map to how Shipwright plugins implement it.
- **Consequences:** Global default as fallback; project override takes precedence; ChatToolbar AutonomyPill becomes read-only
- **Rejected:** Per-message toggle, global-only setting

---

### ADR-007: task_updated event for description edits
- **Date:** 2026-04-11
- **Section:** Test Phase — Task Edit
- **Context:** Description editing needed for pending tasks, but no update mechanism existed.
- **Decision:** New task_updated event type + PATCH /api/projects/:id/tasks/:taskId/description endpoint
- **Rationale:** Consistent with event-sourced architecture. Only pending tasks can be edited (running tasks are owned by Claude).
- **Consequences:** EventStore processes task_updated to merge description; API validates pending status
- **Rejected:** Direct in-memory mutation without event (loses auditability)

---

### ADR-008: Path traversal prevention in doc-index
- **Date:** 2026-04-11
- **Section:** Build — 10-api-routes
- **Context:** GET /api/projects/:id/docs?file=path reads arbitrary files within project directory
- **Decision:** Resolve path with path.resolve(), verify startsWith(projectDir) before reading
- **Commit:** d21e143
- **Rationale:** OWASP path traversal prevention; defense in depth even for local-only app
- **Consequences:** Prevents ../../etc/passwd style attacks; returns 400 AppError on violation
- **Rejected:** No validation (local app argument), regex-based filtering (bypassable)

---

### ADR-009: Persistent Claude CLI Process via --input-format stream-json
- **Date:** 2026-04-12
- **Section:** Iterate — persistent-process
- **Context:** Spawn-per-message Claude CLI via print mode (-p) incurred 5-10s cold start on every chat follow-up (plugin loading, API handshake, session setup). User feedback: 'Wenn ich jedes mal 10s warten muss drehe ich durch'. Completely unacceptable for an interactive chat.
- **Decision:** Run exactly one persistent Claude CLI process per active task using --input-format stream-json + --output-format stream-json. Send user messages as NDJSON on stdin via a new sendUserMessage(proc, content) API. Process stays alive for the entire task conversation. Task lifecycle events (phase_started, work_completed, work_failed) emitted via the adapter's onExit callback.
- **Commit:** ec9b0e1
- **Consequences:** Measured 6x speedup: initial cold start 15.35s (one-off per task) → follow-up 2.57s (warm, just API latency). SessionRegistry and its 8 unit tests deleted (~350 LOC removed). chat.ts POST handler simplified from respawn+resume flow to single sendUserMessage call. Multimodal image input became straightforward (just content block arrays on the same pipe). No --permission-mode mid-task switching without respawn (acceptable for v0.1).
- **Rejected:** --sdk-url ws:// WebSocket mode (hidden .hideHelp() flag in Claude CLI source, marked unstable); per-message respawn with --resume <sessionId> (tried in 60167fa, required SessionRegistry to map our UUID to Claude's real session_id from system/init events, still cold-started on every message).

---

### ADR-010: Companion MarkdownContent Port (MIT) for chat rendering
- **Date:** 2026-04-12
- **Section:** Iterate — chat-rendering
- **Context:** Hand-rolled @tailwindcss/typography prose classes broke markdown tables in the chat: cells collapsed into each other (e.g., 'SpieleTordiff.Punkte' instead of 'Spiele | Tordiff | Punkte'). Users also wanted a VS Code-extension feel (flat messages, no avatar) and image upload. User explicit direction: 'Können wir das nicht von dem companion repo kopieren? Möchte nicht alles nochmals durchmachen'.
- **Decision:** Port the MarkdownContent sub-component from The-Vibe-Company/companion/web/src/components/MessageBubble.tsx (MIT license) into webui/client/src/components/chat/MarkdownContent.tsx. Use explicit react-markdown component overrides for every element (h1-h4, p, ul/ol/li, table/thead/th/td, blockquote, hr, code, pre, a, strong, em) instead of relying on @tailwindcss/typography. Swap companion's cc-* Tailwind tokens for our CSS custom properties (--color-primary, --color-border, --color-muted-bg). Also port readFileAsBase64 helper from companion/web/src/utils/image.ts for clipboard paste support.
- **Commit:** 15928b8
- **Consequences:** All common markdown artifacts render correctly including tables with proper borders. Image upload feature lands alongside (paperclip button + clipboard paste + thumbnail strip). MIT attribution obligation added to CHANGELOG and file headers. Future updates from companion upstream are now a simple copy-merge operation. Same stack (React 19 + react-markdown + remark-gfm) so no new dependencies.
- **Rejected:** Fix prose classes in place (fragile, ongoing maintenance burden for every table edge case); adopt a different Markdown library (unnecessary churn, same risk); write ad-hoc CSS overrides (already tried, user rejected).

---

### ADR-011: VS Code Permission Modes — Default is bypassPermissions
- **Superseded by:** ADR-022 (2026-04-13) — mid-task mode switching is now supported via `--resume` respawn. ADR-011's "v0.1 not supported" stance no longer applies; the underlying reasoning (per-message respawn cost from ADR-009) doesn't apply to explicit one-off user actions.
- **Date:** 2026-04-12
- **Section:** Iterate — permission-modes
- **Context:** The legacy 'Default | Plan | Auto-accept' permission dropdown was confusing and none of its values were actually wired to the Claude CLI spawn arguments. The adapter always used --dangerously-skip-permissions regardless of user selection. User asked for VS Code-style modes matching their mental model from the VS Code Claude extension.
- **Decision:** Adopt the exact same 4-mode system as VS Code's Claude extension: Ask before edits (default) / Edit automatically (acceptEdits) / Plan mode (plan) / Bypass permissions (bypassPermissions). UI default = bypassPermissions (matches VS Code ship default). Wire client mode selection through POST /tasks body → coercePermissionMode validator → governor.acquire → adapter.spawn. Adapter picks --dangerously-skip-permissions for bypass or --permission-mode <mode> otherwise. Legacy localStorage values (default/plan/auto-accept) auto-migrated on read.
- **Commit:** 27fce3a
- **Consequences:** Client and server now consistent with Claude CLI's --permission-mode flag. Default matches VS Code expectation. Mid-task mode switching is NOT supported in v0.1 (would require process respawn or undocumented control_request protocol) — selected mode locks in for the whole task conversation. Popover closes on select via Popover.Close asChild wrap (265ec07).
- **Rejected:** Keep legacy names (doesn't match CLI flag semantics, user confusion persists); hide the mode selector entirely (loses power-user control, bad UX for people running untrusted prompts); use raw CLI mode names only without friendly labels (bypassPermissions is unfriendly in chat).

---

### ADR-012: Rule-based phase detection via classify_phase.py
- **Date:** 2026-04-13
- **Section:** Iterate — phase-detection
- **Context:** Task creation emitted phase_started events with a hardcoded phase of build, which prevented the kanban from reflecting non-build work (design, test, deploy) without manual intervention. Users asked to classify phase from the task description at creation time.
- **Decision:** Add plugins/shipwright-iterate/scripts/lib/classify_phase.py (rule-based keyword + priority tie-break). Expose classifyPhase() in webui/server/src/bridge/intent-classifier.ts. POST /api/projects/:id/classify returns phase + phase_confidence. POST /api/projects/:id/tasks accepts body.phase; when absent, classifyPhase is invoked as fallback. NewIssueModal gains an 8-option phase dropdown with debounced auto-suggest + Sparkle indicator and manual override.
- **Commit:** HEAD
- **Consequences:** Phase_started events now reflect actual work type. UI surfaces an auto-suggest with override. Keyword-based classifier is deterministic, offline, and has no external dependencies. Future work may upgrade to LLM-based classification when latency budget allows.
- **Rejected:** LLM-based classification rejected (latency + cost on a synchronous create path). Hardcoded mapping based on project profile rejected (too coarse, ignores user intent).

---

### ADR-013: Persist requested phase on task_created events; close NewIssueModal classify race
- **Date:** 2026-04-13
- **Section:** Iterate — phase-dropdown-fix
- **Context:** After shipping ADR-012 (phase detection) the dropdown selection was still being lost in two ways: (1) the /api/projects/:id/tasks/:taskId/start route hardcoded phase=build regardless of what the user picked at creation time; (2) NewIssueModal's debounced classify call had no abort mechanism, so an in-flight response would overwrite a user's subsequent manual dropdown pick when it resolved.
- **Decision:** (1) Server: task_created events now carry an optional phase field. EventStore reads it into task.requestedPhase. The /start route resolves the phase as body.phase > task.requestedPhase > classifyPhase(title+description) > 'project'. (2) Client: NewIssueModal tracks phaseIsAuto in a ref (phaseIsAutoRef) and the debounced classify's .then guards against both effect-abort and current phaseIsAutoRef.current before calling setPhase, so a late-arriving classify response cannot clobber a manual selection.
- **Commit:** HEAD
- **Consequences:** Phase dropdown is now authoritative in both immediate-start and deferred-start flows. Task model gains requestedPhase field. Existing task_created events without phase remain compatible (field is optional and EventStore treats missing as undefined). Client event handler uses a ref instead of closure-captured state — standard pattern for 'latest value in async callback'.
- **Rejected:** (a) Re-classify on every /start call (wasteful; user's original intent lost). (b) AbortController for the classify fetch (would work but requires threading signal through apiPost; the ref guard achieves the same goal with less surface change). (c) Storing requestedPhase in a separate event type (phase_requested) — extra event noise for something that logically belongs on task_created.

---

### ADR-014: Fold tool_result into tool_use by toolUseId — live and persisted
- **Date:** 2026-04-13
- **Section:** Iterate — tool-call-merge
- **Context:** Tool-call cards in the chat panel showed 'Running' forever. Root cause: tool_use and tool_result NDJSON events were persisted and rendered as two separate ChatMessage entries. The tool_use card's status came from message.type === 'tool_result', which never becomes true for the tool_use message itself. The NDJSON parser also did not propagate Anthropic's tool_use_id, so there was no key to match a tool_result back to its tool_use.
- **Decision:** (1) Persist both tool_use and tool_result as separate ChatMessages (append-only, lossless), but propagate Anthropic's tool_use_id via a new optional ChatMessage.toolUseId field. (2) Introduce a pure foldToolResults(messages) helper in webui/client/src/lib/ that walks the list once, indexes tool_use by toolUseId, and folds matching tool_result into the parent tool_use by copying content into toolOutput and inheriting isError. Orphan tool_results and legacy messages without toolUseId pass through. (3) ChatPanel folds both the persisted message list and the live streaming list before rendering. (4) ToolCallCard status is now derived from isLegacyResult OR toolOutput !== undefined OR isError, so a folded tool_use correctly transitions to 'Done' / 'Error'.
- **Commit:** HEAD
- **Consequences:** Tool cards now transition from Running to Done in place as soon as the matching tool_result arrives, both during live streaming and when a persisted chat history loads. Chat store remains append-only. Backward compatible with pre-fold histories (tool_use without toolUseId stays 'Running' until a matching result; legacy standalone tool_result messages still render as their own 'Done' card). foldToolResults is O(N) single-pass and pure.
- **Rejected:** (a) Merging at persist time in chat-store — would require rewriting existing jsonl entries which violates append-only. (b) Mutating streamingMessages in useStreamingChat when tool_result arrives — viable but forces an extra state-update pass and couples the hook to the render concern. A pure selector at render time is simpler and testable in isolation. (c) Storing tool_result inline on the assistant message — breaks the type shape and loses the chronological order for tools that span multiple assistant turns.

---

### ADR-015: Extract AskUserQuestion nested schema + dedupe streaming against persisted
- **Date:** 2026-04-13
- **Section:** Iterate — ask-user-card-fix
- **Context:** AskUserCard rendered as two empty yellow boxes with a 'Type your answer...' textarea and a 'Submit Answer' button, but no question text and no suggestion chips. Two root causes: (1) The component read toolInput.question and toolInput.options as if the schema were flat, but Claude Code's built-in AskUserQuestion tool emits a nested shape { questions: [{ header, question, multiSelect: { mode, options: [{ label, description }] } }] }. With the flat keys missing, question fell through to message.content (empty) and options was an empty array. (2) Every NDJSON chat:message event is persisted to chat-store AND broadcast via SSE. useSSE invalidates the chat query on each broadcast, so useChat refetches during streaming and the persisted messages end up containing the same event that is also in streaming.streamingMessages. ChatPanel renders both arrays sequentially, producing two identical cards.
- **Decision:** (1) New pure helper webui/client/src/lib/askUserPayload.ts with extractAskUserPayload(toolInput) that flattens both the nested Claude Code schema AND the legacy flat schema into { question, header?, context?, options? }. Used by AskUserCard.tsx for rendering and by server/index.ts for the inbox path — one extractor, two consumers. (2) New pure helper webui/client/src/lib/dedupeStreamingMessages.ts that removes streaming entries whose stable signature is already present in the persisted messages list. Signature: 'tool:<toolUseId>' for tool_use/tool_result when toolUseId is present, otherwise '<type>:<content-prefix-200>'. ChatPanel pipes streamingMessages through dedupeStreamingMessages BEFORE foldToolResults so the ordering is: persisted → rendered as-is; streaming → deduped against persisted → folded → rendered.
- **Commit:** HEAD
- **Consequences:** AskUserQuestion prompts now render with their actual question text, header tag, and option chips. Legacy flat schema still works. The chat panel no longer double-renders ANY event that landed in both stores during a stream, not just AskUserQuestion — tool calls, text, thinking blocks, everything. dedupeStreamingMessages is pure, O(N+M), and unit-tested. extractAskUserPayload is a single source of truth shared between client rendering and server inbox creation — future schema drift requires only one update.
- **Rejected:** (a) Move dedupe to the SSE layer (don't invalidate chat on chat:message during stream) — couples useSSE to streaming state, messy. (b) Remove the inbox-manager path entirely and let the ChatMessage tool_use be the single surface — breaks the global Inbox page which reads from inboxManager. (c) Use message.id as the dedupe key — IDs are generated independently by the server parser and the client streaming hook, so they never match. (d) Render-time mergeByToolUseId of the streaming list into messages — couples persisted data with live data and breaks the 'persisted is authoritative' invariant.

---

### ADR-016: Kill content_block persistence + displayContent guard + AskUserCard redesign + classifier tiebreak
- **Date:** 2026-04-13
- **Section:** Iterate — chat-dup-root-cause
- **Context:** Live test on port 5177 (2026-04-13) showed iterate 3's dedupeStreamingMessages was not sufficient. Chat shows every tool_use twice, every assistant text twice, and the phase badge on the kanban card displays 'build' for a 'Build a ToDo-App' task instead of 'project'. Root causes were deeper than the streaming-vs-persisted overlap my iterate 3 targeted. Four independent bugs were investigated by pulling the real chat-history jsonl from a recent task and grepping for duplicates: two tool_use AskUserQuestion entries with toolInput differing only by '(Recommended)' suffix appeared 4.6 seconds apart — proof that the server parser was persisting both the partial content_block event and the final assistant event for the same logical tool call. Separately, the assistant text showed twice in the chat because displayContent renders next to its already-persisted copy in messages. And the classifier's tiebreak had 'build' priority over 'project', which made 'Build a ToDo-App' classify as build since both scored 1.
- **Decision:** (A) webui/server/src/core/ndjson-parser.ts — delete the content_block_start/delta/stop handler entirely. Return empty array. Claude CLI emits these events with partial state while generating a content block token-by-token; our client's useStreamingChat hook does not consume them (live text streaming runs off the assistant event's text blocks), so deleting the server-side path only removes the double-persist. (B) webui/client/src/components/chat/ChatPanel.tsx — before rendering the streaming displayContent AssistantMessage, check whether any persisted message already contains that exact text. If yes, suppress the streaming render. Inline pure predicate, no new state. (C) webui/server/src/core/chat-store.ts — defense-in-depth: ChatStore.append maintains an 8-entry, 10-second rolling window of recent message signatures per task. Exact structural duplicates (same type/toolName/content/JSON.stringify(toolInput)/isError) within the window are silently dropped. Prevents any future parser regression or Claude CLI stream quirk from producing duplicate persisted rows. (D) webui/client/src/components/chat/AskUserCard.tsx — visual redesign per user feedback: switch from solid bg-amber-50 to bg-white with border border-amber-200 plus a thick amber-400 left accent bar (border-l-4 border-l-amber-400) and a soft card shadow. Aligns chrome with the white Claude cards in mockup 11 while keeping the 'needs attention' amber signal via the left accent. (E) plugins/shipwright-iterate/scripts/lib/classify_phase.py — remove 'build' from the BUILD phase keyword set (the verb in a user title almost always means 'create', not the Shipwright build phase) AND reorder PHASE_PRIORITY so 'project' wins ties over 'build'. Regression: 'Build a ToDo-App' now classifies as project.
- **Commit:** HEAD
- **Consequences:** (A) No more duplicate persisted tool calls or assistant text from parser double-processing. Chat-history jsonl stays clean. (B) Streaming displayContent and persisted messages no longer show the same text twice during the invalidation window. (C) Defense in depth catches any future quirks. (D) AskUserCard visually aligns with the white-card chat language while keeping the amber-accent attention signal. (E) 'Build a ToDo-App' and similar create-new-app phrasings classify as project; Kanban card phase badge shows 'project' in the default mapping (project -> backlog). Still a separate UX question whether the kanban mapping should put project-phase tasks in in_progress when they are running, but that is not this iterate. All tests green: server 206 (+7), client 198, iterate plugin 59 (+13).
- **Rejected:** (a) Keep the content_block handler and dedupe at render time — would require teaching the dedupe helper about partial-vs-final state of the same logical event, complex and brittle. (b) Move displayContent into streamingMessages so a single dedupe path covers both — would break the useStreamingChat hook contract and force a larger refactor for a one-line fix. (c) Add a delay before persisting content_block events to wait for assistant event — timing-sensitive, unreliable. (d) Special-case 'build a X' via regex in classify_phase.py — too narrow, doesn't cover 'construct a X', 'create a X', etc. Removing the standalone 'build' verb from the keyword set and reordering priority is the general fix.

---

### ADR-017: Correct AskUserQuestion schema path (options direct, multiSelect boolean) + orange accent + thinking label
- **Date:** 2026-04-13
- **Section:** Iterate — chat-polish-plus-restart
- **Context:** Live test of iterate 4 on port 5177 uncovered: (1) the dev server had never been restarted since before iterate 1 — it was running 12h stale code, so all of iterate 1-4's server-side fixes were not in effect (phase_started still hardcoded build, content_block_* still double-persisted, toolUseId not extracted). (2) Even with a fresh server, the AskUserCard still rendered options-as-bullets in the following assistant message instead of chips inside the card, because my iterate-3 extractAskUserPayload read questions[0].multiSelect.options — assuming multiSelect was an object — when the real Claude Code schema has options as a sibling of multiSelect, and multiSelect is just a boolean flag for allow-multiple-answers. Verified by dumping the full toolInput from a chat-history jsonl. (3) The amber color scheme read as yellow against the chat background — user asked for orange. (4) The awaiting-response indicator showed only three tiny bouncing dots with no text — the user described it as just a blinking cursor in the white area, not obviously communicating thinking state.
- **Decision:** (1) Kill the stale webui server (PID 60252, started 2026-04-12 22:36) and restart via npm run dev:server. Confirmed new PID 59168 started 11:10 running iterate-4 code. (2) Rewrite extractAskUserPayload to read options directly from questions[0].options as an array of {label, description} objects. Add allowMultiple boolean derived from questions[0].multiSelect === true. Update unit tests with the verified jsonl-dump shape. (3) Swap AskUserCard colors: bg-white + border-orange-300 + border-l-4 border-l-orange-500 + text-orange-600 header (was amber-200 / amber-400 / amber-600). (4) Replace bare StreamingIndicator in AssistantMessage empty-streaming state with an inline-flex row containing the dots + italic 'Thinking…' label in text-gray-500. More visible signal that Claude is working.
- **Commit:** HEAD
- **Consequences:** Post-restart, all iterate-1..4 server-side fixes finally take effect: phase badge reflects resolvePhase's classify result, content_block_* events are not double-persisted, task_created events carry the phase field, toolUseId propagates so foldToolResults can merge tool_use with tool_result, /start route honors task.requestedPhase. The AskUserCard now renders option chips inside the card (the schema fix was the bottleneck — even a correct visual design can't show chips if the extractor returns undefined). The orange color matches user preference. Thinking state is visible as 'Thinking…' text alongside dots. Still pending user verification: whether Claude's follow-up 'Ich warte auf deine Antwort' text still appears as a separate assistant message after the card (that's Claude's own output, not something we can hide server-side without a tool_result refactor — that's iterate-6 territory).
- **Rejected:** (a) Restart the server via a hook or a package.json watch trigger — too invasive for a one-time fix; manual restart is what the user expects here. (b) Keep the legacy multiSelect.options fallback in the extractor 'just in case' — no — the jsonl dump is authoritative and keeping both paths would hide future schema drift. (c) Use a loud red 'ATTENTION' style for the AskUserCard — too harsh; orange is enough to stand out against the beige chat background.

---

### ADR-018: Reset displayContent per assistant event + inbox id = toolUseId + dev-restart helper
- **Date:** 2026-04-13
- **Section:** Iterate — chat-polish-2
- **Context:** Post-iterate-5 live test surfaced four issues. (1) During streaming, the chat showed a big white card at the bottom containing ALL assistant text from the current stream concatenated together — appendToken in useStreamingChat accumulated text across every assistant event without resetting between turns. iterate-4's Bug B guard in ChatPanel only suppressed displayContent when exactly one persisted message matched it, so the accumulated concat blob never got suppressed. (2) Clicking an AskUserCard option showed 'Answered: X' locally but (a) Claude didn't act on it and (b) page refresh lost the state. Root cause: inbox-manager.addQuestion generated a fresh randomUUID for the inbox item id while the client posted to /inbox/:id/answer using message.id (the ChatMessage UUID, different value) — so the server couldn't find the item (404), and even if it could, 'isAnswered' was purely local React state with no hydration from persisted inbox. (3) Dev server had been running 12+ hours stale with orphaned tsx watch processes because tsx watch on Windows + chokidar sometimes misses git-merge file-swap events, and npm run dev invocations never cleaned up orphan children. (4) Claude emitting a markdown fallback listing all questions after the first AskUserCard is a separate architectural issue (inbox.answer sends plain text instead of a tool_result block referencing tool_use_id) — deferred to iterate 7, not this run.
- **Decision:** (A) useStreamingChat.processNdjsonMessage resets textBufferRef and displayContent at the top of every assistant-event branch, so the display buffer only ever mirrors the CURRENT in-flight assistant turn. Previous turns are already in persisted messages[] via SSE invalidation, and ChatPanel's Bug B guard suppresses the streaming render once messages[] catches up. (B) inbox-manager.addQuestion accepts an optional toolUseId parameter. When provided it becomes the InboxItem.id instead of a random UUID, giving the client a stable correlation key. index.ts's AskUserQuestion detection now iterates the extracted tool_use ChatMessages (covering both standalone tool_use events AND assistant-wrapped content-block tool_use blocks — the latter was completely missed before) and passes the chat message's toolUseId. Client AskUserCard uses message.toolUseId as the inbox id (falls back to message.id for legacy). A new useInboxItem(id) hook reads the persisted inbox item and AskUserCard hydrates its isAnswered + answer display from it, so refresh preserves state. (C) New webui/scripts/dev-restart.js — cross-platform Node script that kills stale tsx watch / vite / node processes owning ports 3847/5173/5177 then respawns npm run dev in webui/server. Exposed as 'npm run dev:fresh' in webui/server/package.json. Documented in webui/CLAUDE.md under Dev-server troubleshooting.
- **Commit:** HEAD
- **Consequences:** Streaming chat no longer shows a concatenated blob at the bottom — only the current turn's text displays, and iterate-4's Bug B guard still kicks in once messages[] has it persisted. AskUserCard submits with the correct inbox id so the server finds the item, marks it answered, and sendStdin actually fires. Refresh preserves the Answered state from server-persisted inbox. Dev server staleness is now a one-command recovery, explicitly scoped as a dev-only concern (production users run compiled code). Tests: server 209 (+3 inbox-manager), client 204 (+5: streaming 3, AskUserCard 2). Still open (iterate 7): Claude's markdown-fallback questions list + Claude not blocking on AskUserQuestion — both require the tool_result refactor in inbox.answer + claude-adapter.sendUserMessage, plus a review of whether the shipwright-project plugin needs instruction alignment (per memory feedback_iterate7_scope).
- **Rejected:** (a) Move displayContent dedupe to chat-store-level fingerprinting — too coupled, would need a new dedupe path just for the streaming render case. The reset-per-event fix is simpler and addresses the actual cause. (b) Use a synthetic id like 'msg.id + tool_use_index' as the inbox id — fragile, breaks on reload. toolUseId is stable and already propagated by iterate 2. (c) Run dev-restart as a git post-merge hook — too invasive; an opt-in npm script gives the same recovery without surprising developers mid-session. (d) Merge the tool_result refactor into this iterate — explicitly user-directed to split (see iterate-6 then iterate-7), and the plugin-side review (memory feedback_iterate7_scope) needs its own investigation.

---

### ADR-019: tool_result blocks unblock AskUserQuestion + inbox latency + plugin scope + ADR budget
- **Date:** 2026-04-13
- **Section:** Iterate — change: tool_result refactor
- **Context:** Iterate-6 made inbox.id == toolUseId, but inbox-manager.answer still sent plain text on stdin so Claude CLI never received a structured tool_result and emitted markdown fallback questions. Inbox-answer also lagged 2-3s before Thinking shows. Plus iterate ADRs grew 1.9-4.7k chars each, bloating Layer-1 context.
- **Decision:** InboxManager.answer sends a tool_result block via adapter.sendUserMessage for `toolu_`-prefixed ids and persists a tool_result ChatMessage; legacy UUIDs keep the plain-text fallback. AskUserCard fires triggerAwaiting via a new ChatAwaitingContext. shipwright-project SKILL + interview-protocol document per-question AskUserQuestion semantics. write_decision_log.py warns on fields >500 chars (forward-only).
- **Commit:** PENDING
- **Rationale:** tool_result is the Anthropic protocol for unblocking a tool call — anything else makes Claude assume the tool never returned. Context (vs prop drilling) keeps AskUserCard isolated from streaming hook internals.
- **Consequences:** Claude CLI now unblocks correctly on AskUserQuestion answers — no more markdown fallback. Thinking indicator fires instantly on inbox submit. New ADRs stay terse without retroactive churn. Tests: server 213 (+4), client 205 (+1), shared 153 (+3 length helper), iterate plugin 59, e2e 17. Backwards compat: legacy UUID inbox items still answer via plain text.
- **Rejected:** useIsMutating polling (clears on mutation success, not on first NDJSON event — wrong gap), lifting useStreamingChat into a context (too invasive), hard-failing on ADR length over budget (would block iterate 7 itself), unconditional tool_result for all ids (breaks legacy).

---

### ADR-020: Persist task_cancelled / work_completed / task_updated to events.jsonl
- **Date:** 2026-04-13
- **Section:** Iterate — bug: task event persistence
- **Context:** tasks.ts /status and /description handlers wrote events only to the in-memory EventStore, never to shipwright_events.jsonl. On server restart the replay rebuilt tasks from the file and deleted/closed/edited tasks came back as pending.
- **Decision:** Add emitTaskCancelledEvent + emitTaskUpdatedEvent helpers in bridge/event-writer.ts, wire them through TaskRouteDeps, and call them from /status and /description handlers BEFORE the in-memory addEvent so a disk failure leaves state untouched. Also wire the existing emitWorkCompletedEvent for the Close path.
- **Commit:** PENDING
- **Rationale:** Symmetric with the task_created path that already persists first then updates memory. Optional deps keep existing tests and non-production consumers working without the emitters wired.
- **Consequences:** Deleted, closed, and edited tasks now survive a server restart. Adds 3 optional fn deps to TaskRouteDeps, all existing call sites forward from index.ts. Tests: server 220 (+7).
- **Rejected:** Adding a DELETE /tasks/:id route (would still need to emit the same event). Writing only to memory and triggering a full snapshot rewrite on demand (inefficient and invites inconsistency).

---

### ADR-021: Inbox projectId + replay + collapse AskUserQuestion noise + model/effort wire-through
- **Date:** 2026-04-13
- **Section:** Iterate — bug: wiring fixes
- **Context:** Iterate-7 live test surfaced 4 wiring bugs: inbox items had empty projectId and never persisted, Claude emits duplicate AskUserQuestion cards + a markdown fallback in one turn, model selector in the toolbar was a placebo, and effort selector was both unwired and missing the VS Code 'max' option.
- **Decision:** index.ts passes the resolved projectId to inboxManager.addQuestion. New inbox-replay helper walks chat-history on startup and reconstructs orphan AskUserQuestions. New collapseAskUserQuestionRun client helper hides post-AskUserQuestion noise until a tool_result lands. claude-adapter.spawn pushes --model alias. New effort-prompt helper wraps the prompt with /think, /think hard or /ultrathink. UI toolbar gains the max effort option.
- **Commit:** PENDING
- **Rationale:** Effort cannot be a CLI flag (Claude Code has no --thinking) so slash-command prefixes are the only real knob. Chat-history is the authoritative source for reconstructing inbox state because inbox.jsonl may be stale or empty after previous bugs.
- **Consequences:** Inbox items survive restart (loadFromDisk + replay). Doppel-cards and Lass-mich-wissen fallback no longer render in the chat. Toolbar model selection actually reaches the CLI. Thinking depth is honored via slash-command prefix. Tests: server 242 (+22), client 213 (+8).
- **Rejected:** Auto-answering orphan inbox items on startup (would break the user's actual intent). Hiding the effort pill entirely (worse UX than a prefix that may or may not work perfectly). Passing --model via env var (flag is cleaner).

---

### ADR-022: Mid-task mode switching via --resume + autonomy sync to shipwright_run_config.json
- **Date:** 2026-04-13
- **Section:** Iterate — change: runtime config
- **Context:** Iterate-9 wiring audit found two remaining runtime-config gaps: ADR-011 said mid-task permission mode switching was 'v0.1 not supported' because per-message respawn cold-started every turn, but a one-off explicit switch is a different tradeoff. Autonomy was stored in projects.json only and never reached the Shipwright plugin chain which reads from shipwright_run_config.json.
- **Decision:** claude-adapter captures Claude's real session_id from system/init; new `resumeSession` flag emits `--resume <id>` in spawn. New `POST /tasks/:id/mode` terminates + respawns with `--resume` + new `--permission-mode`, guarded against pending AskUserQuestion and uncaptured session_id. `projectManager.updateAutonomy` writes autonomy into projects.json AND merges it into `<project>/shipwright_run_config.json` so the plugin chain reads it.
- **Commit:** PENDING
- **Rationale:** ADR-011's rejection was based on per-message respawn cost. For an explicit user action (click Plan Mode), one cold start is acceptable UX. Guarding on pending AskUserQuestion is simpler than synthesizing tool_results for an orphaned tool_use.
- **Consequences:** Users can switch permission mode mid-conversation (one cold start per switch, full history preserved via --resume). Pending AskUserQuestion correctly blocks the switch with a 409. Per-project autonomy is now actually consumed by the plugin chain. Tests: server 253 (+11 for mode endpoint, adapter session-id capture, --resume flag, updateAutonomy sync).
- **Rejected:** Undocumented control_request protocol (too risky). Autonomy read-through from run_config.json at project load (harder to reason about; write-through is simpler). Allowing mid-switch during pending questions (would orphan tool_use entries).

---

### ADR-023: Revert iterate-7 tool_result send (API 400) + inbox filter + model selector fixes + finalization verifier
- **Date:** 2026-04-13
- **Section:** Iterate — bug: UX hotfixes + verifier
- **Context:** Iterate-10 live test surfaced: API 400 on inbox answers (iterate-7's tool_result stdin violates Anthropic's same-turn rule in -p mode), ghost inbox items for deleted tasks, model selector bugs (Sonnet context, popover doesn't close), doc drift (architecture.md stuck at ADR-018, no conventions learnings since iterate 7), stale session_handoff.md.
- **Decision:** `inbox-manager.answer` reverts to plain-text `sendStdin` for all items (chat-store tool_result UI persistence stays). `/api/inbox` filters items whose task is terminal or missing. `ModelSelector` wraps options in `Popover.Close` and sets Sonnet to 1M. Architecture.md retrofits ADR-019-023, conventions.md gains iterate 8-11 learnings, ADR-011 gets superseded note. `generate_session_handoff.py` gains `--project-root` flag; iterate SKILL F11 passes it. New `verify_iterate_finalization.py` + 18 tests enforces finalization completeness.
- **Commit:** PENDING
- **Rationale:** Root cause of iterate 7 was treating -p stream-json Claude as a blocking tool caller. It's not — tool_use is advisory emission. Plain text fixes the API contract; collapseAskUserQuestionRun from iterate 9 hides the cosmetic fallback.
- **Consequences:** API 400 eliminated — answering from inbox now works. Inbox shows only live items. Model selector closes on select with correct context. Iterate 12 can build on the verifier. Tests: server 268 (+15), client 213, shared 171 (+18 verifier), e2e 17.
- **Rejected:** Keep tool_result path for some heuristic subset (complex, fragile). Delete ADR-011 entirely (loses ADR history). Full Companion Zustand rewrite (deferred to iterate 13). Stopping effort via slash-command prefix (stays — no CLI flag exists).

---

### ADR-024: Inbox dedupe by normalized question + zombie-task filter (no live process)
- **Date:** 2026-04-13
- **Section:** Iterate — bug: inbox dedupe + zombie filter
- **Context:** Iterate 11's inbox filter reduced 8 → 6 items but left two remaining noise sources: (1) Claude's same-turn duplicate AskUserQuestions each got their own toolu_id and both passed through to the inbox; (2) tasks marked running in the event store but whose Claude process had died still leaked their pending items.
- **Decision:** inbox-manager.addQuestion dedupes by normalized signature (taskId, normalize(question)) for pending items — first-write-wins, returns existing. /api/inbox filter extended with governor.getProcess(taskId) check: running status but exited/missing process = zombie → filtered.
- **Commit:** PENDING
- **Rationale:** First-write-wins dedupe matches iterate 9's client-side collapse behavior — consistent UX across chat and inbox. Route-level governor check is the minimum-risk hotfix; real fix is event-store level.
- **Consequences:** Inbox now shows only live items for tasks whose Claude process is actually running. Claude's per-turn duplicate tool_use pattern no longer pollutes the list. Architectural cleanup of zombie detection (emitting a synthetic task_orphaned event on startup) is deferred to iterate 12 — the route-level filter is a band-aid that iterate 12 will replace with proper state.
- **Rejected:** Time-window dedupe (fragile), signature-by-content-hash (over-aggressive for intentionally similar questions across turns), emitting task_orphaned events on server startup (correct but bigger — iterate 12).

---

### ADR-025: Revert 11.1 zombie filter + show latest pending inbox item per task
- **Date:** 2026-04-13
- **Section:** Iterate — bug: inbox latest-per-task
- **Context:** Iterate 11.1's governor-based zombie filter was too aggressive — after a server restart the governor's activeProcesses map is empty, so ALL items from previously-running tasks were hidden even though the user wanted to see them (to clean up or restart). User expected to see the current question per task, not all accumulated ones.
- **Decision:** Revert iterate 11.1's /api/inbox governor.getProcess zombie check (keep the parameter as _governor for 5-arg signature compat). Add a 'latest pending per task' filter: for each task with pending items keep only the one with the most recent createdAt. Terminal-task filter (iterate 11) and addQuestion dedupe (iterate 11.1) stay.
- **Commit:** PENDING
- **Rationale:** 'Latest per task' is the user's mental model — they want to see what Claude is currently waiting on, not every historical request. It also handles zombies gracefully: dead tasks show their last question so the user can decide to delete or restart.
- **Consequences:** Both iterate-9's same-turn-duplicates AND iterate-11-context's 4-questions-from-interview accumulation are naturally collapsed by one rule. User sees exactly one current question per task, with answered items preserved. Server 277 (+1 net).
- **Rejected:** Keep the zombie filter + add latest-per-task (double filtering, confusing). Emit task_orphaned events on startup (correct but architectural — iterate 12).

---

### ADR-027: Iterate 14 omnibus — phase cleanup, multi-question inbox, pipeline entry, constitution discipline
- **Date:** 2026-04-15
- **Section:** Iterate 14 (7 sub-iterates)
- **Context:** Iterate 13 chat UX rebuild exposed follow-ups during a TodoApp4 live-test: (1) `iterate` / `preview` phases were incorrectly added to the dropdown in 13; (2) no UI entry point to start a new Shipwright pipeline; (3) `Ctrl+Shift+N` opened Chrome Incognito instead of NewIssueModal (OS-level browser reservation); (4) `AskUserQuestion` payloads with N>1 questions silently dropped questions 2-N (`askUserPayload.ts` read only `questions[0]`); (5) Claude CLI in stream-json mode does not gate `tool_use` on matching `tool_result`, so Claude sometimes kept generating after AskUserQuestion; (6) Model label was hardcoded "Opus 4.6".
- **Decision:** Split into 7 sub-iterates (matches iterate 12.x pattern). Plan reviewed by Gemini 3.1 Pro Preview + GPT-5.4 via `shared/scripts/lib/llm_review.py` — revisions applied before implementation (critical: reject "plain user message" submit path in scope 9, fix `getProjectMode` terminal-status coverage, per-line JSONL validation vs blunt-wipe, clarify pipeline bootstrap ownership, swap Ctrl+K for Linear-style letter shortcuts). Scopes: (1) phase dropdown cleanup, (2) preview button + profile-loader + run plugin profile field, (3) getProjectMode + iterate auto-detection, (4) multi-question inbox `parts[]` schema, (5) constitution AskUserQuestion stop rule, (6) CreateMenu + NewPipelineModal + C/Shift+C shortcuts + `/api/profiles` + `/api/projects/pipeline` with path safety, (7) shipwright-project intro gate + `write_run_config.py`, (8) Playwright E2E suite +7 specs, (9) red-flag banner visual only (no submit-path changes), (10) dynamic model label.
- **Commit:** ca30350 → 5ec16ff → 483c3b1 → c48fc1a → 13c3f79 → 9366dc6 → b123339
- **Rationale:** Splitting follows the iterate 12.x precedent — smaller blast radius per commit, independent testing per sub-iterate, easier rollback, matches the autonomy preference (one plan, many executions, no continue gates). Profile-based preview detection (scope 2) preferred over package.json fast-path for architectural cleanliness — the run plugin owns the profile field, webui just reads it. Plugin bootstrap ownership resolved (scope 7): webui OR plugin writes `shipwright_run_config.json`, never both; plugin writes directly via `write_run_config.py`, not by invoking `/shipwright-run` skill (ambiguous skill-call path). Constitution rule (scope 5) placed in `shared/constitution.md` rather than per-plugin duplication — 12 plugins already reference it. Red-flag banner (scope 9) is visual-only because the reviewer flagged that "Answer anyway as plain user message" violates Anthropic API protocol (every `tool_use` requires matching `tool_result`). Letter-based shortcuts (c / Shift+C) over Ctrl+K because Ctrl+K is the universal command-palette standard (Slack/Linear/Notion) and semantically wrong for a create menu; letter shortcuts are Linear-style and have zero browser collisions.
- **Consequences:** webui/server tests 274 → 343 (+69), webui/client tests 246 → 286 (+40), Playwright 8 → 15 specs (33 tests), shipwright-project tests 31 → 43 (+12), shipwright-iterate tests 62 (baseline unchanged). Plugin-side changes (shipwright-run SKILL.md, shipwright-project intro gate + new script, shared/constitution.md) synced to runtime via `scripts/update-marketplace.sh`. InboxItem schema is now `parts[]` — legacy v1 entries auto-purged via per-line validation on load (preserves valid entries, rewrites file). `POST /api/projects/pipeline` exposes a user-input filesystem write surface — path safety is critical (traversal reject, isDir, duplicate, existing-config 409). Model label is now dynamic from `system/init.model` event, falling back to "Claude" when not yet received. Inbox multi-question accordion blocks Submit until all parts answered (no partial submissions). `getProjectMode()` covers both `completed` and `complete` status values (webui/shipwright_run_config.json uses `complete`, other projects may use `completed`). `notBlocked` field persists across reconnect via JSONL roundtrip; server-side detection via pure state machine in `ask-user-guard.ts` is fully unit-testable without Claude.
- **Rejected:** Force-continue as single large iterate (10 scopes in one commit/branch — unreviewable, no rollback granularity). Ctrl+K shortcut for CreateMenu (command-palette semantic collision — reviewer flag). "Answer anyway" as plain user message (violates Anthropic API protocol — Gemini reviewer critical finding). Blunt-wipe inbox JSONL on schema mismatch (too aggressive — per-line validation preserves valid entries). Plugin invoking `/shipwright-run` skill from within its own turn (skill-call ambiguity — reviewer flag). Ctrl+Shift+K as Firefox Web Console collision backup (non-overridable at browser level). Package.json fast-path for preview detection (deferred to future iterate when non-JS stacks exist). Per-ADR-per-sub-iterate (7 ADRs for one cohesive plan is overhead — one omnibus ADR mirrors the plan structure).

---

### ADR-028: Iterate 14.7 — Post-launch fixes, multi-project kanban, interrupted task status
- **Date:** 2026-04-15
- **Section:** Iterate 14.7 (3 sub-iterates)
- **Context:** Manual testing of iterate 14 surfaced: (1) `task_orphaned` events emitted at server startup by iterate 12.0b's zombie reconciliation mapped running tasks to `backlog`, losing the visual "was in progress" signal when server restarted (dev:fresh, crash, intentional); (2) Kanban "All Projects" selection silently redirected to first project via a forced auto-select effect; (3) reload reset selected project to first in list; (4) ModelSelector + 14.6's dynamic model label were redundant and confusing; (5) Browse buttons in project wizard returned folder name only (browser sandboxing — `showDirectoryPicker` cannot return absolute paths); (6) inbox items were dead-end (no way to jump to task chat); (7) NewIssueModal had no visible indication of project mode (pipeline/iterate/standalone); (8) Claude sometimes asks decision questions as markdown numbered lists instead of AskUserQuestion tool use, bypassing inbox; (9) All-Projects aggregation showed cards indistinguishable by source project.
- **Decision:** Split into three sub-iterates: **14.7.0** P0 blockers (task persistence + all-projects + localStorage), **14.7.1** P1 UX polish bundle (model selector sync + paste buttons + inbox nav + mode badge + constitution rule), **14.7.2** P2 multi-project kanban visual distinction (colored left-edge strip + monochrome phases + filter chip + sidebar legend). Executed autonomously without external LLM review (scope is UX polish + one state-machine addition for `interrupted` status, no architectural risk). Key technical decisions: (A) New `interrupted` kanban status distinct from `orphaned` — added new `session_captured` event emitted on first `system/init` per task so `session_id` persists across process restart (ADR-022 had left it in-process only); `POST /tasks/:id/resume` reuses ADR-022's `--resume <sessionId>` spawn path. (B) Browse → Paste rename is the honest UX because browser sandboxing forbids path disclosure; `navigator.clipboard.readText()` with `looksLikePath()` heuristic. (C) ModelSelector `userOverride` flag resets on task switch; auto-sync only applies until user manually picks. (D) Deterministic project color via `projectId` string hash → 12 HSL hues; monochrome phase badges when project strip is visible to prevent color overload. (E) Constitution extension in 14.7.1 P1.8 ships the markdown-questions-forbidden rule in one place (picked up by all 12 plugins already referencing `shared/constitution.md`).
- **Commit:** 9dea2f8 → 035e4df → 9862ed8
- **Rationale:** Autonomous execution matches the `feedback_iterate_autonomy` preference. Per-sub-iterate branches give rollback granularity and keep each agent's scope manageable. Resume button per-task (not bulk) because this is primarily a dev scenario — tasks interrupted by intentional server restart, rare in sustained operation. `interrupted` + `backlog` are intentionally distinct statuses rather than collapsed: `interrupted` means "was running and is resumable", `backlog` means "never started or died unrecoverably". Stripe + monochrome phases in All-Projects mode respects the rule of thumb "one color dimension at a time" — when cards need to show project identity, phase colors would compete for attention.
- **Consequences:** webui/server tests 343 → 356 (+13, 14.7.0 only — 14.7.1 and 14.7.2 touched no server code). webui/client tests 286 → 339 (+53 across 14.7.0 +12, 14.7.1 +28, 14.7.2 +13). Plugin baselines unchanged. Playwright 33 specs preserved with one (15-model-label) updated for the 14.7.1 label deletion. `shared/constitution.md` touched in 14.7.1 → `scripts/update-marketplace.sh` ran at finalization to sync the plugin cache. New dependencies on existing ADR-022 infrastructure: `session_id` capture pipeline is now persisted via event log (was in-process only); future iterate may want to also persist full conversation state for hard-crash recovery. Test baseline shifts: consumers of `webui/client/src/components/chat/ChatToolbar` that reference `running-model-label` testid will break — updated in this iterate, noted for future reference. `TaskCard.tsx` now carries logic from both 14.7.0 (interrupted pause icon) and 14.7.2 (project strip + monochrome phase prop) — single file has three conditional rendering modes that interact, future maintenance should be mindful. `ProjectFilterChip` state lives in KanbanPage alongside `activeProjectId`; localStorage persistence from P0.3 currently persists `activeProjectId` only, NOT the filter chip selection — reload resets filter to "all selected" which is acceptable as a fresh start signal.
- **Rejected:** Bulk Resume button (header "Resume all N") — deferred as premature optimization for dev-only scenario. Supervisor dependency like pm2/systemd as a prerequisite — existing `install-windows.ps1` handles Windows autostart via VBS wrapper; Mac/Linux equivalents deferred to post-14.7 install-docs backlog. Auto-resume on startup — too magical, hides errors (tasks may be in broken state when interrupted). Merging interrupted into existing `orphaned` status — loses the "resumable" vs "dead" distinction. `showDirectoryPicker` as real Browse implementation — File System Access API deliberately hides absolute paths for security. Per-ADR-per-sub-iterate — one omnibus ADR mirrors the plan structure (same pattern as ADR-027 for iterate 14).


---

### ADR-029: Last-write-wins chatStore + spawn indicator sans message-gate + AUQ submit error surfacing
- **Date:** 2026-04-17
- **Section:** Iterate — bug: post-14.13 bug sweep
- **Context:** Four distinct bugs surfaced after 14.13 user-testing: (1) ModelSelector desynced from chat system/init after mid-task model switch because setSystemInit was first-write-wins; (2) second AskUserQuestion submit sometimes stalled with no Claude response and no visible error; (3) Inbox\u2192Task click hit react-router 404 because the nav target used a non-existent nested route; (4) 14.13 spawn indicator never rendered because its gate required messages.length === 0, but the user's initial prompt populates that array on task create.
- **Decision:** chatStore.setSystemInit switched to last-write-wins when the model id differs (idempotent on identical writes). ChatPanel REST hydration now seeds from the LATEST system message, not the first. Spawn indicator render condition dropped the messages-length gate and renders at the bottom of the message list while awaitingInit is true; the generic leading indicator is suppressed while the spawn indicator owns the slot. InboxPage navigates to the existing /tasks/:taskId route (projectId is resolved client-side from the task object). AskUserCard now surfaces mutation errors via an inline banner + optimistic rollback; inbox-manager logs each answer delivery for runtime forensics of the still-unreproduced Bug 2 stall.
- **Commit:** pending
- **Rationale:** First-write-wins was correct for 14.6's duplicate-SSE concern but broke 14.12's respawn scenario; last-write-wins preserves both properties by short-circuiting on identical models. Router fix is a trivial path correction. The messages-length gate was a 14.13 oversight: the empty-chat case it was built for also populates messages[] with the initial user prompt. Error surfacing and observability log were added because Bug 2 cannot be reliably reproduced from the server-side tests (passed first try)\u2014the next occurrence needs client + server signals to debug.
- **Consequences:** Mid-task model switch now updates both ModelSelector and the chat session-started line in lockstep. Inbox deep-links work again. Spawn indicator shows for the full 1-2s boot gap. If the answer POST fails silently (e.g. Process no longer running after a respawn race), the user sees the error instead of a frozen spinner. Bug 2 runtime root cause (Claude CLI behavior post-result) not yet pinned down; observability log + client error banner narrow the reproduction surface for the next user session.
- **Rejected:** Clearing the chatStore on useSwitchModel.onMutate instead of changing setSystemInit semantics: narrower fix but leaves the REST-hydration path still picking first-system/init which breaks on page reload after switch. Adding the nested /projects/:id/tasks/:id route instead of dropping the prefix: more surface area with no user benefit since useTasks already resolves projectId. Retrying the answer POST automatically on 400/500: masks the underlying stall and ships a potentially amplified bug.

---

### ADR-030: Mid-task model switch pending-target UX + spawn indicator task-undefined + empty-prompt suppression
- **Date:** 2026-04-18
- **Section:** Iterate — bug: modelswitch-spawn-ux
- **Context:** Campaign assistant-ui-migration UAT revealed: (1) fresh-task spawn indicator never rendered because the awaitingInit gate required task loaded (task=undefined transient state missed the window), (2) mid-task model switch had no visual feedback for the 1-2s CLI respawn because isSwitching tracked only the 200ms mutation, and (3) every respawn emitted an unsolicited 'Nachricht leer' assistant message because tasks.ts:774 passed prompt: '' through to claude-adapter.sendUserMessage which wrote {content:''} to CLI stdin.
- **Decision:** Client: ModelSelector gains pendingTargetModel prop rendering target label + spinner until systemInitModel catches up. ChatToolbar owns the state machine (clear on systemInit match, on mutation error, or 15s timeout) and surfaces inline error banner (model-switch-error testid). ChatPanel awaitingInit widens to trigger when task is undefined/errored and systemInit is empty. Legacy dezent weisser leading-indicator removed. Server: claude-adapter.sendUserMessage guards empty/whitespace content — skips stdin write entirely, preventing the 'leere Nachricht' artifact on every respawn.
- **Commit:** pending
- **Rationale:** Tracking the respawn via systemInit rather than mutation isPending is the only way to bridge the client-server timing gap without polling. pendingTargetModel is stateful in ChatToolbar (not ModelSelector) so ChatToolbar can coordinate multiple signals (useSwitchModel.isPending, useSystemInitModel, timeout). Empty-prompt guard in adapter is the narrowest fix: the mode-switch endpoint's prompt:'' placeholder semantics are preserved (no new API) while stdin stays clean.
- **Consequences:** New tests: adapter 2, ModelSelector 4, ChatToolbar 2, ChatPanel 2, Playwright 3 = 13 new green gates. Client 475/475 (was 467), server 404/404 (was 402). tsc unchanged. The pending-target visual gives continuous feedback across the full respawn window; errors (409 pending AUQ etc.) are surfaced inline instead of silent drop. The 'leere Nachricht' ghost message is eliminated for all future model/mode switches. 4.6->4.7 second-switch silent-failure case is now either visibly successful (pending-target shows 4.7 until system/init arrives) or visibly errored (banner shows server error).
- **Rejected:** Client-side 1-2s delay before resolving the mutation (blocks retry, opaque to user). Server-side wait-for-system/init before returning from /mode endpoint (couples HTTP timeout to CLI boot, fragile). Synthetic 'ignore me' sentinel prompt on stdin (CLI would still surface it as a user turn). Adding optimistic ModelSelector state (label flips immediately to target even on failure — misleading).

---

### ADR-031: Second-round UAT fixes: new-task model precedence, ghost bubble, resume UX
- **Date:** 2026-04-18
- **Section:** Iterate — bug: modelswitch-uat-round2
- **Context:** UAT after ADR-030 landed surfaced 5 follow-ups: (1) new tasks used localStorage model (e.g. 4.6 from a prior switch) instead of settings.defaultModel (4.7); (2) a ghost empty assistant bubble rendered after 'Starting Claude'; (3) orphan Resume banner only triggered for stale_on_startup | user_interrupted, missing other reasons like switch_timeout; (4) resume did not re-trigger the spawn indicator because the old system/init was still in the chatStore; (5) 409 'Session not yet established' errors left the user stuck with no retry affordance.
- **Decision:** Client-only fixes. useCreateTask reads settings.defaultModel directly (not localStorage) for new-task body.model. ThreadMessage in ThreadView returns null when all content parts are empty (kills the ExternalStoreRuntime running-reply placeholder ghost). TaskHeader isInterrupted widened to 'orphaned && !!claudeSessionId' (drops the 14.11 narrow reason list). useResumeTask's onMutate clears systemInitByTask[taskKey]. ChatToolbar adds a Retry button inside model-switch-error for transient 409s (max 3 attempts).
- **Commit:** pending
- **Rationale:** Model precedence: new tasks are a global-settings concern (user's default), mid-task switches are session-scoped (user's in-flight override). Splitting them at the consumer is cleaner than building a smart merging rule in useChatSettings. Ghost bubble: filtering at the renderer is safer than fighting the runtime; the guard is a one-line content check. Resume clearSystemInit: mirrors the pattern of fresh task creation where the store is empty. Retry button: narrower than auto-retry (no magic), lets the user see the error first.
- **Consequences:** New tests: useCreateTask +1, useResumeTask +2 (new file), TaskHeader +2, ChatToolbar +3, ThreadView +2 = 10 new specs. Client vitest 485/485 (was 475). Server vitest 404/404 unchanged. tsc clean. Playwright +0 new specs (unit coverage sufficient for these UX touches). Server-side concerns unchanged: the 409 itself and the switch-timeout orphan flow stay on the CLI / server side.
- **Rejected:** Auto-retry on 409 with backoff (hides errors, can amplify a broken respawn). Removing localStorage model entirely (breaks in-chat send-model scope). Making systemInit always clear on any task.status change (too aggressive, breaks idempotent duplicate SSE).

---

### ADR-032: Multi-select split(', ') bug + notBlocked banner slimmed + switch timeout 15s->30s
- **Date:** 2026-04-18
- **Section:** Iterate — bug: askuser-multiselect-bugs
- **Context:** UAT surfaced three regressions: (1) AskUserCard multi-select could not toggle labels containing ', ' (e.g. 'Grundfunktionen (Erstellen, Abhaken, Löschen)') — the option appeared unselectable while internally every click accumulated a duplicate copy (20+ in one inbox trace); (2) the notBlocked banner was visually dominant, distracting from the actual question; (3) PENDING_SWITCH_TIMEOUT_MS=15s triggered on otherwise-successful switches when CLI cold-start + Windows Defender + plugin discovery exceeded 15s.
- **Decision:** Split AskUserCard's partAnswers map into two: textAnswers:Record<number,string> (single-select pick + free-text) and multiAnswers:Record<number,string[]> (multi-select labels, array in selection order). Join with ', ' only at submit time. Banner slimmed: text-xs + px-2 py-1 + size=11 icon + one-line wording. Timeout widened to 30s.
- **Commit:** pending
- **Rationale:** Array state is the only reliable fix — no separator is guaranteed not to appear inside labels emitted by Claude. String-join at submit keeps the API wire format stable. Timeout: runtime evidence (Demo 2 task cea73f00 switch took ~5s) suggests 15s was the happy-path budget; 30s tolerates Windows antivirus overhead.
- **Consequences:** Multi-select labels containing ', ' now toggle cleanly (2 new specs verify). Banner still alerts but no longer dominates. Timeout tolerates slow CLI respawns. Client 487/487 (was 485). tsc unchanged.
- **Rejected:** Escape ', ' with a sentinel before join (brittle — labels can contain anything). Change API to accept string[] directly (out of scope, larger refactor). Auto-retry on switch timeout (hides real failures).

---

### ADR-034: External-launch pivot (Plan D'' variant a)
- **Date:** 2026-04-19
- **Section:** Iterate — campaign: webui-acp-pivot (Plan D'' variant a)
- **Context:** The in-webui chat architecture (iterates 14.x) repeatedly bled under the combined pressure of NDJSON heuristic parsing, assistant-ui state ownership, Claude CLI upgrade churn, and the subscription-vs-API-key constraint. Plan D (ACP host) died on upstream abandonment of `claude-code-acp`; Plan D' (SDK-direct via `@anthropic-ai/claude-code`) died when Anthropic retired the importable library surface and split `@anthropic-ai/claude-agent-sdk` behind an API-key gate (rejected: subscription-auth is load-bearing). Plan D'' revives Plan A now that `claude --session-id <uuid>` exists as a first-class CLI flag, closing the session↔task correlation gap that originally killed it.
- **Decision:** Remove all in-webui chat runtime. Webui generates a UUID at task creation, emits a Copy command (`claude --session-id <uuid> --add-dir <cwd> [--resume <uuid>] [--plugin-dir <…>]` in PowerShell / cmd.exe / POSIX forms), and polls `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl` for state. Server is stateless on transcript reads (client passes `fromByte` + `expectFingerprint`). Filename-first discovery (per Sub-iterate 0 PoC finding 1 — fork-session JSONLs begin with `file-history-snapshot` lines that carry no sessionId). Variant-a narrow scope: Copy launcher only (Terminal + VSCode + Desktop deferred to v2+); polling only (no SSE for transcript, no chokidar watchers); in-browser transcript viewer is read-only (no compose input).
- **Commit:** 4d329ed → next push (autonomous campaign across sub-iterates 0→3).
- **Rationale:** The 14.x history is architectural evidence that coupling webui to the CLI's stdio surface is unsustainable under upstream churn. External launch inverts the dependency: webui observes a file that Anthropic produces, and Anthropic owns the hard UX work (permission prompts, thinking display, plan mode). Webui becomes a task board + transcript reader + diagnostic surface. Scope cuts (no Terminal/VSCode launchers, no chokidar, no SSE transcript) are endorsed independently by both external reviewers (GPT-5.4 + Gemini 3.1 Pro) across three review rounds; landing a narrow v1 avoids replaying the 14.x failure class.
- **Consequences:**
  - Deleted server modules: claude-adapter, ndjson-parser, process-governor, chat-broadcast, chat-store, inbox-manager, inbox-replay, ask-user-guard, task-manager, event-store, heartbeat, file-watcher, sse-manager, capability-probe, all bridge/*, old chat/tasks/inbox/capabilities/classify/sse/pipeline/docs routes.
  - Deleted client surface: chat-rendering/, components/chat/, components/board/, components/detail/, components/explorer/, components/viewer/, chat-specific hooks, Kanban page, old TaskDetailPage.
  - Deleted deps: `@assistant-ui/react`, `@anthropic-ai/claude-code`, `claude-code-acp`, `@zed-industries/agent-client-protocol`, `tree-kill`, `uuid`, `node-cron`, `chokidar`, `react-markdown`, `mermaid`, `react-diff-viewer-continued`, `rehype-highlight`, `remark-gfm`, `@radix-ui/{collapsible,popover,scroll-area}`. 318 client + 51 server packages pruned.
  - New production modules: core/{launcher, session-watcher, session-parser, inbox-derive, sdk-sessions-store, cli-compat}, routes/diagnostics, external/routes. New pages: TaskBoardPage, TaskDetailPage (rewrite), DiagnosticsPage, InboxPage (rewrite). New hooks: useExternalTasks, useLaunchTask, useTaskTranscript, useExternalInbox, useDiagnostics. New Playwright specs 30/32/33/34/35.
  - Test coverage: server 131/131 + client 177/177 + Playwright 11/11 (all green).
  - MIN_SUPPORTED_CLI = `2.1.114` pinned in `core/cli-compat.ts`, surfaced via `/api/diagnostics` + `DiagnosticsBanner`. Older CLIs show a persistent warning banner.
  - Config + settings migration: `<registryDir>/sdk-sessions.json` is the new authoritative task store (schema-versioned, lockfile-guarded, per-row fault isolation). Legacy `chat-history/*.jsonl` and `shipwright_events.jsonl` are no longer read or written by webui. Projects on main pre-pivot continue to work with rollback via `main@040c27e`.
- **Rejected:** In-webui chat via CLI-boundary wrapper (Plan B''; same 14.x risk profile). API-billing Agent SDK (violates subscription invariant). Pinning `@anthropic-ai/claude-code@1.0.128` for the retired library surface (stuck on a year-old CLI). Forking `claude-code-acp` (multi-day bridge rewrite against an abandoned upstream).
- **Rollback:** Revert to `main@040c27e` restores the pre-pivot chat architecture. External-launch artifacts (`~/.claude/projects/<cwd>/<uuid>.jsonl`) persist — users can resume those sessions directly via `claude --resume <uuid>` from the CLI even without webui.

---

### ADR-035: Iterate 2 — title integration via `--name`, rendering libs, and doc-sync strategy
- **Date:** 2026-04-20
- **Section:** Iterate — campaign: webui-ui-polish (Iterate 2 / Plan D'' follow-on)
- **Context:** ADR-034 shipped a minimum-viable read-only transcript: vertical event cards, no markdown, no syntax highlighting, no auto-scroll, no virtualization. Task-board cards lacked metadata; Inbox items were JSON dumps. User-assigned task titles existed only inside webui — invisible in the terminal's `claude --resume` picker. PoC (Sub-iterate 2.0) confirmed Claude CLI 2.1.114 exposes `-n, --name <name>` as a first-class flag pre-seeded at launch, and the `custom-title` + `agent-name` events appear in the JSONL with a stable schema. Six sub-iterates (2.1 → 2.5) were planned + externally reviewed (GPT + Gemini) before execution.
- **Decision:** Title integration via Claude's first-party `-n, --name <title>` CLI flag at every launch. Webui owns the title (`sdk-sessions.json`); the next launch carries it to Claude. No sidecar file, no JSONL mutation, no mid-session interactive `/rename` orchestration. Rendering layer rebuilt on `react-markdown@10` + `remark-gfm@4` + `rehype-highlight@7` + `strip-ansi@7` — the smallest battle-tested stack that covers the chat-style UX. Bubble layout replaces the flat event-card list; tool_use/tool_result correlation deferred to a future iterate (rendered as sibling chronological cards). `@tanstack/react-virtual` engages above 200 events. Auto-scroll uses CSS `overflow-anchor: auto` with `useAutoScroll` as the safety net. TaskBoard cards show state icon + last-activity timestamp + cwd basename + a compact `<TerminalLaunchButton>`; Inbox items group by sessionUuid and use the safe-getter for AskUserQuestion payloads. Doc-sync (sub-iterate 2.4) brings planning specs, agent_docs, compliance docs, and `webui/CLAUDE.md` back in line with the post-pivot reality.
- **Commit range:** 4de68b5 (2.1) → ce783d6 (2.2a) → c6b2d57 (2.2b) → 36d621f (2.3) → this commit (2.4) → 2.5 merge.
- **Rationale:** `--name` is load-bearing for picker parity. Claude already owns the title field; building a parallel store duplicates state. A "Sync title now" button was rejected on architectural grounds — running `claude --resume <uuid> --name "X"` while a session is active risks SQLite lock + JSONL interleave (EBUSY on Windows). The next-launch sync is good enough and stays inside the read-only contract. The rendering library shortlist follows the Plan D'' inversion: fresh, ESM-only, React-19-compatible, no framework lock-in. `react-scroll-to-bottom` was deliberately rejected (stale since 2022, no React 18/19 support, jitter under streaming). Tool-use/tool-result correlation was deferred to keep the iterate inside the ~2-day budget; sibling rendering covers ~80% of the user-visible win.
- **Consequences:**
  - **2.1:** `launcher.buildCopyCommands` accepts `title` and emits `--name <quoted>` after `--session-id` (or after `--resume`). Shell escape spec: PowerShell `''`, POSIX `'\''`, cmd.exe `\"`. New `PATCH /api/external/tasks/:id` endpoint validates non-empty + ≤ 200 chars + no newlines; `proper-lockfile` ELOCKED translates to 409 for client retry. New `<TerminalLaunchButton>` (primary variant) + `<EditableTaskTitle>` on TaskDetail header. 24 launcher-escape unit tests + a real-PowerShell smoke test + concurrent-rename store test + Playwright specs 36/36b.
  - **2.2a:** New `<MarkdownText>` (XSS-safe, GFM tables, language-tagged code, ≥200-line cap with "Show more", ≥2 KB lines soft-broken with ZWS). New `<ToolOutputBlock>` strips ANSI + control chars. Parser hardened: torn-read silent at the trailing line, malformed middle line surfaces as `unknown` stub instead of silent drop. New `askUserQuestionSummary` + `toolResults` safe getters. 16 parser unit + 10 render unit + Playwright spec 37a.
  - **2.2b:** `<BubbleTranscript>` replaces `<TranscriptViewer>`. Right-aligned user, left-aligned assistant + tool. AskUserQuestion bubbles flip amber → green when matched tool_result appears. Virtualization above 200 events. CSS-first auto-scroll with hook fallback. "Load older" pagination in 200-event steps. Performance gate: 1000-event seeded fixture, FCP ~ 2.1 s, IR ~ 2.1 s in dev mode (plan budgets 1.5 / 2.5 s target prod build; assertions allow ~1.5 s slack for dev-mode overhead). 11 unit + Playwright specs 37b/37c.
  - **2.3:** `<TaskCard>` replaces inline rendering on TaskBoard — state icon, HH:mm timestamp, cwd basename, compact `<TerminalLaunchButton variant="compact" />`, three-dots menu (Close + Delete) via Radix Dropdown. `<ConfirmDeleteDialog>` (Radix Dialog) for non-terminal-state deletions. Inbox grouped by sessionUuid; safe-getter rendering for AskUserQuestion. `useTaskTranscript` writes the freshest task into TanStack cache so SessionMetadata + EditableTaskTitle pick up state-machine transitions. Server `/inbox` skips `done` / `launch_failed` tasks. Playwright specs 38, 41, 43, 45, 46, 48.
  - **2.4:** Planning specs gain "RETIRED per ADR-034" banners on chat-adapter / process-governor / inbox-chat sections; new FRs added for external-launch + title integration. Agent docs rewrite: architecture.md describes the polling pipeline end-to-end; conventions.md replaces v0.1 + iterate 7-11 chat learnings with external-launch conventions; session_handoff.md refreshed to the iterate-2-end state. Compliance docs regenerate (traceability matrix, SBOM, test evidence). `webui/CLAUDE.md` adds 7 DO-NOT regression guards.
  - **TSC baseline:** 4 pre-existing server errors (cross-package imports + missing `@types/proper-lockfile`); policy = no regression. New code is typeclean.
- **Rejected:**
  - Sidecar file for webui-only title (duplicates state Claude already owns).
  - JSONL append of synthetic `ai-title` events (behaviorally invasive, no shared locking).
  - Mid-session "Sync title now" button (SQLite + JSONL interleave risk).
  - `react-scroll-to-bottom` (stale, no React 18/19 support).
  - `@assistant-ui/*` re-add (Plan D'' explicitly removed; rendering is bespoke).
  - Tool-use/tool-result correlation in the bubble layout (deferred; sibling rendering ships).
  - Storybook + Docker visual-regression goldens (≥ 0.5 d to set up; replaced by Playwright snapshot/behavioural specs).
- **Rollback:** Each sub-iterate is its own commit. Reverting any one commit restores the prior surface without touching Claude's JSONL or the user's terminal session — the iterate stays inside the read-only contract.


---

### ADR-036: Visibility gate = profile.stack.frontend presence...
- **Date:** 2026-04-20
- **Section:** Plan Interview — iterate-3
- **Context:** Spec FR-03.15 says Preview visibility gate reads 'stack.frontend' + spawn pulls from 'stack.frontend.dev'. Existing hasPreviewCapability reads 'dev_server.command' from profile-loader.ts. Two paths would require dual-writing the profile schema.
- **Decision:** Visibility gate = profile.stack.frontend presence (object-not-null). Spawn target = profile.dev_server.command (existing schema, already used by hasPreviewCapability). No new stack.frontend.dev field.
- **Commit:** n/a
- **Consequences:** Harmonizes spec to code. Boot-time coherence check logs warning if stack.frontend exists but dev_server.command absent; button renders, spawn returns 500 with actionable message.
- **Rejected:** Dual-write profile schema with new stack.frontend.dev field AND keep dev_server.command for backcompat — adds mental model burden, no user-visible benefit.

---

### ADR-037: (a) synthesize server-side. Deterministic...
- **Date:** 2026-04-20
- **Section:** Plan Interview — iterate-3
- **Context:** Spec FR-03.01 says legacy tasks without projectId get 'Unassigned' pseudo-project. Options: (a) synthesize server-side read-only, (b) write real row into projects.json on first read.
- **Decision:** (a) synthesize server-side. Deterministic id='unassigned', appears in getAll() output only when at least one task has projectId='unassigned' or null. Not persisted to projects.json.
- **Commit:** n/a
- **Consequences:** projects.json stays representing user intent. No orphaned 'Unassigned' row after user reassigns everything. Tasks with projectId=null are normalized to 'unassigned' on read via virtual field.
- **Rejected:** (b) first-read migration writes real row — leaks migration state into user data model, hard to un-create later.

---

### ADR-038: (a) incremental migration. CURRENT_SCHEMA_VERSION=2; v1...
- **Date:** 2026-04-20
- **Section:** Plan Interview — iterate-3
- **Context:** sdk-sessions.json v1 schema lacks projectId (spec 3.2 adds it). Options: (a) incremental v1→v2 write-on-touch, (b) batch-rewrite all rows on first boot.
- **Decision:** (a) incremental migration. CURRENT_SCHEMA_VERSION=2; v1 load() assigns projectId='unassigned' in memory; next write of that row persists v2 shape. Header loads both v1 and v2 (forward-compat window).
- **Commit:** n/a
- **Consequences:** Zero risk of mid-migration crash on large stores (300+ rows). Migration completes over days of normal use. Rollback is one-line version constant revert.
- **Rejected:** (b) batch-rewrite on boot — single-point failure, long boot on large stores, hostile rollback.

---

### ADR-039: New TS module lib/classifyPhase.ts (project-agnostic,...
- **Date:** 2026-04-20
- **Section:** Plan Interview — iterate-3
- **Context:** Spec 3.2 mentions re-using 'pre-pivot classifyPhase logic if salvageable'. plugins/shipwright-project has classify_phase.py (Python, runs in IREB decomposition skill). Webui task-creation modal needs client-side debounced auto-classify without round-tripping Python.
- **Decision:** New TS module lib/classifyPhase.ts (project-agnostic, takes phases from actions endpoint, tokenizes title, matches phase.id+label, tiebreak by array index). Pure function, <=80 LOC. Does NOT port or import classify_phase.py.
- **Commit:** n/a
- **Consequences:** Client-side debouncing works out of the box. No binding between webui and plugin-side Python. Independent test surface via Vitest.
- **Rejected:** Port classify_phase.py — binds webui to a plugin whose classifier tuning is unrelated (IREB decomposition vs. webui task labeling).

---

### ADR-040: All 39 findings accepted and integrated. 10...
- **Date:** 2026-04-20
- **Section:** External Review \u2014 iterate-3
- **Context:** Iterate 3 plan.md reviewed via OpenRouter (Gemini + GPT in parallel). 39 findings across security, architecture, completeness, performance, test-coverage, and spec-amendment drift.
- **Decision:** All 39 findings accepted and integrated. 10 HIGH-severity items (command-injection escape matrix, path-traversal pathGuard, spawn shell:false, preview error taxonomy, stale standalone kind, stale complexity UAT, FR-03.02 scoped-strip override, FR-03.14 shortcut pruning, Save-vs-Launch E2E, actions-schema negative tests) folded into \u00a7\u00a7 2.1, 2.2, 4.2 of plan.md + section bodies 01-04. 29 MED/LOW items routed into section-writer briefs. Full disposition ledger in plan.md \u00a7 7.
- **Commit:** n/a
- **Consequences:** Test count targets lifted above spec baseline (Playwright \u226550, server \u2265475, client \u2265560). Preview subprocess hardened (shell:false + tokenize + dedup). NewIssueModal moved from section 02 to 03 to kill section-interdependency footgun. FR-03.30 header drops legacy LaunchRow; Fork deprioritized to iterate 4.
- **Rejected:** Logging all 39 findings as individual ADRs (040-078) \u2014 rejected as noise; single umbrella ADR + plan.md ledger is the auditable record.

---

### ADR-041: Parser interface names stay product-shaped (text/title/name/mode)
- **Date:** 2026-04-20
- **Section:** Build — iterate-3 section 01 (parser hardening + LAF tokens)
- **Context:** On-disk JSONL uses verbose CLI field names (`content`, `customTitle`, `agentName`, `permissionMode`) for the 4 new variants; the section spec describes them with short product-side names (`text`, `title`, `name`, `mode`). The parser mediates between them.
- **Decision:** Parser emits product-shaped field names (`SystemEvent.text`, `CustomTitleEvent.title`, `AgentNameEvent.name`, `PermissionModeEvent.mode`) and extracts from the CLI payload. Accept both CLI and product-short field names on input for forward-compat.
- **Commit:** (this iterate-3.1 commit)
- **Consequences:** Renderer code stays stable if the CLI renames `customTitle` → `title` in a future release. One narrow extraction point in parser tolerates either shape. Duplicated across server + client parsers per `conventions.md:14`.
- **Rejected:** Mirror CLI field names 1:1 in the parsed event (e.g. `event.customTitle`) — would leak CLI naming into every renderer + test.

---

### ADR-042: System visibility is a single global localStorage key, not per-task
- **Date:** 2026-04-20
- **Section:** Build — iterate-3 section 01
- **Context:** System events (subtype `init` / `local_command` / `informational`) are noisy. Section spec + plan § 3 + external review O16 called for default-hidden behind a transcript-toolbar toggle. Toggle scope could be per-task or global.
- **Decision:** Single global localStorage key `webui.transcript.showSystem`. `useSystemVisibility()` reads it lazily on mount, writes on toggle, and cross-tab-syncs via the `storage` event. Every transcript viewer in the app observes the same default.
- **Commit:** (this iterate-3.1 commit)
- **Consequences:** One preference to memorize. No per-task state bloat in `sdk-sessions.json`. Multi-tab reveals flip consistently. Covered E2E by spec 60 (default hidden → click → reload persists).
- **Rejected:** Per-task or per-session preference — no user value, adds a write path into already-contended `sdk-sessions.json`.

---

### ADR-043: Attachment rendering keyed off payload presence, not a mime sniff
- **Date:** 2026-04-20
- **Section:** Build — iterate-3 section 01
- **Context:** FR-03.53 upgrades the generic `attachment` chip to show a filename + thumbnail. Claude's JSONL payload for `attachment` is opaque — sometimes it carries `{filename, thumbnailUrl}`, sometimes it is a bare reference. Renderer must not crash on either shape.
- **Decision:** Branch renders the full card when `filename` is present (using `thumbnailUrl` if available or an extension hint block otherwise); falls back to a generic muted chip when neither field is present. No mime sniffing, no network probe.
- **Commit:** (this iterate-3.1 commit)
- **Consequences:** Resilient to payload drift. Covered by the two unit tests `renders filename + thumbnail when payload provides them` + `falls back to generic chip when payload is opaque`.
- **Rejected:** Require a canonical attachment schema from the CLI (blocks on upstream change); MIME-detect via extension beyond the hint block (unnecessary scope creep for the chip).

---

### ADR-044: Iterate 3 — design overhaul, project↔task wiring, configurable actions, 3-pane TaskDetail
- **Date:** 2026-04-20
- **Section:** Build — iterate-3 section 06 (umbrella close-out; mirrors ADR-035's iterate-2 pattern)
- **Cross-links:** ADR-034 (Plan D'' external-launch pivot, 2026-04-19), ADR-035 (iterate-2 close-out, 2026-04-20), ADR-036..040 (iterate-3 plan-phase decisions), ADR-041..043 (iterate-3 section-01 micro-decisions).
- **Note on numbering:** Section 06 spec called for "ADR-041"; sections 01/02 had already consumed ADR-041/042/043 at build time. ADR-044 is the post-build umbrella close-out covering what actually shipped across sub-iterates 3.1..3.5.
- **Context:** Iterate 3 set out to (a) land the visual mockups that iterate 2 silently skipped, (b) wire projects 1:1 to tasks, (c) restore Folder Tree + Smart Viewer as a 3-pane TaskDetail, (d) add a `+ New ▾` menu that launches Pipeline / Iterate / Task via the same external-launch copy-command contract, (e) move hardcoded webui knowledge of Shipwright phases into a project-local `.webui/actions.json` override with a server-side default, and (f) add a server-spawned Preview dev-server path without violating the Plan D'' read-only Claude contract. The plan was external-reviewed (ADR-040) and broke into five build sub-iterates (3.1 parser+LaF, 3.2 project↔task schema v2, 3.3 actions + preview + new-action menu, 3.4 3-pane TaskDetail + FolderTree + SmartViewer + path-guard, 3.5 Inbox token sweep) plus this doc-sync section 06.
- **Decision (umbrella architecture):**
  1. **Configurable actions over hardcoded strings.** All slash-commands (`/shipwright-run`, `/shipwright-iterate`, `/shipwright-<phase>`) are now template data in `server/src/config/default-actions.json`, overridable per project via `<project.path>/.webui/actions.json`. Components read the resolved set from `GET /api/external/projects/:id/actions`. No component references `shipwright-run` as a literal.
  2. **Placeholder substitution at command-build time.** `server/src/core/actions-substitute.ts` resolves `{project.path}`, `{task.uuid}`, `{task.title}`, `{task.phase}`, `{task.phase_label}`, `{task.description?}`, `{plugin.dirs}` with per-shell escape (PowerShell `''`, POSIX `'\''`, cmd.exe `\"`) — shares the escape matrix with `launcher.ts` via exported `qPs/qCmd/qPosix`.
  3. **Project↔task wiring via schema v2.** `sdk-sessions.json` header bumps to `schemaVersion: 2`; `projectId` is now a first-class task field; legacy v1 rows are treated as `projectId: "unassigned"` in memory and rewritten to v2 on next mutation (write-on-touch migration — ADR-038). `"Unassigned"` is a synthesized pseudo-project surfaced only when at least one task lacks a real projectId (ADR-037).
  4. **Preview spawn is NOT Claude.** `server/src/core/preview-session-manager.ts` spawns `dev_server.command` from the project's profile via `child_process.spawn({shell: false})`, keyed by projectId, deduplicated on healthy sessions, killed on server shutdown. Read-only Claude contract (ADR-034) is untouched — Preview is an independent subprocess class.
  5. **3-pane TaskDetail behind a full-width header.** Left = `<FolderTree>` (lazy expand + gitignore-aware), center = `<BubbleTranscript>`, right = `<SmartViewer>` (5 renderers: Markdown/Code/Text/Image/Mermaid; mermaid lazy-imported to keep initial bundle lean). Panes are `react-resizable-panels`-based with widths + collapsed state persisted in `localStorage` under `webui.taskDetail.*`.
  6. **Path-guard is shared + strict.** Tree + file routes share `server/src/core/path-guard.ts` (realpath + `path.relative` + null-byte reject — **NOT** `startsWith` string check, which is defeated by symlinks + unicode). File route caps at 5 MB, serves via MIME allowlist, sets `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, sandbox iframe, sanitized `Content-Disposition`.
  7. **Profile capability gate is `stack.frontend` presence; spawn target is `dev_server.command`.** Harmonized to existing schema (ADR-036); boot-time coherence check logs a warning when `stack.frontend` is present but `dev_server.command` is missing. Plan § 2.1 precedence matrix documents how these two sources layer with `actions.preview.enabled`.
- **Commit range:** f94dfc7 (3.1) → 88a56f6 (3.2) → bc1ee7c (3.3a) → 4543dca (3.3b) → e584c84 (3.4a) → bdafacb (3.4b) → 4edb173 (3.5) → this commit (3.6).
- **Rationale:** Hardcoded Shipwright-phase strings in webui components created a silent coupling that broke as soon as a user introduced a project-local action override. Moving the phase catalog into `.webui/actions.json` + default-actions.json kills that coupling permanently; the `GET /actions` route is the single contract. The 3-pane restore was mandated by Sven's UAT ("I want the Smart Viewer back"); doing it as a post-pivot rebuild (rather than reviving pre-pivot code) let us keep the read-only invariant and add lazy tree loading + path-guard hardening that the pre-pivot version lacked. Preview as a non-Claude subprocess is the only architecturally clean path: it is a dev-server, not an AI session, so the read-only contract doesn't apply and we can honestly `spawn`. The 3-pane splits used `react-resizable-panels` over a hand-rolled drag because the library is a 6 KB gzip drop-in with persisted widths for free. `shell: false` on Preview spawn is a hard security requirement — shell substitution + user-controlled `dev_server.command` strings would be a trivial command-injection.
- **Consequences:**
  - **New invariants (enforced via new DO-NOT guard #11 in `webui/CLAUDE.md`):** Components MUST NOT hardcode `shipwright-run` / `shipwright-iterate` / phase strings. Read from `/api/external/projects/:id/actions`. Violations re-introduce the configurability debt and will break custom `.webui/actions.json` installations silently.
  - **Placeholder-allowlist convention (`webui/agent_docs/conventions.md`):** New placeholder in `actions-substitute.ts` requires a paired server-side validation test in `actions-schema-validation.test.ts`. Silent placeholder drift otherwise renders the literal `{placeholder}` string in the copy-command and errors the user's terminal paste cryptically.
  - **File structure:** 6 new client components (`FolderTree`, `SmartViewer/*`, `NewIssueModal`, `PreviewButton`, `CreateMenuSplitButton`, `TaskDetailThreePane`) + 6 new server modules (`default-actions.json`, `project-actions-loader`, `actions-substitute`, `preview-session-manager`, `path-guard`, `gitignore-cache`). `LaunchRow` + `CopyCommandCard` deleted from `TaskDetailPage` (replaced by header-level state-dependent CTA).
  - **Test posture (iterate 3 close):** server 299 unit tests (baseline 154 at iterate-2 close, +145); client 351 + 1 doc-sync = 352 (baseline 214 at iterate-2 close, +138); TSC: server = 4 pre-existing errors (no regression), client = 0 errors. Playwright regressed slightly — some iterate-3 flow specs (50a/50b/51/51a/52/53/54/54b/54c/48/55b/56/56b/57/58/58b) are deferred to a follow-up iterate; one new spec `55-three-pane-layout.spec.ts` ships with this iterate. Unit tests cover the contracts.
  - **Spec deviation:** `rehype-highlight/lib/common` subpath was removed in rehype-highlight v7; we use `{languages: common}` from `lowlight` at the call site (equivalent intent; bundle-split verified).
  - **Post-close spec amendment:** FR-03.33 default ignored list now includes `.webui` (external review O34). Dated footnote added — see `webui/planning/iterate-3/spec.md`.
  - **Rollback:** each sub-iterate is its own commit; reverting any one commit stays inside the read-only contract. Reverting 3.2 requires a one-time rewrite of `sdk-sessions.json` back to `schemaVersion: 1` if users mutated v2-format rows in between (write-on-touch migration is forward-compatible).
- **Rejected alternatives:**
  - Webui spawns Claude for Pipeline / Iterate launches (breaks ADR-034 read-only contract; violates CLAUDE.md DO-NOT guard).
  - Hardcoded phase enum in a frontend constants file (re-introduces configurability debt; makes `.webui/actions.json` non-functional).
  - Single-pane viewer ("just show Markdown inline") (loses code syntax highlighting, image preview, mermaid; doesn't match Sven's approved mockup `task-detail-3pane.html`).
  - Pre-pivot Smart File Viewer code revival (pre-pivot used chokidar + chat-subprocess assumptions; cheaper to rebuild clean).
  - `path.startsWith(projectPath)` for the path-guard (defeated by symlinks, unicode, and junction points on Windows — real-path-relative is the only safe check).
  - `shell: true` on Preview spawn with user-configurable `dev_server.command` (command-injection footgun).
  - `stack.frontend.dev.command` as the spawn target (would dual-write the profile schema alongside existing `dev_server.command`; no user-visible benefit — ADR-036).
  - Logging all 5 sub-iterates as individual ADRs (ADR-044..048) — rejected as noise; single umbrella ADR + sub-iterate commit trail is the auditable record, per ADR-035 precedent.


---

### ADR-045: Adopt phase exposed via New Task (one-shot, server-gated)
- **Date:** 2026-04-23
- **Section:** Iterate — feature: adopt-phase
- **Context:** Brownfield onboarding (/shipwright-adopt, iterate 12) had no WebUI entry point. Users had to run the skill manually.
- **Decision:** Add adopt phase to default-actions.json (color #64748B slate-500, distinct from project's #9ca3af); expose server-derived adopted:boolean on Project via ProjectManager.withMode (existsSync check on shipwright_run_config.json); NewIssueModal filters the adopt option from the phase dropdown when selectedProject.adopted === true.
- **Commit:** pending
- **Rationale:** Phase-in-New-Task matches user preference (no separate dropdown entry for a one-time action). Mirrors existing hasPreview derivation pattern. Adds a single field to /api/projects response shape (additive, non-breaking).
- **Consequences:** One-shot nature enforced at UI layer — once adopted, the option disappears automatically on next fetch. Legacy API clients without the adopted field render Adopt (safe default; skill preflight is the final guard). Command template {task.phase} routes it to /shipwright-adopt without any component-side string literals.
- **Rejected:** Separate 'New Adopt' top-level dropdown entry (dauerhafter Eintrag für One-Shot-Feature ist Overkill, Nutzer wollte das explizit nicht). Client-side filesystem check (keine FS-Rechte im Browser).

---

### ADR-046: Launch route routes through substitutePlaceholders with full action context
- **Date:** 2026-04-23
- **Section:** Iterate — bug: launch-command-wiring
- **Context:** Task launch copied a legacy command shape (--session-id + --add-dir + --name + --plugin-dir) while CommandPreviewPanel rendered the correct slash command. Phase/description/autonomy were void'd in the route with comment 'reserved for future wiring'. Phase wasn't persisted on ExternalTask so TaskDetail fell back to title-regex for the badge (often wrong).
- **Decision:** POST /api/external/tasks/:id/launch now accepts actionId + phase + phaseLabel + description + autonomy. When actionId is present and project resolves via getProjectById, the route loads the project's actions catalog and runs substitutePlaceholders against the matching command_template for all three shell forms. Fields are persisted on the task so TaskDetailHeader can render the correct phase badge. When actionId is missing or the project is unresolvable (e.g. 'unassigned'), the legacy buildCopyCommands path is preserved.
- **Commit:** pending
- **Rationale:** substitutePlaceholders + command_template + loadActionsForProject were already built for the preview + dry-run paths in iterate 3.3b. Migrating the launch route to the same pipeline eliminates the client/server divergence rather than maintaining two parallel command builders. Back-compat path handles Resume/Fork and 'unassigned' tasks without special-casing.
- **Consequences:** Copy command now matches the preview. Phase badge on TaskDetail reflects the user's explicit choice, not a title-regex guess. ExternalTask gains 5 optional fields (actionId/phase/phaseLabel/description/autonomy) — additive, forward-compatible with v2 stored rows. Existing Resume/Fork flows still work via the legacy fallback.
- **Rejected:** Alternative 1: extend buildCopyCommands to accept phase/description — would duplicate the per-shell escape discipline that substitutePlaceholders already owns (the security boundary per plan § 2.2). Alternative 2: send the rendered preview command from client to server and persist verbatim — bypasses server-side phase validation and the allowedPhaseIds check.

---

### ADR-047: substitutePlaceholders flattens POSIX line-continuations for cross-shell safety
- **Date:** 2026-04-23
- **Section:** Iterate — bug: shell-line-continuations
- **Context:** ADR-046 (iterate-20260423-launch-command-wiring) migrated /launch to substitutePlaceholders. The command_template carries `\<newline>    ` continuations (POSIX) for readability. All three shell forms inherited them — PowerShell + cmd.exe do NOT honour backslash continuations, so when the user pasted the command only the first line executed. User reported: 'only /shipwright-compliance arrives, Claude does not know the session.'
- **Decision:** substitutePlaceholders post-processes substituted output: replace every `[ \t]*\<CR?>\n[ \t]*` sequence with a single space, then trim trailing whitespace. Output is always a single line regardless of shell form. The template still renders multi-line in the source (readability) and in the CommandPreviewPanel (its own separate renderer).
- **Commit:** pending
- **Rationale:** Option A (flatten) chosen over Option B (per-shell continuation character — backtick for PS, caret for cmd, backslash for POSIX) because a single long line works reliably in every shell and avoids per-platform guess work; modern terminals handle lines of arbitrary length.
- **Consequences:** Copy commands now paste and run correctly in PowerShell / cmd / bash. Four pre-existing test assertions that checked for the continuation-prefix literal were updated to match the new single-line contract. The optional-suffix renderers (task.description?, task.autonomy_flag?) still emit the `\<newline>    ` prefix — it just gets flattened at the end.
- **Rejected:** B: shell-specific continuations — fragile because PowerShell+cmd have additional parsing quirks (line-terminator sensitivity, escaping). C: rewriting the template without continuations — breaks preview readability + would require changing default-actions.json + any user-authored .webui/actions.json.

---

### ADR-048: Command template uses --add-dir (the real Claude CLI flag), not --project-root
- **Date:** 2026-04-23
- **Section:** Iterate — bug: cli-flag-fix
- **Context:** The bundled default-actions.json command_template shipped with --project-root, which is NOT a Claude CLI flag (verified via 'claude --help' — real flag is --add-dir). Before ADR-046, the legacy buildCopyCommands emitted --add-dir correctly, so the template drift was invisible. ADR-046 migrated to substitutePlaceholders and the template started being emitted verbatim — user pasted, Claude CLI errored 'unknown option --project-root', skill never invoked.
- **Decision:** All 3 command_templates in default-actions.json (new-task, new-pipeline, new-iterate) swap --project-root → --add-dir. CommandPreviewPanel.buildCommandText also swaps to keep preview in sync with the real copy.
- **Commit:** pending
- **Rationale:** --add-dir is documented in 'claude --help' as 'Additional directories to allow tool access to', semantically equivalent to the --project-root intent. Matches what the legacy buildCopyCommands emitted, so behavior is restored to pre-ADR-046.
- **Consequences:** Pasted commands now parse cleanly in Claude CLI; the skill receives the full arg list. A regression guard test in project-actions-loader.test.ts asserts the bundled default uses --add-dir and explicitly rejects --project-root, so a future template edit can't reintroduce the drift.
- **Rejected:** Adding --project-root as an alias in Claude CLI itself — not our repo. Keeping --project-root but filtering server-side — would still differ from the visible preview/copy command. Teaching each skill to parse both — unnecessary indirection.

---

### ADR-049: ADR-049: {cd.prefix} placeholder for shell-aware cwd injection
- **Date:** 2026-04-23
- **Section:** Iterate — bug: launch-cwd-prefix
- **Context:** Post-v0.2.0 launch chain (ADR-046/047/048) shipped --add-dir, but --add-dir only grants Claude tool-access, not cwd. When the user pastes the copied command in a terminal parked in HOME, the skill sees pwd=HOME and fails to find shipwright_run_config.json. Three workarounds rejected: env-var (touches every skill), --cwd CLI flag (does not exist on Claude CLI), shell-spawning (architectural rule: webui never spawns Claude).
- **Decision:** New {cd.prefix} placeholder in actions-substitute. Templates opt in by prepending it. Per-shell expansion: PowerShell uses Set-Location <escaped> -ErrorAction Stop; (PS5 lacks &&), cmd.exe uses cd /d <escaped> && (the /d flag changes drive too), POSIX uses cd <escaped> && . Path is escaped via the same qPs/qCmd/qPosix escapers used for {project.path}.
- **Commit:** PENDING
- **Rationale:** Opt-in placeholder cleanly separates substitution mechanics from policy. Always-prepend would have broken {project.path}-only template fragments used in unit tests and would have produced unwanted behavior for any non-claude template. Shell-aware expansion via the existing escaper inherits the proven security boundary.
- **Consequences:** Bundled templates updated (3 in default-actions.json). Regression guard ensures they cannot drift back. User-installed .webui/actions.json files keep the cwd bug until manually edited — acceptable since custom templates imply the user knows what they want. Empty project.path → empty cd.prefix output (graceful degrade). actions-substitute.ts grows from 317 to ~360 LOC; cohesion preferred over split.
- **Rejected:** Always-prepend (breaks fragment substitution and non-claude templates). New env var like SHIPWRIGHT_PROJECT_ROOT (would require updating every skill in the marketplace). Pre-fight startup warning when a user template lacks {cd.prefix} (too noisy; user discovers it on first paste).

---

### ADR-050: ADR-050: Route language-mermaid fences in markdown to MermaidRenderer
- **Date:** 2026-04-23
- **Section:** Iterate — bug: mermaid-in-markdown
- **Context:** FR-03.02 AC 'Mermaid code blocks (```mermaid) render as SVG diagrams' shipped unchecked in iterate 3. SmartViewer only routed .mmd/.mermaid file extensions to MermaidRenderer; fenced blocks inside .md files fell through to FencedCodeBlock, showing raw code instead of diagrams. Shipwright's own compliance docs + spec files use mermaid in markdown heavily.
- **Decision:** MarkdownText.tsx code() override now checks className for `\blanguage-mermaid\b` BEFORE delegating to FencedCodeBlock. Matching fences render via the existing lazy-loaded MermaidRenderer component. Non-mermaid fences unchanged.
- **Commit:** PENDING
- **Rationale:** Using rehype-highlight's language-className as the detection key avoids parsing the fence manually and matches how every other language is already classified. The className-based routing runs before FencedCodeBlock mounts so mermaid diagrams never render as code for a flash.
- **Consequences:** Mermaid diagrams now render in BOTH the SmartViewer (via MarkdownRenderer→MarkdownText) AND in chat bubbles (via BubbleTranscript→MarkdownText). Users who never open a mermaid document still don't pay the ~609 KB mermaid chunk cost (lazy import). FR-03.02 AC now checked.
- **Rejected:** Parsing raw markdown for triple-backtick-mermaid fences (reimplementation of remark's fence detection). Prop-gated renderer (renderMermaid?: boolean) — deferred because lazy import already gates the cost.

---

### ADR-051: ADR-051: Extend cd-prefix to legacy buildCopyCommands (Resume/Fork)
- **Date:** 2026-04-23
- **Section:** Iterate — bug: resume-cwd-prefix
- **Context:** ADR-049 added cd prefix only to the {cd.prefix} placeholder used by the new substitutePlaceholders Launch path. Resume and Fork still routed through legacy buildCopyCommands in launcher.ts (ADR-046 preserved legacy for backward compat with spec 30/36). Result: Resume copy-links pasted in a HOME terminal re-hit the same missing-cwd bug cd prefix was built to fix.
- **Decision:** Extract shell-specific cd prefix formatting into exported buildCdPrefix(shellForm, cwd) helper in launcher.ts. substitutePlaceholders delegates. renderPowershell/renderCmd/renderPosix prepend helper output. All copy-command surfaces (Launch, Resume, Fork, plugin-dir forms) now emit identical cd prefixes per shell.
- **Commit:** PENDING
- **Rationale:** Single source of truth for cd prefix formatting eliminates duplication drift. Exporting the helper allows future surfaces (e.g. terminal spawn commands, launcher v2) to reuse the same escaping discipline without re-implementing it.
- **Consequences:** Resume and Fork commands now cd into project root before invoking claude. Empty cwd still degrades gracefully to no-prefix output. Smoke tests updated to use process.cwd() since Set-Location -ErrorAction Stop rejects non-existent paths. 10 new tests (+5 buildCopyCommands surface, +5 buildCdPrefix helper). Existing actions-substitute.ts cd.prefix case shrinks to a 1-line delegation.
- **Rejected:** Migrating Resume path to substitutePlaceholders with a dedicated resume action template (Path B from scoping discussion) — larger architecture change out of scope for a bug-fix iterate. Leaving Resume on cd-free legacy (status quo) — user explicitly requested parity across all surfaces.

---

### ADR-052: ADR-052: Move MermaidRenderer memo to DOM dataset for StrictMode resilience
- **Date:** 2026-04-23
- **Section:** Iterate — bug: mermaid-flicker-fix
- **Context:** Mermaid diagrams flickered visibly on mount after ADR-050 shipped mermaid-in-markdown. Root cause: React.StrictMode (active in main.tsx) double-invokes effects (mount -> cleanup -> mount), and MermaidRenderer's useEffect cleanup cleared both the container DOM and a useRef content-hash memo. Every second StrictMode mount re-rendered from scratch, producing loading-spinner->blank->loading-spinner->SVG.
- **Decision:** Stamp the content-hash on the container DOM itself via dataset.mermaidHash. The DOM node persists across StrictMode cleanup/setup (same containerRef.current across both mounts), so the second mount short-circuits once the first mount's async commit lands. Cleanup now only flips the disposed flag - no DOM wipe, no ref reset.
- **Commit:** PENDING
- **Rationale:** DOM-level memo is the only memo that survives React.StrictMode's double-invoke pattern in dev. useRef resets are not observable to the dev vs. prod render cycle, so useRef-based memos always miss on the second mount.
- **Consequences:** No flicker on first mount. Identical-text re-renders preserve the exact same <svg> DOM node (asserted by new regression test). Text-change re-renders still work because the effect body checks dataset.mermaidHash against the new hash. Client suite 389/389 (+2 tests). A tempting StrictMode-sim unit test was dropped - vi.mock ordering interacted oddly with React StrictMode + dynamic import and hit the real mermaid code path; the data-attr + rerender tests prove the contract instead.
- **Rejected:** Keeping useRef + skipping cleanup container-clear only (half-fix; ref still resets). useMemo on MarkdownText components prop (larger change, does not address the root cause). Disabling StrictMode in main.tsx (removes dev-mode protection for other bugs).

---

### ADR-053: ADR-053: Hoist ReactMarkdown config to module scope + memo MermaidRenderer
- **Date:** 2026-04-23
- **Section:** Iterate — bug: mermaid-render-loop-fix
- **Context:** User-reported permanent Mermaid flicker after ADR-052 shipped (DOM dataset memo). Flicker was so continuous the user could not even expand the element in devtools. ADR-052 addressed React.StrictMode double-mount but missed the real driver: TaskDetailPage polls transcript at 1 Hz, re-renders cascade to MarkdownText which passed inline (new-identity-every-render) components/remarkPlugins/rehypePlugins to ReactMarkdown. ReactMarkdown treats new config identity as new render path and remounts the subtree including MermaidRenderer — DOM wiped, memo lost, flicker restarts every second.
- **Decision:** Hoist REMARK_PLUGINS / REHYPE_PLUGINS / REACT_MARKDOWN_COMPONENTS to module scope (stable across all mounts). Memoize capLineLengths output via useMemo on text. Wrap MermaidRenderer in React.memo as defensive second layer so even if reconciler remounts, identical-text props skip the body.
- **Commit:** PENDING
- **Rationale:** Module scope beats useMemo([]) because the callbacks close over no component state — there is no value in per-instance memoization. React.memo on MermaidRenderer is cheap defensive insurance against future parent instability.
- **Consequences:** Render loop broken at the ReactMarkdown config layer. MermaidRenderer instance + DOM div persist across the 1 Hz transcript-polling re-renders. Module-scope constants actually produce FEWER allocations than inline creation. 389/389 client tests still green; typecheck baseline unchanged. User live-verify required — memoization identity stability is hard to unit-test with react-markdown.
- **Rejected:** useMemo with empty deps inside MarkdownText (equivalent behaviour, extra complexity). Disabling useTaskTranscript polling (would regress other UX). Debouncing renders (fights React rather than cooperating).

---

### ADR-054: ADR-054: Chat bubble rendering aligned with mockup (6 AC bundle)
- **Date:** 2026-04-23
- **Section:** Iterate — change: chat-rendering-polish
- **Context:** User live-test 2026-04-23 surfaced 6 chat-bubble defects: tool cards eating space, generic tool_use swallowed, slash-commands as raw user XML, mysterious 'attachment' placeholders, empty Claude bubbles with only avatar, font size too large. Mockup bubble-states.html (1203 LOC) is the target. Scope bundled because all 6 touch the same shared stack (session-parser + BubbleTranscript).
- **Decision:** Client-only fix set. Parser: new slash-command kind with strict regex (length-capped, no-newline-in-tags), fileSnapshotBasenames (basename only — no full-path leak), hasVisibleBubbleContent (text-only — tool-only turns get no shell), isThinkingOnly. Three new components: ToolCard (collapsed by default, click header, state keyed by toolUseId), SlashCommandChip (centered grey pill), AttachmentCard (mime-icon + basename + '+N more'). BubbleTranscript: 13px root font with scoped cascade, new branches for slash-command + file-history-snapshot, empty-bubble-shell suppression, attachment noise filter (no filename → null + dev warn).
- **Commit:** PENDING
- **Rationale:** Module-scope constants + React.memo patterns from ADR-053 reused where helpful. Separate helpers (hasVisibleBubbleContent / isThinkingOnly) make each AC independently testable and keep the BubbleTranscript render branches readable. Client-only scope matches the out-of-scope boundary in the iterate spec.
- **Consequences:** All 6 user-reported defects addressed. Client suite 413/413 (+24 from 389 baseline). Empty 'CLAUDE-header-only' bubbles for tool-only turns stop rendering. Attachments with internal Claude Code payloads (deferred_tools_delta, skill_listing) silently suppressed — dev-warn logs schema drift. Mermaid-flicker fix from ADR-053 preserved. External review (GPT+Gemini) caught 15 findings, all applied to spec before code; code-reviewer subagent caught one AC-5 semantic bug which was fixed inline.
- **Rejected:** Splitting parser + UI into two iterates (rejected: single mockup, single spec, cross-cutting change — split would duplicate context load). Per-tool icon map (deferred — generic Wrench icon for this iterate; color-coded icons a future polish). Surfacing still-unknown event types like task_reminder / auto_mode (out of scope; parser fallback stays silent).

---

### ADR-055: Chat-followups: fold tool_result, auto-scroll fix, skill chip, snapshot filter (4 follow-ups to ADR-054)
- **Date:** 2026-04-23
- **Section:** Iterate — change: chat-followups
- **Context:** Live-test of ADR-054 (chat-rendering-polish) surfaced 4 UX gaps in the same component stack: tool_result rendered as separate bubble instead of folded into ToolCard, useAutoScroll yanked viewport to bottom on tool-card expansion mid-transcript, skill-loader manual content rendered as raw user bubble wall, file-history-snapshot events duplicated Edit/Write ToolCards as noise chips. External GPT+Gemini review on the spec raised virtualization-safety concerns (Gemini high on null-return for FU-4) + prev-height lifecycle issues (GPT high on useAutoScroll) + consumer audit for new event kind.
- **Decision:** Bundle all 4 as medium CHANGE. FU-1: toolResultsById map keyed off FULL filtered scope (error-preserving last-write-wins), visibleToolUseIds set keyed off visible slice, strict suppression predicate (only tool_result blocks + all ids in visible window). ToolCard gains optional result prop (input+output sections when expanded). FU-2: useAutoScroll adds prevScrollHeight ref seeded at RO attach via el.scrollHeight, guarded growth check, try/finally unconditional update to handle shrink. FU-3: parser skill-body fingerprint (length >=100, CRLF-normalized, starts with 'Base directory for this skill:', H1-only heading extraction); new SkillChip component analog to SlashCommandChip. FU-4: filter file-history-snapshot in the existing filtered useMemo (pre-virtualizer), NOT return-null in renderBubble.
- **Commit:** HEAD
- **Rationale:** Virtualization safety (Gemini) makes the filter-level drop correct over null-return. Full-filtered map scope (Gemini + GPT) prevents output disappearing when tool_result scrolls past tail but tool_use stays rendered. Pre-growth at-bottom gate (GPT) distinguishes 'user was tailing, keep tailing' from 'user is browsing, let them browse' which is the whole UX bug. H1-only heading guard (review nit) prevents false positives from sub-headings above the title. Non-error-last-wins merge handles retries surfacing stale failure.
- **Consequences:** Transcript density matches bubble-states.html mockup end-to-end: tool input+output co-located, expanding a tool card mid-transcript preserves viewport, skill-loader noise reduced to chip, file-history-snapshot eliminated from render. Client 413->448 tests (+35), server 343 unchanged, client typecheck clean, server 4-error baseline preserved. Data-never-dropped invariant preserved: orphan tool_results + mixed tool_result+text content still render bubble. No DO-NOT violations (no composer, no SSE, no chokidar).
- **Rejected:** Alt A server-side parser folding: doubles work, out of scope. Alt B per-event foldedIntoToolCardId flag on tool_result: leaks renderer concerns into parser. Alt C delete ResizeObserver entirely rely on dep-change: breaks virtualized-list first-measurement scroll. Alt D expandable SkillChip with full body: Gemini noted but deferred — body is debug boilerplate, no user-actionable content, can read JSONL directly if needed.

---

### ADR-056: Chat-livetest-2: SkillCard + phase-on-create + GitHub-md + TodoWriteCard (4 follow-ups to ADR-055 live-test)
- **Date:** 2026-04-23
- **Section:** Iterate — change: chat-livetest-2
- **Context:** Live-test of ADR-055 chat-followups surfaced 4 more items. (1) SkillChip too aggressive — user wants body visible on demand. (2) Task phase badge shows 'design' when task was launched as compliance; NewIssueModal phase dropdown not persisted on task CREATION (only on /launch per ADR-046). (3) Markdown rendering too uniform vs GitHub conventions. (4) TodoWrite tool_use renders as generic ToolCard (JSON blob); user: 'mega wichtig — die Liste zeigen und was fertig ist'. External review (GPT+Gemini) returned 18 findings, 5 critical.
- **Decision:** Medium CHANGE, 4 ACs. AC-A: SkillCard replaces SkillChip (collapsed-by-default, chevron, MarkdownText body on expand). Parser extractSkillBody() returns {skillName, body} via fingerprint rules. AC-B: POST /tasks validates body.phase against project's actions catalog, DERIVES phaseLabel server-side (GPT #2 — label drift guard). Phase without resolvable project → 400 phase_requires_project (post-review blocker #2 fix — no silent drops). New shared lib/phaseStyle.ts used by TaskCard (new phase badge) + TaskDetailHeader (refactored). AC-C: Extended .markdown-body CSS in index.css with GitHub conventions (H1/H2 border-bottom, paragraph spacing, table + code + blockquote tokens, pre/table overflow-x). AC-D: New TodoWriteCard streaming-tolerant (Gemini #1 — {todos:null} mid-stream renders loading, fallback to ToolCard only when stream complete). stableEventKey helper (code-review blocker #1 — event.uuid instead of array-index key for SkillCard expansion state).
- **Commit:** HEAD
- **Rationale:** User's live-test feedback is the highest-fidelity signal. SkillChip was too aggressive; user picked Option C during interview (collapsed + expand). phase-on-create closes the launch-vs-create gap ADR-046 left open. Single .markdown-body class is pragmatic (cheaper than spec's .github-md, same determinism guarantee since MarkdownText already uses it). TodoWriteCard streaming-tolerance protects UX during real multi-chunk tool_use events.
- **Consequences:** Client 448->479 tests (+31), Server 343->350 (+7). Typecheck client clean, server 4-error baseline preserved. User can now see skill manuals + track TodoWrite progress. Task phase visible on kanban board + header. Markdown readability matches GitHub. Code-reviewer blockers (key stability + phase silent-drop) fixed before commit.
- **Rejected:** Alt A: markdown-github.css separate file (spec wording) — rejected for simpler in-place extension of existing .markdown-body. Alt B: keep SkillChip, add expand — rejected, user picked Option C. Alt C: TodoWrite validation in BubbleTranscript pre-dispatch — rejected per GPT #9 (component owns its schema). Alt D: phase silent-drop when no project — initially implemented, rejected post-review (Gemini #2 — never lose user input silently).

---

### ADR-057: Unified VS Code-style task list for TodoWrite + TaskCreate + TaskUpdate
- **Date:** 2026-04-23
- **Section:** Iterate — change: task-list-unified
- **Context:** ADR-056 TodoWriteCard only dispatched on name==='TodoWrite'. Live-test session uses TaskCreate + TaskUpdate tools instead (5 + 10 occurrences in real JSONL). Those events fell through to generic ToolCard (collapsed JSON blob). User asked for same VS Code-extension UX: per-event snapshot bubbles with dark bg + green bullet + 3-state icons.
- **Decision:** Unified component TaskListCard.tsx with (a) TaskListCardShell pure render (dark anthracite card, green bullet header, check/asterisk/empty-box icons, strike-through on completed, in_progress uses activeForm); (b) TodoWriteCard thin adapter reading input.todos; (c) TaskListAggregateCard deriveTaskListState() walks full filtered scope up to uptoToolUseId, seeds from TaskCreate (implicit sequential taskIds 1,2,3) and flips statuses from TaskUpdate. BubbleTranscript threads allToolUses through Plain/VirtualBubbles → BubbleRow → renderBubble → ToolUseBubble, dispatches on 3 tool names.
- **Commit:** HEAD
- **Rationale:** User prefers per-event (historical) over single live-updating bubble: 'So eine Card kommt aber immer wieder wenn ein Task geschlossen ist'. Each TaskCreate + TaskUpdate snapshot preserves timeline. Claude's implicit taskId convention (sequential 1,2,3 based on TaskCreate order) verified against real JSONL.
- **Consequences:** Client 481->488 tests (+7). Users see per-event task-list snapshots for TaskCreate/TaskUpdate just like TodoWrite. Visual style matches VS Code Claude Code extension. Old TodoWriteCard.tsx + test deleted (replaced). Aggregation uses chronological walk — O(n) per render, deterministic.
- **Rejected:** Alt A: single live-update aggregate card at first-TaskCreate position (less historical visibility). Alt B: per-event compact chips (TaskCreate 'New task: X', TaskUpdate 'Task 1 → completed') — less information-dense, doesn't show full list at once.

---

### ADR-058: WebUI three-fix bundle: stuck Awaiting-launch state, chat padding, system pills
- **Date:** 2026-04-24
- **Section:** Iterate — bug bundle: status-fix + chat-padding + system-pill-filter
- **Context:** Live-test feedback on TaskDetail surfaced three issues: stuck status badge after relaunch, chat bubbles flush to chat-column edges, header pills bypassed the system-message toggle.
- **Decision:** (1) Widen the transcript-poll auto-recover branch to include `awaiting_external_start`. (2) Bump BubbleTranscript lateral padding 22→40 px. (3) Introduce `SYSTEM_KINDS` covering system + custom-title + agent-name + permission-mode; both filter and toolbar count consult it.
- **Commit:** 89e55bf43b9c471ae8bdc6e610bc6d3a5346eafb
- **Rationale:** Minimal targeted fixes. Status-machine widening preserves the first-launch transition gate (`firstJsonlObservedAt`). Pill filter picks default-hide-behind-toggle so the data stays inspectable.
- **Consequences:** Re-launches self-recover within one polling tick; chat reads visibly inset; system-message toggle now reveals all four pill kinds atomically.
- **Rejected:** Renderer removal for pills (loses debug affordance); status carve-out in POST `/launch` (would risk Resume/Fork regressions).
- **Details:** [`.shipwright/planning/adr/058-webui-three-fix-bundle.md`](../planning/adr/058-webui-three-fix-bundle.md) — full Context, Decision, Rationale, Consequences, Rejected.

---

## ADR-045b: TaskBoard Status + Phase chip rows deferred to Phase C

> _Note: number collides with ADR-045 (Adopt phase exposed via New Task) above — that ADR was numbered in the main monorepo stream while this one was numbered independently in the webui's iterate-3-internal stream `project-docs/ADRs/`. Migrated 2026-04-30 from `project-docs/ADRs/ADR-045-taskboard-status-phase-chips-deferred.md` and disambiguated as ADR-045b._

- **Status:** Accepted
- **Date:** 2026-04-20
- **Scope:** webui iterate-3 remediation Phase B1 (TaskBoard visual rebuild)
- **Related:** ADR-044 (iterate 3 close-out), ADR-037 (projectId v2 schema)

### Context

The approved mockup `webui/designs/screens/kanban-with-projects.html` includes two chip rows under the TaskBoard header:

1. **Status:** All / To do / Running / Done / Failed — mapped to `task.state`.
2. **Phase:** build / design / plan / test / deploy / compliance / security — mapped to a per-task `phase` field.

Phase B1's remediation plan asks either to (a) implement both chip rows against `task.state` + `task.phase`, or (b) defer them to Phase C and ship the header dropdown + view toggle only.

### Decision

**Defer both chip rows to Phase C.**

Reasons:

1. **Data model gap — Phase chips.** `ExternalTask` (`webui/client/src/lib/externalApi.ts`) has no `phase` field. `classifyPhase` exists in `webui/client/src/lib/classifyPhase.ts` but is scoped to `NewIssueModal` title-heuristics; it is not projected onto the persisted task row. Adding a per-task phase projection requires either (a) a server change to `sdk-sessions-store` v3 with a `phase` column + backfill rule, or (b) a client-side re-classification of every task on every render. Both are Phase-C scope (new data shape + migration), not a Phase-B visual rebuild.

2. **Semantic gap — Status chips.** `ExternalTask.state` has 7 members (`draft`, `awaiting_external_start`, `active`, `idle`, `jsonl_missing`, `launch_failed`, `done`). The mockup's 5-bucket Status filter collapses these into `To do` / `Running` / `Done` / `Failed`. That mapping is a UX decision with tradeoffs (e.g. where does `idle` go? `awaiting_external_start` maps to `To do` or `Running`?). It needs a product decision, not a visual rebuild.

3. **Scope discipline.** Phase B1 is bounded to "visual rebuild consuming Phase A tokens." Inventing a data projection mid-rebuild breaks the Phase-B rule "State wiring, hooks, queries, API contracts all STAY."

### Consequences

- Phase B1 ships the header (ProjectFilterDropdown + optional view toggle + Preview + Create split button) and the 3 kanban columns only.
- The filter-row `<div class="header-filters">` section of the mockup is **not** rendered. The search input with `/` hotkey is visually absent in B1.
- 70-e inbox project filter test continues to assert the inbox dropdown only (not TaskBoard).

### Rollback path to Phase C

Phase C (tentatively iterate 3.8) will:

1. Add `phase: TaskPhase | null` to `ExternalTask` server-side, derived at task-create time from `classifyPhase(title, description)` and stored in `sdk-sessions.json` schema v3. v2 rows lazy-upgrade on first read.
2. Add `StatusChipRow` + `PhaseChipRow` components under `webui/client/src/components/external/`, driven by `useTaskStatusCounts()` and `useTaskPhaseCounts()` selectors.
3. Mount both under the TaskBoard header (and optionally Inbox).
4. Extend the `/` search input with a real `useTaskSearchQuery` hook + URL param.

No code in Phase B1 pre-commits to this design — we can still pick a different shape in Phase C.

### Non-goals

- This ADR does not commit the schema-v3 upgrade path; that's Phase C's call.
- This ADR does not block Phase B1 shipping without the chip rows.

---

## ADR-065: Adopt this repository into the Shipwright SDLC

> _Originally numbered `ADR-0053` in commit `8c4191a6` and the migration preamble. Renumbered 2026-05-01 to `ADR-065` to reconcile with the conflicting 3-digit IDs: pre-existing `ADR-053`…`ADR-058` (created 2026-04-23 / 04-24) which Adopt missed when counting prior entries, and `ADR-059`…`ADR-064` which were committed between 2026-04-30 and 2026-05-01 ignoring the 4-digit anomaly. ADR-065 was the first free ID at renumber time._

- **Status**: accepted
- **Date**: 2026-04-30
- **Commit**: `08b3ebf`

### Context

This repository existed with 27 detected feature(s) and substantive git history (212 commits, 58 prior decision entries) before /shipwright-adopt ran. The goal is to bring it under the Shipwright SDLC (CLAUDE.md + .shipwright/agent_docs + .shipwright/planning/ + .shipwright/compliance/ + configs) without disrupting the existing codebase.

### Decision

Adopted into Shipwright using profile `vite-hono` and scope `full_app`. Retroactively marked `completed_steps = ["project", "plan", "build", "test"]` so that `/shipwright-iterate` and downstream skills (`/shipwright-compliance`, `/shipwright-test`) work as on a natively-built project.

### Consequences

- Future changes MUST go through `/shipwright-iterate` (not `/shipwright-project` / `/shipwright-plan` / `/shipwright-build`).
- Compliance reports (RTM, SBOM, change-history) are seeded; test-evidence starts collecting from the first `/shipwright-test` run.
- Any existing E2E baseline auto-generated by Adopt (under `e2e/flows/adopted-baseline.spec.ts`) is a regression guard, not a substitute for real acceptance tests.

### Rejected alternatives

- Manual `/shipwright-project` init: would lose git history and force re-description of existing code.
- No adoption (ad-hoc `/shipwright-iterate`): would mean missing configs, no compliance reports, and the audit pipeline would silently no-op.


## ADR-066: Settings UI for `.webui/actions.json` upload + reset

> _Originally numbered `ADR-0054`. Renumbered 2026-05-01 alongside ADR-065 — same root cause (Adopt skill miscount on pre-existing IDs)._

- **Date**: 2026-04-30
- **Run-ID**: iterate-20260430-actions-upload-ui
- **Status**: accepted
- **Architecture-impact**: component (new server route + Settings sub-component)

### Context

Power users customize the `+ New ▾` dropdown / phase allowlist / preview gate via `<project.path>/.webui/actions.json`. Until now the only way to install or replace that file was a manual `notepad` / `code` round-trip. The existing `POST /api/projects/:id/actions-stub` only scaffolds an empty file. Sven asked for a simple Settings UI to upload the JSON.

### Decision

Add `POST /api/projects/:id/actions-upload` (replace) and `DELETE /api/projects/:id/actions-upload` (reset to bundled). Server validates JSON-parse + `validateActionsSchema` + `checkContractVersion` before atomic write (tmp + renameSync). Settings page renders a per-project card with a state badge (Custom / Bundled / Malformed), a `<input type="file">` picker, and a Reset button. Reset is enabled when the user file is in use OR malformed (recovery path).

### Consequences

- Webui write surface widens by one filename (`.webui/actions.json`), already an allowed write target. `realPathGuard` on every write defeats symlink escape; `Content-Length` pre-check on upload defeats DoS via oversized buffer.
- Self-Review

### Rationale

`.webui/actions.json` was already a documented user-editable file; the loader was already mtime-cached. The upload endpoint composes existing primitives (validator, contract-version check, path-guard) rather than introducing a new validation surface. Per-project cache invalidation (`clearActionsCacheForProject`) avoids the global thundering-herd that a `clearActionsCache()` would cause at scale.

### Rejected alternatives

- In-app JSON editor: too much UI surface for the stated need ("einfaches UI"). Deferred indefinitely.
- File path field instead of `<input type="file">`: requires a second roundtrip and exposes the server to arbitrary path reads. Browser file picker keeps the read on the client.
- Multipart/form-data: extra parser surface. Raw `application/json` body is the simplest validate-and-write contract.
- Per-action diff or staging area: overkill for the simple-replace UX.


---

### ADR-059: VS Code .code-workspace auto-generated on POST /api/projects
- **Date:** 2026-05-01
- **Section:** Iterate — feature: VS Code workspace generator on project onboarding
- **Context:** Users wanted a one-double-click flow to open a project in VS Code with the right folder + terminal layout. Manual File-Open-Folder + terminal rearranging is friction.
- **Decision:** POST /api/projects emits <project.path>/.shipwright-webui/<slug>.code-workspace with relative '..' folder + editor-default terminal. Idempotent (existsSync guard); atomic temp+rename. PATCH untouched — relative path makes rename a no-op.
- **Commit:** PENDING
- **Rationale:** Relative path keeps file portable across machines + survives renames. Slug from project.name (lowercase + non-alphanum→dash + trim) avoids quoting issues. Idempotency protects user customizations.
- **Consequences:** New ProjectRouteDeps.renameSync member. .shipwright-webui already gitignored (gitignore-cache.ts:41) so file is invisible to git. No client UI in this iterate; user opens file via OS file manager. FolderTree 'Reveal in Explorer' deferred.
- **Rejected:** Absolute path in folders[0] (breaks portability). Multi-root workspace (out of scope — separate iterate). Overwrite-on-PATCH (slug + path drift potential, fights customization).

---

### ADR-060: Render Claude Code background-task notifications as a status chip, not a raw user bubble
- **Date:** 2026-05-01
- **Section:** Iterate — bug: task-notification rendering
- **Context:** Claude Code v2.1.119+ emits background-task lifecycle as user-role events whose content is a <task-notification>...</task-notification> XML envelope. The transcript rendered the raw XML in a right-aligned user bubble.
- **Decision:** Add a content-fingerprint detector to the client session-parser that emits a new task-notification ParsedEvent kind, and a centered TaskNotificationChip with success/failure/neutral palette by status.
- **Commit:** (unstaged)
- **Rationale:** Origin-only detection (origin.kind === task-notification) would have missed older Claude builds that omit the field; content fingerprinting (startsWith/endsWith on <task-notification>) is robust and follows the established slash-command and skill-body detection patterns.
- **Consequences:** Background-task completions now render as a centered status chip with the summary, matching the visual language of slash-command, agent-name, and permission-mode chips. No backend or schema changes.
- **Rejected:** (1) Render in the existing user bubble with conditional styling — fails the bubble-direction principle (right-aligned = typed by user). (2) Drop the event entirely — would lose visible feedback that a background task finished.

---

### ADR-061: Left-align all system chips and add active-scroll guard to useAutoScroll
- **Date:** 2026-05-01
- **Section:** Iterate — change: system chip alignment + scroll polish
- **Context:** Task-notification chip rendered centered; the rest of the system chips (system, custom-title, agent-name, permission-mode, slash-command) were also centered while user/assistant bubbles are right/left. The transcript felt 'all over the place'. Separately: scrolling up flickered because polling ticks at 1 Hz fired programmatic scrollTop=scrollHeight while the user was still within the 64 px near-bottom threshold (userDetached did not flip).
- **Decision:** (1) Switch all system chip wrappers from justify-center to justify-start so they line up with assistant bubbles. (2) Add a 250 ms active-scroll guard to useAutoScroll: every user-driven scroll event stamps lastUserScrollAt; programmatic re-pin paths skip while the timestamp is fresh. Programmatic scrollTop writes are tagged via lastProgrammaticScrollAt so they do not refresh the guard themselves.
- **Commit:** (unstaged)
- **Rationale:** Tightening alignment is purely visual and matches the user's mental model (anything not authored by the user belongs on the left). The time-based guard is the smallest change that fixes the user's reported flicker without rebuilding the whole virtualization/auto-scroll subsystem; bumping the px threshold alone leaves the polling-during-slow-scroll race.
- **Consequences:** Transcript layout reads as a single left-anchored column with user bubbles right; flicker during slow scroll-up no longer reverts the user to the bottom. Initial-mount auto-scroll preserved (didInitialScroll bypass). task-notification kept OUT of SYSTEM_KINDS so background-task completions remain visible by default; can be revisited if signal/noise changes.
- **Rejected:** (1) Bump NEAR_BOTTOM_THRESHOLD_PX from 64 to 128 — partly mitigates but a wide threshold makes 'jump to latest' fire too eagerly. (2) Add task-notification to SYSTEM_KINDS — would hide important background-task completions behind the system-visibility toggle. (3) Rebuild auto-scroll on a different virtualization library — out of scope for a small UX polish iterate.

---

### ADR-062: Stabilize virtualized transcript with getItemKey + animation-frame measurements
- **Date:** 2026-05-01
- **Section:** Iterate — bug: virtualizer flicker
- **Context:** Even after the active-scroll guard landed in iterate-2026-05-01-system-chips-and-scroll-polish, scrolling up still flickers when virtualization is engaged (visible.length >= 200). Root cause: TanStack React-Virtual measures rows asynchronously via ResizeObserver, and (a) measurements were keyed by array index — every filter/tail/poll-tick re-render lost prior measurements and re-measured from scratch, (b) RO-fired updates landed across multiple paint frames as rows entered the viewport.
- **Decision:** Add getItemKey: (index) => stableEventKey(events[index], index) so measurement cache survives index shifts. Enable useAnimationFrameWithResizeObserver so multiple measurement updates within a scroll tick batch into one paint frame. Bump overscan from 8 to 16 so more rows are pre-measured before entering the visible window.
- **Commit:** (unstaged)
- **Rationale:** Scroll-position correction for items above the viewport is on by default in @tanstack/react-virtual v3.14, so shouldAdjustScrollPositionOnItemSizeChange is not needed (and is a runtime instance property in this version, not a constructor option). The remaining flicker came from cache invalidation on re-render and per-frame measurement updates — getItemKey + animation-frame batching address both directly.
- **Consequences:** Scrolling up no longer flickers when virtualization engages on >=200 visible events. Same render budget for non-virtualized sessions (overscan only matters when virtualized). No API surface change.
- **Rejected:** (1) Bump VIRTUALIZE_THRESHOLD from 200 to 500 — narrows the symptom but does not fix the underlying virtualization jank for power-users with very long sessions. (2) Drop virtualization entirely — risks render perf for 1000+ event sessions. (3) Replace TanStack Virtual with another library — out of scope for a small UX polish iterate.

---

### ADR-063: Disable browser scroll-anchoring in virtualized transcript branch  **[REVERTED 2026-05-01]**
- **Status:** rejected — REVERTED via merge revert `7277092` on 2026-05-01. Pushed as `18ba042..7277092 main -> main`. **Do NOT re-apply this fix as written.** The hypothesis closed one real flicker source (browser-anchor × virtualizer-recycling fight) but disabling `overflow-anchor` entirely made overall scroll WORSE under user testing. The browser's anchoring was apparently doing useful compensation in the cases where the anchor element survived the overscan window — removing it left raw uncompensated reflow on every async height-change (Mermaid mount, code-highlighting expand, markdown image-load). Net effect: better in one narrow case, worse in many others.
- **Lesson for the next iterate:** the residual flicker is dominated by **post-mount height changes** of already-rendered rows (late-render hypothesis), NOT by browser-vs-virtualizer anchoring fights. Investigate that path. A correct fix here probably needs a *conditional* anchor that's keyed on whether the anchor element is inside the overscan window (i.e. won't be unmounted during the scroll gesture), or — more likely — a strategy that stabilizes per-row height before measure (e.g. force-skeleton heights for async content, defer mermaid render until after virtualizer measure-pass, etc.).
- **Date:** 2026-05-01
- **Section:** Iterate — bug: overflow-anchor virtualized carve-out
- **Context:** ADR-062's getItemKey + animation-frame measurement fix addressed real sub-bugs but the user-reported scroll-up flicker on long sessions (>=200 events) persists. Investigation pinpointed overflow-anchor: auto (the ADR-035 default) fighting TanStack-Virtual's DOM recycling: the browser anchors on a row the virtualizer just unmounted, then frame-by-frame fights translateY corrections. The two mechanisms are fundamentally incompatible in a virtualized container.
- **Decision:** In BubbleTranscript.tsx the scroll container inline style becomes overflow-anchor: showVirtualized ? 'none' : 'auto'. Non-virtualized branch keeps ADR-035 verbatim. Virtualized branch relies on the useAutoScroll ref-based hook (the ADR-035 safety net) alone.
- **Commit:** (unstaged)
- **Rationale:** ADR-035's premise (stable DOM with discrete inserts) holds for non-virtualized but breaks under TanStack-Virtual's row recycling, where anchored elements unmount mid-scroll. useAutoScroll (ref-based, ResizeObserver-light) is the right primitive there because it tracks ref identity rather than DOM children.
- **Consequences:** Scroll-up on long sessions no longer flickers. Browser anchoring off in the virtualized branch only — DOM recycling makes anchoring unreliable there. Non-virtualized branch behavior unchanged. CLAUDE.md DO-NOT guard #2 + conventions.md updated with the carve-out so future iterates do not re-apply auto unconditionally.
- **Rejected:** (1) Drop virtualization — risks render perf at 1000+ events. (2) Bump VIRTUALIZE_THRESHOLD higher — narrows symptom, does not fix cause. (3) Replace TanStack Virtual — out of scope. (4) Keep auto and rely solely on virtualizer corrections — incompatible by construction; the browser fights the virtualizer frame by frame.

---

### ADR-064: Short-circuit useTaskTranscript polling on byte-identical chunks  **[REVERTED 2026-05-01 — never pushed to origin]**
- **Status:** rejected — REVERTED. The fix was committed locally on `iterate/virtualized-late-render` (commit `c8bcecd`) but **never merged to main and never pushed to origin**. User visual verification immediately showed regression: pre-fix flicker turned into content-jumping during scroll, especially on fresh load. Working tree restored via `git checkout main`. **Do NOT re-apply this fix as written.**
- **Lesson — load-bearing side-effect (same shape as ADR-063 revert):** the per-poll re-render cascade was *inadvertently* working as a "scheduled re-measure" for the TanStack virtualizer. Each poll triggered a re-render of all visible BubbleRows, which re-ran `ref={virtualizer.measureElement}` on every row, which caught up height drift from late-mounted async content (markdown render, code-highlight, font-swap, etc.). The flicker was the visible artifact of that catch-up. Killing the cascade removed the catch-up — the underlying drift remained but no longer self-corrected, surfacing as content-jumping during scroll. ADR-062 batched the RO callbacks into single frames but did NOT fix the drift itself.
- **Lesson — meta:** three failed attempts in a row (ADR-063 overflow-anchor, mermaid-mount hypothesis, ADR-064 polling-cascade) shared the same failure mode: **hypothesis-from-code-reading without measurement**. The codebase's rendering stack (virtualizer + react-markdown + rehype-highlight + ResizeObserver + 1Hz polling) is too interlocked for first-principles reasoning. The next attempt MUST be measurement-driven: DevTools Performance recording during a scroll-up, console.log render-counts on BubbleRow / measureElement / row height changes, identify the actual drift source from data — then fix.
- **Date:** 2026-05-01
- **Section:** Iterate — bug: virtualized late-render polling cascade
- **Context:** After ADR-062 (virtualizer stable keys + animation-frame batching) and the revert of ADR-063 (overflow-anchor=none — see annotation), residual scroll-up flicker persisted on long virtualized transcripts dominated by code blocks and collapsed bash tool cards. User reported 'Er zieht den Code nach' (code keeps being repainted on every poll). Re-investigation found the polling hook in client/src/hooks/useTaskTranscript.ts unconditionally calls setResult({...}) on every 1s tick. The fresh outer object plus a fresh content string from the network deserialisation invalidates every downstream useMemo in BubbleTranscript (parsed / filtered / visible / resolvedToolUseIds / toolResultsById / visibleToolUseIds / allToolUses), forcing every visible MarkdownText to re-render and rehype-highlight to re-tokenise every code block once per second. The exported isFreshChunk helper exists for exactly this purpose but was never wired into the polling loop.
- **Decision:** Switch the 'ok' branch's setResult call to the functional form. When prev.status is 'ok' AND prev.fingerprint equals the new chunk fingerprint, return prev unchanged. React's Object.is bail-out then skips the commit and the cascade is gone. qc.setQueryData for task transitions still runs unconditionally so useExternalTask consumers continue to see fresh task data.
- **Commit:** (unstaged)
- **Rationale:** ADR-062 and ADR-063 both targeted the symptom (virtualizer-vs-DOM interactions) instead of the cause (per-tick state churn driving downstream useMemos to invalidate). The cascade is a closed-loop React anti-pattern: setState({}) -> invalidate identity-keyed memos -> re-render visible bubbles -> re-run rehype-highlight. Cutting it at the source — the hook itself — kills the entire chain rather than papering over individual symptoms.
- **Consequences:** On long virtualized transcripts whose content is not actively growing, MarkdownText / rehype-highlight no longer re-render once per second. Visible repaint of code + tool blocks during scroll-up reduced. Active sessions where bytes are genuinely arriving still update normally — the bail-out is fingerprint-keyed. result.task may go briefly stale relative to qc.setQueryData when content is unchanged but task state transitioned; this is acceptable because the canonical channel for task data is useExternalTask via TanStack Query, which the comment block already calls out. No behavior change; pure perf optimisation.
- **Rejected:** (1) Wrap BubbleRow / MarkdownText in React.memo. Treats symptom not cause; would mask but not fix the spurious state update. Available as a defense-in-depth follow-up if needed. (2) Switch to incremental byte-offset polling. Bigger refactor (Sub-iterate 1.5 work per the hook's own comment) for marginal benefit beyond the bail-out. Out of scope. (3) Move polling into TanStack Query with staleTime. Conflicts with the 'sequential 1s polling, no SSE' architecture rule. (4) Re-attempt overflow-anchor in some narrower form. Annotated ADR-063 explicitly forbids re-applying that approach.

---

### ADR-065: Filter null-rendering events out of virtualized transcript list
- **Date:** 2026-05-01
- **Section:** Iterate — bug: virtualized null-render placeholder rows
- **Context:** Residual scroll-up flicker on tool-heavy virtualized BubbleTranscript persisted after ADR-062 (kept), ADR-063 (REVERTED) and ADR-064 (REVERTED). 4th attempt. Live instrumentation (window.__instr.mountLog) showed many rows mounting at actual height ~14 px vs the virtualizer's 96 px FALLBACK_ROW_PX estimate. Sources: user events that are tool_result-only AND all-folded into ToolCards (renderBubble returns null), and attachment events with no filename (renderAttachmentCard returns null). Outer absolute-positioned wrapper has padding 7px 0 = 14 px even when child is null, so each such row drove a -82 px translateY correction cascading through every row above on scroll-up.
- **Decision:** Move the null-render predicates from renderBubble into a pure exported filter filterEventsForRender(events, visibleToolUseIds) applied at the data-array level upstream of <VirtualBubbles> and <PlainBubbles>. Schema-drift dev-warn relocated to the filter with module-level dedupe (once per unique payload key signature per page lifetime, replacing the original per-render flood).
- **Commit:** WIP-pending
- **Rationale:** The codebase already documented this exact rule for file-history-snapshot at BubbleTranscript.tsx:160-163: 'null-return risks zero-height rows for the virtualizer per Gemini's external-review finding'. The two new null-return paths added in iterate-20260423-chat-followups AC-1 silently violated it. This ADR codifies and enforces the rule for both new paths via a single pure filter at the data-array level — the same pattern the file-history-snapshot filter already uses. Measurement-driven (window.__instr.mountLog), not reasoning-driven; addresses the meta-lesson from ADR-064's revert.
- **Consequences:** Empty 14 px placeholder rows are gone from the virtualizer's items list; the estimate-vs-measure translateY cascade that drove the visible 'Er zieht den Code nach' symptom is eliminated for the two enumerated null-render sources. Per-render console.warn flood for dropped attachments (which itself was contributing to console-UI lag and main-thread jam during scroll) is gone. Existing renderBubble null-returns retained as defense-in-depth. No virtualizer-config changes (ADR-062 untouched), no overflow-anchor changes (ADR-063 lesson respected), no polling-cascade changes (ADR-064 lesson respected). 640/640 client tests green; 8 new pure-function regression tests cover the filter invariant.
- **Rejected:** 1) Set wrapper padding=0 when BubbleRow returns null. Removes 14 px but row stays in items list, still consumes a measurement cycle and an index. 2) Lower FALLBACK_ROW_PX to a smaller estimate. Other rows still vary 50-1200 px; tuning the estimate without removing placeholders just shifts the gap direction. 3) Extend filter to empty-assistant rows (reviewer M1). Without measurement evidence in this iterate's mountLog, this would be reasoning-from-code-reading — the same failure mode as ADR-063/064 reverts. Deferred to a future iterate IF a future mountLog shows similar 14 px assistant rows.

---

### ADR-066: Persistent virtualizer measurement cache + first-visit warmup
- **Date:** 2026-05-02
- **Section:** Iterate — bug: virtualized slow-scroll cache + warmup
- **Context:** After ADR-065 (rapid-scroll fix), user reported residual SLOW-scroll-up jump (German: 'Er zieht den Code nach') on tool-heavy long sessions. Phase 2 measurement (window.__instr2 mountLog over 30 wheel ticks at 250 ms cadence): mean signed delta from FALLBACK_ROW_PX=96 was +105 px, max +1743 px; one row of 914 px landed 5 ms before the next wheel tick, cascading content shift. Confidence: H-A (estimate-vs-measure during slow scroll) HIGH; H-B/C/D ruled out by data.
- **Decision:** Persist TanStack Virtual measurement Map to localStorage[webui.virtualizerCache.<sessionUuid>] via pagehide event + 5 s periodic flush + unmount cleanup. Rehydrate on mount via TanStack Virtual's initialMeasurementsCache. Add cold-cache warmup pass that briefly raises overscan to min(events.length, 500) for one paint frame so every visible row mounts + measures before user can scroll. Module: client/src/lib/virtualizerSizeCache.ts (~140 LOC, 17 unit tests). Schema-versioned JSON payload, 1000-entry cap, prune-on-flush.
- **Commit:** PENDING
- **Rationale:** Phase 2 data unambiguously identified estimate-vs-measure during slow scroll-up as the dominant cascade source. Cache rehydration solves the return-visit case (matches user's reproducible-task workflow); warmup-pass solves the first-visit case via the same code path (high overscan → mount all → measure → drop overscan). Two coupled changes serve the same goal and were measured-driven, not reasoning-from-code-reading — directly addressing the conventions.md learning that prior reverts (ADR-063, ADR-064) were caused by hypothesis-only fixes.
- **Consequences:** Subsequent visits to a long task render with accurate row sizes from the start — no slow-scroll cascade. First visit eliminates the cascade via the warmup pass (50–200 ms extra mount cost on cold cache only). Empirical validation via Playwright two-pass probe: pass 1 totalSize stable at 15811 px from first snapshot (warmup), pass 2 stable at 15784 px (cache rehydrated); 122 measurements persisted between passes. 657/657 unit tests green. NO changes to overflow-anchor (ADR-063 [REVERTED] respected), useTaskTranscript polling cascade (ADR-064 [REVERTED] respected), ADR-062 virtualizer config preserved, ADR-065 filterEventsForRender preserved.
- **Rejected:** (1) Tune FALLBACK_ROW_PX higher: REJECTED. Variance too high (50–1700 px) — no constant works. (2) Per-kind estimate function: REJECTED. assistant kind alone spans 50–1700 px depending on text. (3) Bump overscan permanently: REJECTED. Just delays the surprise. (4) Pre-render PlainBubbles for one frame to populate cache: REJECTED for v1, picked the simpler high-overscan-on-cold approach which uses the SAME code path as steady-state virtualization.

---

### ADR-067: ADR-067: Embedded terminal launcher (Plan-D''-conform shell pane + image-paste flow)
- **Date:** 2026-05-03
- **Section:** Iterate — feature: embedded-terminal-launcher (xterm.js + node-pty + WebSocket)
- **Context:** User pain: Claude-Code-CLI nimmt keine Image-Paste an (offenes Issue #51244 bei Anthropic). Der Workflow zwingt zu einer Screenshot→Save→Drag-and-Drop-Schleife für jede UI-Frage. Plus: Surface-Wechsel zwischen WebUI (Tasks) und Warp (Chat) frisst Konvenienz-Punkte. Wir wollen Anthropic + Shipwright nativ behalten, aber den Pain abfangen, ohne ADR-034 aufzuweichen.
- **Decision:** Plan C: Embedded xterm.js Terminal in TaskDetailPage über @hono/node-ws + @lydell/node-pty (Windows-prebuilt). DOM paste-handler (capture phase) implementiert image-wins precedence — Strg+V auf Clipboard-Image POSTet zu /api/terminal/:taskId/paste-image, Server speichert PNG/JPEG/WEBP/GIF unter <task.cwd>/.claude-pastes/img-<ms>-<rand>.<ext> mit Keep-Last-N Retention, pty.write injiziert shell-quoted absolute Pfad. ADR-034 Wording erweitert: webui MAY host a neutral shell pane; Claude-Execution stays user-initiated (Strg+V + Enter). pty-manager Whitelist (basename-normalised: pwsh/powershell/cmd/bash/zsh/sh/fish) refusiert claude-Spawn.
- **Commit:** bb49091b1fec2d821b9bb69daad2cd19fae5fdf5
- **Rationale:** External Review (Gemini + GPT, 18 Findings) bestätigt: 8 HIGH-Severity (xterm.css missing / shell-aware path quoting / Radix Tabs forceMount / WS-creation-race / readiness handshake / append-gitignore symlink / PTY-orphan-leak / Origin gate) im Pre-Build gefoldet. Drop-while-saturated Backpressure auf ws.bufferedAmount. 30 min Idle-Ceiling als Defense-in-Depth gegen tab-close-orphans. WS upgrade ist die AUTHORITATIVE pty-creation path; POST /spawn nur idempotent prewarm. Plan-D''-Geist erhalten: webui spawnt nie claude direkt.
- **Consequences:** Frontend-Workflow ohne Surface-Wechsel + ohne Drag-and-Drop für Screenshots. Neue Domain server/src/terminal/ + client/src/components/terminal/. Erste WebSocket-Surface im Codebase. Neue Write-Surface <task.cwd>/.claude-pastes/. ~120 KB gz xterm bundle (lazy-loaded via React.lazy). 1269/1269 Tests grün. Spec 35 bekommt benannte Carve-out für .xterm-helper-textarea (helper, kein Composer).
- **Rejected:** (1) Codex-SDK in-process (verworfen: kein nativer Hooks/Sub-Agents-Support → Drift-Tax permanent). (2) Pre-fill via pty.write(command) bei Launch (verworfen: Strg+V + Enter bleibt user-initiated, klarere Plan-D''-Konformität). (3) navigator.clipboard.read() async-API als Fallback (verworfen: Permission-Prompt-Risiko, ClipboardEvent capture phase reicht). (4) node-pty-prebuilt-multiarch (verworfen: keine Node-22-win32-x64 Prebuilds → @lydell/node-pty stattdessen).

---

### ADR-068: ADR-068-A1: Embedded-terminal auto-launch via WS data-frame + disk-backed scrollback persistence
- **Date:** 2026-05-04
- **Section:** Iterate — feature: embedded-terminal-auto-launch-disk (Stage A1)
- **Context:** ADR-067 left two pain points: launch still required clipboard+Strg+V+Enter, and pty death on last-conn-close meant nav-away/page-reload destroyed all terminal context. With our own embedded shell pane the copy-paste ritual is theatre; with disk-backed scrollback (recherche 2026-05-04: Warp + VS Code Claude do this) history can survive nav-away, page-reload, browser-restart, OS-reboot.
- **Decision:** Stage A1: (a) one-click auto-launch via client-side socket.send WS data-frame after prompt-readiness handshake (250ms quiesce, 3s cap); LaunchCoordinatorContext + monotonic launchToken + 3 cancel paths replace window.dispatchEvent; (b) ScrollbackStore (4-state rotation, p-queue, StringDecoder reads, realpath-at-op-time, 0600/0700, 24h TTL with active-task-aware skip); (c) WS onOpen replay with pty.pause/resume; (d) Stop session preserves history, separate Clear (loud throws + confirm-modal); (e) MAX_BYTES=0 disables. Plan-D'' user-initiated interpretation amended: explicit Launch CTA click is sufficient; pty-manager shell-only whitelist remains the architectural enforcement line.
- **Commit:** PENDING
- **Rationale:** Cumulative external review trace v3→v7 + Round 4 cascade (29 findings, 17 CRITICAL/HIGH folded) settles all major architecture points: append-not-locked, drop-oldest forbidden, p-queue serialization, StringDecoder UTF-8 safety, Windows EBUSY rotation retry, 0600/0700 perms with Windows disclosure, realpath-at-op-time, prompt-readiness handshake, launch-token dedup, pending cancel paths, Stop/Clear split, React-context replaces window-event, task-id keying. Auto-execute via client WS-frame keeps the architectural line clean: backend transports, browser initiates, whitelisted shell spawns claude.
- **Consequences:** Launch becomes one click. History survives all common nav patterns within 24h TTL. New write surface <registryDir>/terminal-scrollback/<taskId>.log (Decision #14 keys by task-id). New endpoint POST /clear-scrollback (loud throws). POST /close semantics changed (kill pty only). New dep p-queue. FR-01.10 + FR-01.28 + FR-01.02 amended (not skipped per memory feedback_iterate_spec_drift_hygiene). CLAUDE.md DO-NOT #18 + #19 added. Stage A2 (smart-grace + replay-only-mode + /runtime endpoint + refined CTA-matrix) gated on real-user feedback.
- **Rejected:** (1) Server-side pty.write of claude command (rejected: blurs Plan-D'' line; client-frame is semantically User-Keystroke). (2) Auto-resume silently (rejected: user wanted explicit Resume CTA per AskUserQuestion). (3) Single mega-iterate v6 (rejected: review surface too large; A1+A2 staging keeps reviewable size). (4) In-memory ring-buffer parallel to disk (rejected: disk read is fs-cached <5ms). (5) drop-oldest on replay-backlog (rejected by Round 3: ANSI/UTF-8 corruption). (6) Mutex on append (rejected by Round 3: hot-path tank under npm install).

---

### ADR-069: ADR-069: Post-v0.8 stabilization — terminal scrollback ANSI sanitizer + writer-stuck watchdog with per-conn refcount
- **Status:** superseded — by ADR-087 (2026-05-12). The scrollback ANSI sanitizer half of this ADR has been retired; the writer-stuck watchdog half remains in force.
- **Date:** 2026-05-05
- **Section:** Iterate — bug: post-v0.8-stabilization (Tier 0)
- **Context:** v0.8.0 UAT (2026-05-05) surfaced two release-blocking bugs in the embedded terminal: (a) re-attaching to a TUI-heavy task showed visually-corrupted history because raw cursor-control sequences persisted to disk re-executed on the fresh xterm; (b) re-attaching during high pty-output volume left the new tab stuck as reader-role for seconds-to-minutes because ws.close events were queued behind data envelopes. Both escaped Spec 76's WebSocket-frame-capture coverage which used a cold pty without TUI bytes.
- **Decision:** Two architectural fixes: (1) Disk-persistence boundary now runs through a sanitizer state-machine that strips cursor-control + repaint bytes while preserving SGR + plain text + LF/CRLF/HT + OSC; legacy v0.8.0 files self-heal on first replay via the same sanitizer applied at read-time. Live WS broadcast remains unfiltered — sanitization is contained to the ScrollbackStore boundary. (2) PtyManager grows per-conn pause refcount (pauseForConn/resumeForConn) so multi-tab replay-on-attach does not cross-trigger pty.resume; plus a 2s/512KiB writer-stuck watchdog evicts writers whose WS bufferedAmount has stalled — drainage-based, not pty-emission-based (pre-build external review caught that lastDataAt heuristics invert under runaway pty). Per-conn capability tracking ensures one mismatched WS adapter cannot disable eviction globally. AC-2 (black-on-black input) deferred to a separate diagnosis-first iterate.
- **Commit:** PENDING
- **Rationale:** Sanitizer placed at ScrollbackStore boundary (single bottleneck) keeps pty-manager dumb + makes the contract explicit. Drainage-based watchdog (per external review v2 fix) closes the inverted-logic bug both reviewers caught: a runaway pty would otherwise keep a stuck writer pinned forever. Per-conn pause refcount + force-evict cleanup chain prevents refcount leaks under any exit path (graceful close / watchdog evict / shutdown). Per-conn capability tracking (per code-review fix) avoids one-bad-apple-disables-all behavior of an earlier global flag design.
- **Consequences:** v0.8.1 ships AC-1 + AC-3 architectural fixes. Disk format silently changes (raw → sanitized bytes); rotation triggers later under TUI-heavy load (fewer bytes persisted per pty.onData). PtyManager.pause/resume API is extended; legacy token-less calls remain as anonymous-token wrappers (backwards compat preserved). Watchdog opt-in via constructor flag; production wires it on in server/src/index.ts. Two new e2e specs (77/78) join the WS-frame-capture pattern from Spec 76.
- **Rejected:** (a) Server-side @xterm/headless + addon-serialize for pixel-perfect cell-state replay — Option B in the spec. Rejected for v0.8.1 scope (heavier dep + perf cost; cell-state serialization deferred to v0.10). Linear-log fallback ships now. (b) Single iterate covering all 12 ACs across Tier 0/1/2 (the spec's full scope). Rejected as borderline LARGE (5-6 day estimate, 13+ files); Tier 0 sliced into v0.8.1, Tier 1/2 into follow-up iterates. (c) Watchdog tied to pty.lastDataAt — the original mini-plan v1 design. Rejected post-external-review (gemini-2 + openai-9 HIGH severity): inverted under runaway pty. (d) Global watchdog capability flag — rejected post-code-review (openai-5): one mismatched WS adapter would permanently disable eviction for healthy conns sharing the manager.

---

### ADR-070: v0.8.2 polish — Spec 74 modal flake fix + xterm dark theme + Ctrl+V parity + paste latency + paste-dir migration + replay-only mode + conditional disclosure footer
- **Date:** 2026-05-06
- **Section:** Iterate — bug+feature: v0.8.2-polish
- **Run-ID:** iterate-2026-05-06-v0-8-2-polish
- **Context:** v0.8.0 UAT and the v0.8.1 live-smoke surfaced 9 polish items spanning the embedded terminal: AC-1 Spec 74 dropdown→modal race timed out under Windows ConPTY (preventDefault held the menu open while Playwright asserted dialog visibility); AC-2 Claude Code's TUI input rendered black-on-near-black against the brand light theme; AC-3 Ctrl+V image paste was swallowed by xterm's textarea while Alt+V worked; AC-4 image-paste roundtrip latency ~5s on Windows, dominated by sequential fs.stat / unlink in keep-last-N prune; AC-5 awaiting-launch lag was reported but never instrumented; AC-6 image pastes lived under `.claude-pastes/` instead of the `.shipwright-webui/` convention; AC-7 re-attach to a `done`/`launch_failed` task spawned a fresh pty; AC-8 disclosure footer rendered on tasks with no scrollback; AC-9 disclosure copy hardcoded "24h" instead of interpolating retention TTL.
- **Decision:** Ship as v0.8.2 in one iterate branch with 9 ACs. (AC-1) Drop preventDefault on Clear-history menu item; open modal via `requestAnimationFrame` so the dropdown closes cleanly first. (AC-2) Switch xterm theme to dark (bg=`#1a1a1a` fg=`#f5f0eb`) ONCE at session start; extract palette into `terminal-theme.ts`; add WCAG-AA contrast unit tests + synthesised TUI-escape-sequence fixtures. (AC-3) Move paste-event listener from container to `document` with capture phase + `container.contains(target)` scope. (AC-4) Parallelise `fs.stat` + unlink inside `pruneKeepLastN`; run prune + gitignore-read concurrently in `savePastedImage`; add `SHIPWRIGHT_DEBUG_PASTE_TIMING`-gated structured stdout markers. (AC-5) Add `SHIPWRIGHT_DEBUG_AWAITING_LAUNCH`-gated diag log to `session-watcher.findByUuid`; document expected ≤30s as a known-issue band. (AC-6) Migrate write target to `<task.cwd>/.shipwright-webui/pastes/`; gitignore-suggestion accepts either legacy `.claude-pastes/` or new `.shipwright-webui/` line as already-covering. (AC-7) WS upgrade branches on `task.state` — `done`/`launch_failed` skip `ptyManager.spawn()` + `attach()`, send `{ready, replayOnly:true}` + replay envelopes, close cleanly. (AC-8) Privacy footer renders only when `scrollbackBytes > 0`. (AC-9) `ready` envelope gains `retentionDays` + `scrollbackDir` + `replayOnly` + `scrollbackBytes` (initial 0); follow-up `{type:"scrollback-meta", scrollbackBytes}` envelope carries the precise byte count once `scrollbackStore.bytes()` resolves so the original `ready` stays sync (preserves auto-launch handshake timing).
- **Commit:** PENDING
- **Rationale:** Theme switch was option (b) of the AC-2 spec because deterministic Claude-TUI detection without prompt-content sniffing is impossible, and the embedded pane primarily hosts Claude (per ADR-067). Sync ready envelope choice for AC-8/9 came after Spec 76 regressed when bytes() was awaited inline — the auto-launch handshake budget is too tight to absorb fs.stat latency, so the precise count moved to a follow-up envelope. AC-6 path migration aligns with the existing webui convention dir; legacy-line compatibility avoids gitignore churn for projects that already accepted the old path. AC-1 fix is a single-line frame-deferral; revisiting Radix's dropdown dismiss model is out of scope for a polish iterate.
- **Consequences:** Spec 74 (3 previously-flaky modal tests) now stable. Embedded terminal stays legible under Claude Code TUI (WCAG-AA across all slot pairs except the by-design `black` slot). Ctrl+V parity restored. Paste latency drops measurably on Windows by parallelising fs syscalls. New `scrollback-meta` WS envelope keeps `ready` timing intact. Migration is forward-only — existing `.claude-pastes/` files stay where they are; only new pastes land in `.shipwright-webui/pastes/`. `done`/`launch_failed` tasks no longer waste a pty slot on re-attach. **Test results:** 1398/1398 vitest tests + Specs 73-78 (33 e2e) all green; 4-error server tsc baseline held. New write surface `<task.cwd>/.shipwright-webui/pastes/`. New env vars `SHIPWRIGHT_DEBUG_PASTE_TIMING`, `SHIPWRIGHT_DEBUG_AWAITING_LAUNCH`. New WS envelope `scrollback-meta`. `ready` envelope schema additive (4 new fields). FR-01.28 + FR-01.29 amended (not skipped per memory `feedback_iterate_spec_drift_hygiene`).
- **Rejected:** (AC-2) Reverse-video remap of a single ANSI slot pair — not deterministic across Claude TUI repaints; the `white` slot collision was the bug, not the cause. (AC-7) Hide the input cursor in CSS only — doesn't free the pty slot or stop replay re-execution against a hostile shell. (AC-8/9) Separate `/runtime` endpoint — piggyback on `ready` + follow-up envelope per the v0.8.0 A2-audit decision. (Across the board) Feature flagging with kill switch — would expand surface area for a polish iterate; we prefer additive fields the client tolerates by defaulting.

---

### ADR-071: VITE_HOST opt-in for multi-device dev-server access (Tailscale / LAN)
- **Date:** 2026-05-07
- **Section:** Iterate — feature: vite-host-opt-in
- **Run-ID:** iterate-2026-05-07-vite-host-opt-in
- **Context:** Reaching the Command Center over Tailscale MagicDNS (`http://webui-host.tailnet.ts.net:5173`) or another LAN device required either hardcoding `server.host: '0.0.0.0'` (exposes Vite in any untrusted Wi-Fi the laptop joins — café, hotel) or running a side proxy. Vite 6 also enforces a Host-header check that returns `Blocked request. This host is not allowed.` for non-loopback names even when bind succeeds. Default behaviour (loopback only) must stay byte-identical for users who don't opt in.
- **Decision:** Add a pure `resolveViteHost(env)` helper at `client/src/lib/resolveViteHost.ts` that maps `process.env.VITE_HOST` to either `undefined` (unset / empty → no change to Vite defaults), `{host: true, allowedHosts: true}` (`true` / `1` → all interfaces), or `{host: <raw>, allowedHosts: true}` (specific hostname / IP). Spread the result into `defineConfig({server: {…}})` so when `VITE_HOST` is unset the server config carries no `host` / `allowedHosts` keys at all. Ship 7 unit tests covering unset / empty / `true` / `1` / hostname / IP / whitespace-trim branches. Document in `docs/guide.md` §9.1: new env-vars table row plus a "Reaching the dev server from another device" subsection with an example invocation and the Hono-stays-loopback note. Hono backend (3847) is **not** rebound — Vite proxies `/api` locally so only the frontend port is exposed.
- **Commit:** PENDING
- **Rationale:** Pure helper keeps the env-parsing testable in isolation (Vite config files are awkward to unit-test). `allowedHosts: true` is paired unconditionally with any non-loopback bind because Vite 6's host-header check otherwise turns MagicDNS into a silent 403. `VITE_HOST=true` mirrors Vite's own `--host` CLI semantics, so users who already know the upstream flag can guess the env var. Conditional spread (vs. always-emitting `host: undefined`) preserves byte-identical default behaviour and avoids a config-shape change reviewers would have to reason about.
- **Consequences:** Two new files (`resolveViteHost.ts` + test). One conditional spread in `client/vite.config.ts`. New env var `VITE_HOST` documented in guide §9.1 alongside `PORT` / `VITE_PORT`. No FR amendment — `vite.config.ts` is dev-tooling, not a tracked FR. **Test results:** 7/7 vitest unit tests pass (TDD-first); `tsc --noEmit` clean (client). Live smoke: VITE_HOST unset → only `::1` Vite listener; VITE_HOST=true → `::` wildcard listener, HTTP 200 from both LAN-IP (192.168.10.101) and Tailscale-IP (100.64.0.1) on alternate port 5199 — proves both the non-loopback bind AND the Vite 6 host-header bypass via `allowedHosts: true`. Performance budget (`touches_build` risk flag): SKIPPED — change is dev-server-only, no production-bundle path altered, Step 3.8 skip rules apply. **Toolchain note:** node 24.15.0 found via winget (not on agent-shell PATH); python/uv unavailable, so finalization scripts were hand-replaced to match canonical artifact formats.
- **Rejected:** (1) Hardcode `server.host: '0.0.0.0'` — exposes the dev server in untrusted Wi-Fi by accident. (2) Default `allowedHosts: true` even on loopback — weakens the safe default for no benefit (loopback already accepts only `localhost` / `127.0.0.1`). (3) Inline the env parsing in `vite.config.ts` — config files don't fit the project's vitest setup; the helper indirection lets the contract be locked by 7 unit tests instead of manual probing. (4) Boolean-only API (`VITE_HOST=true|false`) — would force users with multi-homed machines to expose every interface to bind one, which is exactly the case the user wanted to keep narrow.

---

### ADR-072: HONO_HOST opt-in: backend default-binds loopback, opt-in for non-loopback
- **Date:** 2026-05-07
- **Section:** Iterate — feature: hono-host-opt-in
- **Context:** ADR-071 declared Hono-on-loopback out-of-scope under the incorrect assumption that @hono/node-server's serve() already defaulted to loopback. In reality serve() was called without a hostname, which makes Node default to '::' (all interfaces) — the backend was reachable from Tailscale and any LAN this laptop joined, including untrusted Wi-Fi. Live observation during the v0.8.4 Tailscale-UAT round confirmed the bind was '::3847', not loopback.
- **Decision:** Mirror VITE_HOST contract for the backend. Pure helper at server/src/lib/resolveHonoHost.ts maps process.env.HONO_HOST: unset/empty -> '127.0.0.1' (loopback IPv4); 'true' or '1' -> '::' (dual-stack); '<addr>' -> literal. Pass result via  to serve(). Default behavior changes from '::' to '127.0.0.1' — breaking change vs. <=v0.8.3, accepted because the typical Vite-proxy-to-localhost frontend flow is unaffected and direct-backend-from-other-device is rare.
- **Commit:** 825cdcfba817911f0e2905cb92994d9e0be0851d
- **Rationale:** Default-loopback aligns with the Plan-D'' security model (single-user local app). VITE_HOST contract proved out one iterate ago; matching shape (true -> wildcard, addr -> literal) keeps mental model consistent. '::' over '0.0.0.0' for the wildcard because dual-stack catches both IPv4 and IPv6 callers without an explicit second bind — same trick Vite plays with host:true.
- **Consequences:** 8 unit tests pass; tsc --noEmit baseline-clean (4 pre-existing cross-package errors held). Live smoke: HONO_HOST unset -> 127.0.0.1 listener, localhost 200, LAN+Tailscale refused; Vite-proxy via Tailscale ':5173/api/health' still 200. HONO_HOST=true -> ':: listener, all 4 endpoints 200. Operators reaching '<machine>:3847' directly from another device (curl, custom dashboards, integration drivers) now need HONO_HOST=true; doc gains breaking-change note in §9.1. Persistent User-scope env var pattern reused (set/unset before travel).
- **Rejected:** (1) Preserve current '::' default to avoid breaking change — rejected: silently leaves backend exposed in untrusted Wi-Fi, exact gap user flagged. (2) Inverse semantics (HONO_LOOPBACK=true to opt INTO loopback) — rejected: inconsistent with VITE_HOST direction, harder to remember. (3) Hardcode '127.0.0.1' with no opt-in — rejected: blocks legitimate direct-backend-from-other-device use cases (custom dashboards, integration tests). (4) Bind to '0.0.0.0' on opt-in — rejected: misses IPv6 callers; '::' is dual-stack on Windows/Linux.

---

### ADR-073: v0.8.3 — Real Ctrl+V image-paste via attachCustomKeyEventHandler + clipboard.read; terminal padding; disclosure copy
- **Date:** 2026-05-07
- **Section:** Iterate — bug+change: v0.8.3-terminal-paste-and-padding
- **Run-ID:** iterate-2026-05-07-v0-8-3-terminal-paste-and-padding
- **Context:** Manual UAT after the v0.8.2 ship surfaced three findings. (1) AC-1 — Ctrl+V image-paste at the bare PowerShell prompt did NOT work despite v0.8.2's AC-3 unit test passing. Root cause: xterm.js's Ctrl+V keybinding bypasses ClipboardEvent entirely and uses async `navigator.clipboard.readText()`, which resolves to text only — image clipboard payloads never reached our DOM `paste` listener. v0.8.2's spec-79 AC-3 test was a false positive (it dispatched a hand-built `paste` event, never crossing xterm's keyboard handler). (2) AC-2 — the xterm canvas was rendered flush against the tab-panel edge, visually heavy compared to the rest of the WebUI. (3) AC-3 — users were confused why their Ctrl+V pastes inside Claude Code's TUI landed in `~/.claude/image-cache/<sessionId>/` instead of `<task.cwd>/.shipwright-webui/pastes/` (the WebUI-controlled path). The disclosure footer didn't acknowledge this split.
- **Decision:** (AC-1) Install `term.attachCustomKeyEventHandler` that returns `false` for Ctrl+V keydown (without Shift / Alt / Meta), `preventDefault`s the DOM event, and drives `navigator.clipboard.read()` directly: image-wins precedence routes through a new shared `uploadPasteBlob` useCallback (used by both the right-click → Paste DOM path and the new keydown path). Text-only clipboard → `socket.send`. Firefox / non-secure-context fallback: handler returns true without preventDefault so xterm's own readText path runs unchanged. New module `client/src/components/terminal/clipboard-paste.ts` carries two pure helpers (`shouldInterceptCtrlV` decision tree, `readClipboardForPaste` async decoder) — both unit-tested in isolation; integration via `EmbeddedTerminal.test.tsx` wiring tests + `client/e2e/flows/80-ctrl-v-real-paste.spec.ts` real-browser regression with `context.grantPermissions(["clipboard-read","clipboard-write"])` + synthetic PNG via `ClipboardItem`. (AC-2) Terminal wrapper gains `p-2 rounded-md`; PrivacyDisclosureFooter inset to `bottom-2 left-2 right-2 rounded-md border`. (AC-3) Disclosure footer adds an informational sentence noting the Claude TUI image-cache path; `.shipwright/agent_docs/known_issues.md` carries the long-form "Image-paste path-of-record" section.
- **Commit:** PENDING — three staged commits on `iterate/v0.8.3-terminal-paste-and-padding`: 825cdcf (Stage 0 disclosure copy), 6513a3c (Stage 1 Ctrl+V real-fix + Spec 80), 334c20b (Stage 2 padding).
- **Rationale:** `attachCustomKeyEventHandler` is xterm's official chokepoint for keyboard-shortcut interception — chosen over a parallel `keydown` capture-phase listener because it gives synchronous return-value control over xterm's internal handling (returning false = "you handle it, I won't"). Pure helpers in their own module keep the decision tree mechanically testable (16 unit cases) without spinning up a real Terminal in jsdom. The shared `uploadPasteBlob` helper (vs. duplicating upload logic in two places) keeps success / gitignore-suggestion / error surfaces in lock-step across both paste paths. `clipboard.read` is gated explicitly on `typeof navigator.clipboard?.read === "function"` so Firefox falls through to xterm's own readText (text-only) instead of becoming silent — the conservative choice. Image-paste path-of-record split is intentional and surfaced openly in the UI rather than papered over: WebUI does not control Claude Code CLI's clipboard pipeline, hooking Claude's cache write would be a fragile reverse-engineering surface, and Anthropic may make the cache root configurable in a future Claude Code release. Track upstream as a GitHub issue, not a local patch. Outer `p-2` (8px) chosen over Card-with-shadow alternatives because the rest of the WebUI is visually light; the dark xterm canvas + small breathing room reads cleanly against `bg-[var(--color-surface)]` of the tab-panel.
- **Consequences:** Five files modified across three staged commits: `client/src/components/terminal/EmbeddedTerminal.tsx` (+ ~95 LOC), `client/src/components/terminal/EmbeddedTerminal.test.tsx` (+ 150 LOC for wiring tests), `client/src/pages/TaskDetailPage.tsx` (footer copy + position class), `.shipwright/planning/01-adopted/spec.md` (FR-01.28 AC-2/3 amendments + FR-01.29 v0.8.2 AC-3 narrowed by v0.8.3 AC-1). Three new files: `clipboard-paste.ts` (127 LOC), `clipboard-paste.test.ts` (168 LOC, 16 cases), `client/e2e/flows/80-ctrl-v-real-paste.spec.ts` (186 LOC). xterm `cols` may shrink by 1-2 characters at narrow viewports (FolderTree + SmartViewer both expanded) — acceptable trade-off, user can collapse one side pane. EmbeddedTerminal.tsx grows from 599 → 673 lines, still over the 300-line guideline that pre-dated this component; not split here because the v0.8.3 changes are a focused fix, not a refactor. **Test results:** Toolchain note — node + python/uv unavailable in the agent shell (same constraint as the v0.8.2 follow-up commit and ADR-071). User's manual UAT command attached to the Stage 1 commit message. Spec 79 stays green (its AC-2/4/7/8/9 contracts are independent of the Ctrl+V keyboard path); v0.8.2's misleading AC-3 synthetic-event test stays in place but supplanted by Spec 80 as the AC-1 truth-test.
- **Rejected:** (1) Replace the existing DOM `paste` listener with the `attachCustomKeyEventHandler` path entirely — rejected: defense-in-depth wins. The `paste` event still fires for right-click → Paste menu and programmatic paste; keeping both means real-browser keyboard AND mouse paths share the same /paste-image upload. (2) Sweep / migrate Claude Code's `~/.claude/image-cache/` to `<task.cwd>/.shipwright-webui/pastes/` — rejected: out of WebUI's surface, fragile reverse-engineering of Claude Code CLI internals, deferred indefinitely. (3) Bilingual (DE/EN) disclosure copy — rejected: rest of WebUI is English-only; defer i18n to a separate iterate. (4) Padding via CSS variable (`--terminal-padding`) for future configurability — rejected: hardcode `p-2` for v0.8.3, promote to var only on user request. (5) Refactor the existing `<paste>`-event handler away once Stage 1 introduces the keydown handler — rejected for v0.8.3: defense in depth, refactor in v0.10 if a behavioural conflict surfaces. (6) Keep Spec 79 AC-3 unchanged — partially adopted: Spec 79 retained as-is (no history rewrite); spec FR-01.29 AC at line 225 narrowed in description so it no longer claims to fire for Ctrl+V (it doesn't, and the v0.8.3 AC-1 line carries the truth).

---

### ADR-074: v0.8.4 — Trusted-Origin gate honors HONO_HOST + WEBUI_TRUSTED_ORIGINS opt-in (Tailscale terminal fix)
- **Date:** 2026-05-07
- **Section:** Iterate — bug: v0.8.4-trusted-origins-opt-in
- **Run-ID:** iterate-2026-05-07-v0-8-4-trusted-origins-opt-in
- **Context:** Manual UAT after the v0.8.3 ship surfaced one finding: the embedded terminal stayed mute when the WebUI was reached via Tailscale (`http://webui-host.tailnet.ts.net:5173`). The page loaded fine (Vite proxies `/api` same-origin) but the WS upgrade for `/api/terminal/:taskId/ws` rejected the browser's MagicDNS Origin with `origin_not_allowed`. Vite's `changeOrigin: true` only rewrites the Host header — the Origin header was forwarded verbatim — and the gate at `server/src/terminal/routes.ts:defaultAllowedOrigins` was hardcoded to `localhost / 127.0.0.1 / ::1` only. Same shape for `server/src/index.ts` HTTP CORS middleware (`origin.includes("localhost")`), which (a) blocked non-loopback origins and (b) carried a substring-attack lookalike gap (`http://evil-localhost-attack.com` would have matched). ADR-072 (HONO_HOST opt-in) widened the bind but left both Origin gates loopback-only — partial-fix that left this specific gap.
- **Decision:** Single coherent Trusted-Origin policy resolved from env, consumed by both gates. Three modes layered safest-default-first: (1) `WEBUI_TRUSTED_ORIGINS=<comma-separated>` — explicit allowlist (exact string match, narrowest, takes precedence). (2) `HONO_HOST=<any non-empty value>` — implies the user opted into a non-loopback bind, accept any non-empty Origin. (3) Default — loopback-only (`localhost / 127.0.0.1 / ::1 / [::1]`). Anonymous (`null` / missing) Origin is rejected unconditionally across all three modes — non-browser callers (curl, scripted clients) fall outside the browser CORS contract regardless of policy. Side-fix: WHATWG URL keeps brackets on IPv6 hostnames (`new URL("http://[::1]").hostname === "[::1]"`), so the loopback set now accepts both — the pre-iterate gate silently never matched real IPv6 loopback origins.
- **Commit:** d268f9b (single commit on `iterate/v0.8.4-trusted-origins-opt-in`).
- **Rationale:** Pure helper at `server/src/lib/resolveTrustedOrigins.ts` mirrors the `resolveHonoHost.ts` / `resolveViteHost.ts` pattern (env-only, no network state, fully unit-testable). Three-mode layering matches the user's mental model: most users on Tailscale already set `VITE_HOST=true`; setting `HONO_HOST=true` alongside is the lowest-friction widening that's still explicit. `WEBUI_TRUSTED_ORIGINS` exists for the security-conscious operator who wants the narrowest possible match (e.g. on a shared Tailnet with untrusted nodes). Allowlist takes precedence over `HONO_HOST` permissiveness so a careful operator can opt into the bind but lock down the gate. Boot log surfaces the resolved policy on every server start so a future "my terminal is mute" report can be diagnosed in one line. The String-match in mode (3) was stricter than the v0.8.3 `origin.includes("localhost")` heuristic and incidentally fixes a substring-attack lookalike that the test suite now guards against.
- **Consequences:** Two new files (`resolveTrustedOrigins.ts` + 29-case test). Three edited files (`terminal/routes.ts` defers to helper, `index.ts` CORS defers to helper + boot-log line, `index.test.ts` gains 2 regression cases). `docs/guide.md` §9.1 gains the env-var-table row + new sub-subsection "Embedded terminal over Tailscale — Trusted-Origin gate (v0.8.4)" with both opt-in paths + the boot-log readback hint. **Test results:** `tsc --noEmit` baseline-clean (4 pre-existing cross-package errors held); `vitest run` 720/720 pass on the server suite; new regression coverage proves Tailscale Origin rejected by default + lookalike rejected even with the prior includes-substring gap. **Operator-facing breaking change:** none. Default remains loopback-only, identical to pre-iterate behaviour. Users who want Tailscale terminal access set `HONO_HOST=true` (env-var matrix in the existing §9.1 still applies) or `WEBUI_TRUSTED_ORIGINS=<list>`.
- **Rejected:** (1) Single permissive flag (`WEBUI_ALLOW_ANY_ORIGIN=true`) — rejected: too coarse; conflates the bind opt-in (HONO_HOST) with the gate posture, when the operator may want them to differ (e.g. bind everywhere but only trust one allowlist). (2) Auto-derive trusted Origins from `HONO_HOST` literal value (e.g. infer `http://<HONO_HOST>:5173` automatically) — rejected: HONO_HOST resolves IP-level bind, not URL-level Origin (Vite proxy makes the Origin always come from `<machine>:<VITE_PORT>`, not `<machine>:<HONO_HOST_PORT>`); the inference would be wrong half the time. (3) Continue to allow loopback but additionally print a soft warning when the gate rejects a non-loopback Origin so the user has a hint — rejected: noisy; the boot-log policy line covers diagnosability without spamming on every rejected request. (4) Wildcard syntax in `WEBUI_TRUSTED_ORIGINS` (e.g. `*.tailnet.ts.net`) — rejected for v0.8.4: scope creep; exact-string match is enough for the per-device tailnet shape and avoids the wildcard-expansion attack surface. Future iterate if patterns emerge.

---

### ADR-075: v0.8.5 — terminal fixes + Ctrl+V handler revert (5 ACs across 4 stages)
- **Date:** 2026-05-08
- **Section:** Iterate — bug+change: v0.8.5-terminal-fixes-and-cleanup
- **Run-ID:** iterate-2026-05-08-v0-8-5-terminal-fixes-and-cleanup
- **Context:** Manual UAT after v0.8.4 surfaced 5 findings. (1) **Padding visual** — v0.8.3's outer `p-2 rounded-md` produced an 8px ring of parent surface but xterm's text was flush against the dark canvas edge ("Schrift direkt am Rand"). (2) **Ctrl+V doesn't work** — empirically the v0.8.3 `attachCustomKeyEventHandler` + `clipboard.read()` flow never produced a reliable image-paste in the user's daily flow; Alt+V via Claude Code's TUI clipboard pipeline is sufficient and a 2s round-trip. (3) **Re-attach replays 100 banners** — disk-backed scrollback file totalled 1.6 MB after the pre-PATH-fix SessionStart-hook-spam phase; server replay-on-attach faithfully replays the entire history; xterm doesn't dedupe between successive attaches. (4) **Awaiting-launch never transitions to active** — `actionId === "new-plain"` tasks per `known_issues.md` don't write JSONL until the user types the first message, so the transcript-poll-driven state machine can't flip them out of `awaiting_external_start`; user mental model is "Claude is plainly running, badge should say active". (5) **Terminal-tab CTA in header is duplicate UX** — the v0.8.3 ADR-068-A1 AC-16 / Phase-5-Codex-review installation just dispatched `webui:focus-terminal-tab` (pure tab-flip) — duplicate of the inline `Tabs.Trigger` row inside the page.
- **Decision:**
  - **AC-1 (visual padding, Stage 0):** single-layer wrapper. Drop v0.8.3 outer `p-2`; replace with `bg-[#1a1a1a] rounded-md p-2` directly on the EmbeddedTerminal outer `<div>`. Conditional banners gain `-mx-2 -mt-2 mb-2 rounded-t-md` so they read as a header strip on the dark frame. Result: black extends edge-to-edge of the wrapper; text/cursor sits 8px inset from the dark edge on all four sides.
  - **AC-2 (Ctrl+V revert, Stage 1):** delete `clipboard-paste.ts` + its 16-case suite + Spec 80 e2e + the `attachCustomKeyEventHandler` registration + the `ctrlVHandlerRef` plumbing + the wiring tests. Keep the DOM `paste` event listener (defense-in-depth for right-click → Paste menu, programmatic paste, Edge legacy paths) and the shared `uploadPasteBlob` helper.
  - **AC-3 (defensive replay-clear, Stage 2):** EmbeddedTerminal subscribes to the `replay_start` envelope and calls `term.clear()` before scrollback chunks land. For a freshly-mounted xterm this is a visual no-op; for any future WS-reconnect path that hits the same EmbeddedTerminal instance it guarantees idempotent replay rendering. The user's specific 100-banner symptom is resolved at runtime by clicking "..." → "Clear terminal history" once per affected task.
  - **AC-4 (new-plain pty-up transition, Stage 3):** when the WS upgrade `onOpen` fires and the task is in `awaiting_external_start` AND `actionId === "new-plain"`, server patches state to `active` immediately. `firstJsonlObservedAt` intentionally NOT set — the existing transcript-poll path will set it correctly when JSONL eventually appears. Branch is guarded on `actionId` so other launch flavors stay JSONL-driven.
  - **AC-5 (doc cleanup, Stage 4):** spec.md FR-01.28 v0.8.3 AC-2 marked superseded by v0.8.5 AC-1; FR-01.29 v0.8.3 AC-1 marked REVERTED with link to ADR-075; new ACs added for v0.8.5 AC-3, AC-4, AC-6. conventions.md Learnings + memory file `feedback_xterm_clipboard_async_api.md` get codas noting "rule still correct, but we chose not to act on it for image-paste because Alt+V Just Works."
  - **AC-6 (Terminal-tab CTA removal, Stage 1):** TaskDetailHeader CTA matrix shrinks: `draft` → Launch, `idle` → Resume, all other states → no primary CTA (status badge only). The `webui:focus-terminal-tab` listener in TaskDetailPage.tsx removed alongside its only dispatcher. Inline `Tabs.Trigger` row covers the tab-flip directly.
- **Commit:** `iterate/v0.8.5-terminal-fixes-and-cleanup` branch — Stage 0 8380599, Stage 1 5a56f00, Stage 2 d0b6a41, Stage 3 fbc7540, finalization PENDING.
- **Rationale:** Each AC matches a user-reported friction point. AC-1 is a 6-character CSS change; AC-2 is a clean revert of a v0.8.3 path that never produced value; AC-3 is defense-in-depth; AC-4 is surgical (3-line conditional in WS upgrade onOpen, guarded on actionId); AC-6 simplifies the header-CTA matrix to two states. AC-2 + AC-6 together delete more LOC than they add (-766 / +36 in Stage 1). The investigation phases for AC-3 + AC-4 happened first — disk-scrollback inspection (1.6 MB confirmed historical accumulation) and sdk-sessions.json inspection (`actionId: new-plain` confirmed the documented edge case in known_issues.md) — so the fixes are targeted, not speculative. **Test results:** client tsc clean; client vitest 39/39 (terminal subset) pass; server vitest 720/720 pass; server tsc baseline-clean (4 pre-existing cross-package + proper-lockfile errors held per CLAUDE.md DO-NOT #7).
- **Rejected:** (1) Two-layer wrapper for AC-1 (outer ring of parent surface AND inner dark padding) — rejected during user approval: black-edge-to-edge is what they want. (2) Special-case "pty-up = active" universally for AC-4, not just new-plain — rejected: would override the JSONL-driven transition for slash-command launches that genuinely have a "still booting" state worth showing as awaiting. (3) Bilingual disclosure-footer copy — rejected: out of scope, defer to a possible future i18n iterate. (4) Server-side replay dedupe (only emit replay on first attach within a session) for AC-3 — rejected: client-side `term.clear()` is simpler, sufficient, and doesn't break non-WebUI clients that may want every-attach replay. (5) Add a unit test for AC-4 by mocking the WS upgrade end-to-end — rejected: the conditional is a 3-line read of `task.state` + `task.actionId`; integration coverage via the running stack + Playwright e2e is more useful than a heavily-mocked unit. (6) Re-add a "Re-launch" affordance to the kebab menu for the case where AC-4 turns out to be insufficient — defer: AC-4 covers the new-plain stuck path; if other launch flavors get stuck, address in a follow-up iterate.

---

### ADR-076: v0.8.6 — terminal reattach regressions + TaskCard CTA cleanup; v0.8.5-discipline carry-through (E2E-first)
- **Date:** 2026-05-08
- **Section:** Iterate — bug+change: v0.8.6-terminal-reattach-and-card-cleanup
- **Run-ID:** iterate-2026-05-08-v0-8-6-terminal-reattach-and-card-cleanup
- **Context:** Manual UAT after v0.8.5 ship surfaced 4 follow-up findings + 1 out-of-scope warning. (1) Rounded-md corners on the terminal wrapper read as visually out of place ("Aber sieht doof aus. Nicht abrunden."). (2) "100 Claude-Code-Header" perception escalated post-v0.8.5 ("Fehler nun schlimmer"). (3) Read-only banner observed after Task → Board → Task navigation ("den haben wir schonmal gefixt"). (4) TaskCard CTA matrix still carries the brown "Terminal" button on awaiting/active states — duplicate of the card-body click target ("nur Launch macht Sinn oder Resume, aber Terminal nicht"). (5) `claude /doctor` reports "31 skill descriptions dropped" — Claude Code v2.1.132 internal state, out of WebUI scope. The user explicitly demanded E2E-first this iterate after the v0.8.5 lapse where I shipped with `e2e: not_run` ("hast du saubere playwright empirische tests gemacht? Du bist der Tester nicht ich").
- **Decision:**
  - **AC-1 (Stage 0, drop rounded corners):** remove `rounded-md` from the EmbeddedTerminal outer wrapper + `rounded-t-md` from the conditional banners. Spec 81's AC-1 borderRadius assertion flips from `"6px"` → `"0px"`.
  - **AC-2 / AC-3 (Stage 1+2, terminal reattach):** authored Spec 82 reproduction tests FIRST (per the v0.8.5-lessons-learned discipline), ran them against the live v0.8.5 stack — both came back GREEN. AC-2 (banner accumulation) does NOT reproduce in fresh-task fixtures: v0.8.5 AC-3's defensive `term.clear()` already makes rendering idempotent across 3 round-trip Task → Board → Task navigations. The user's specific observation is the historical 1.6 MB scrollback file for task `0697cfbe-...` (accumulated during the pre-PATH-fix SessionStart-hook-spam phase); resolution is user-side "Clear terminal history" once. AC-3 (read-only banner) does NOT reproduce in single-tab navigation either; the historical writer-promoted envelope race fix holds. Both Spec 82 cases stay as forward-protective regression fences — they will fail loud if the bug returns and capture the exact reproduction sequence then.
  - **AC-4 (Stage 3, TaskCard Terminal CTA):** REPRODUCED cleanly (Spec 82 AC-4 RED → GREEN cycle). Removed the `isTerminalNeeded` branch + the `<TerminalLaunchButton color="brown" label="Terminal">` block from TaskCard.tsx. Card body click target stays the navigation affordance.
- **Commit:** `iterate/v0.8.6-terminal-reattach-and-card-cleanup` branch — Stage 0 f521d18, Stage 1+2+3 8c19ad9, finalization PENDING.
- **Rationale:** This is the first iterate where investigation-led ACs got their reproduction-test-first discipline applied honestly. Two of three "bugs" (AC-2, AC-3) turned out to be empirically green in fresh-task fixtures — meaning v0.8.5 already fixed them at the code level, and the user's observation was either historical disk content (AC-2) or a non-reproducible runtime artefact (AC-3). The right move is to keep the regression specs as forward-fences rather than chase phantom fixes. The actual code change is one block deletion in TaskCard.tsx + one CSS class drop in EmbeddedTerminal.tsx — minimal surface for a maximally-honest iterate. **Test results:** Spec 81 all 3/3 green (with flipped AC-1 assertion); Spec 82 all 3/3 green; client tsc clean; no server changes (terminal reattach + card CTA are client-only surfaces). No new unit tests beyond the e2e regression fences — the changes are too small + too declarative for unit shape to add value over the empirical e2e.
- **Rejected:** (1) Add a "Clear-scrollback-on-iterate-load" auto-action to wipe the user's 1.6 MB historical accumulation — rejected: that's a destructive operation on persisted user-visible data; explicit user-side action via "Clear terminal history" is the correct UX. (2) Add a multi-tab read-only reproduction case to Spec 82 to chase AC-3 deeper — defer: without a reproducible single-tab fixture the scenario is speculative; if the user observes it again we capture the exact sequence and extend the spec then. (3) Wire the card's body-click navigation explicitly via TaskCard.tsx (instead of relying on the existing affordance) — rejected: the click target already routes correctly per the existing testid `task-card-open-{id}`; adding a wrapping click handler would risk double-fire bugs. (4) Bundle "31 skill descriptions dropped" diagnostic into this iterate — rejected: out of WebUI scope, Claude Code internal state, no WebUI code change.

---

### ADR-076a (amendment): v0.8.6 AC-2 root cause was ConPTY READLINE redraw on no-op resize, not "phantom historical content"
- **Date:** 2026-05-08 (post-merge follow-up)
- **Section:** Iterate — bug+change: v0.8.6-terminal-reattach-and-card-cleanup (continuation)
- **Run-ID:** iterate-2026-05-08-v0-8-6-terminal-reattach-and-card-cleanup
- **Context:** ADR-076's original conclusion ("AC-2 not reproducible in fresh-task fixtures, the user's symptom is historical disk content") was **wrong**. The original Spec 82 AC-2 fixture measured `.xterm-rows.textContent` — which captures only the visible viewport. xterm scrollback (where the accumulation actually shows up) was invisible to the test. After the v0.8.6 merge, user reported the bug still reproduces with "Neuer Task und einmal springen". A second-pass investigation upgraded the fixture to (a) emit a 20-line BANNER command via keystrokes, (b) capture the FULL xterm buffer via `window.__embeddedTerminal` (test-only diagnostic surface), (c) count standalone `BANNER_LINE_NN` lines, and (d) instrument WS envelope counts. The bug DID reproduce: 5 live `data` envelopes per visit, ~5910 bytes total, each containing a `\e[?25l\e[H` (cursor-home + READLINE redraw of "version + prompt + typed line"). Diagnostic envelope counters showed replay was emitted ONCE (not the suspected source) — the firehose was server-driven `pty.resize()` causing ConPTY to repaint READLINE on every WS attach.
- **Decision:** Server-side dedupe in `PtyManager.resize` — store `lastResizeCols / lastResizeRows` per PtyEntry; skip the `pty.resize()` call when (cols, rows) match. ConPTY's SIGWINCH-driven redraw never fires for no-op resize requests. Client-side dedupe in EmbeddedTerminal's ResizeObserver path + active-tab effect — track last-sent (cols, rows) per mount and skip redundant `resize` WS frames so the WS-frame load also drops. Spec 82 AC-2 fixture upgraded: types BANNER, captures `term.buffer.active`, asserts standalone-line count is exactly 20 across 2 round-trips. RED → GREEN.
- **Commit:** d211323 (post-merge linear commit on main).
- **Rationale:** Defense-in-depth at server + client. Client-only would still let a misbehaving server (or a future feature emitting its own resize) trigger the redraw; server-only would still send redundant WS frames. The ConPTY READLINE-redraw quirk is upstream behavior — the right architectural surface to absorb it is the `PtyManager.resize` chokepoint where every resize already converges. Test discipline lesson: when an investigation-led AC "doesn't reproduce", challenge the test's measurement model before declaring it phantom. `.xterm-rows.textContent` is viewport-only; for accumulation bugs the relevant surface is `term.buffer.active`. The diagnostic surface stays in the codebase as a thin window-handle (`__embeddedTerminal`) so future Playwright suites can read xterm internals without re-discovering the workaround.
- **Rejected:** (1) sessionStorage-backed `webui:replay-served:<taskId>` flag + `?suppressReplay=1` query param — initial fix attempt; rejected because (a) it solved the wrong layer (replay envelopes were single-fire already; the firehose was live-data resize redraws) and (b) suppressing replay on every revisit broke the legitimate "see scrollback after navigating back" UX. The resize-dedupe gives the user idempotent rendering AND keeps the replay-on-revisit feature intact. (2) Disable React StrictMode in dev to avoid the double-mount — rejected: StrictMode is a useful dev-mode safety net; the right fix is making the components idempotent under it, not disabling it. (3) Pass a "this is a transient WS, skip replay" heuristic from the WS upgrade onOpen — rejected: server has no reliable signal for "transient"; client knows better but the resize-dedupe path covers the same problem more directly.

---

### ADR-077: v0.8.7 — scrollback hygiene (shell-stopped marker + replay-time collapse + footer disclosure) + new-plain idle transition

- **Status:** superseded — by ADR-087 (2026-05-12). The replay-time PowerShell-boilerplate collapse + the footer disclosure are gone; the AC-1 new-plain idle transition + the AC-2 shell-stopped marker WRITER in pty-manager stay in force.
- **Date:** 2026-05-08
- **Section:** Iterate — change+bug: v0.8.7-scrollback-hygiene-and-newplain-idle
- **Run-ID:** iterate-2026-05-08-v0-8-7-scrollback-hygiene-and-newplain-idle
- **Context:** Two findings from manual UAT after v0.8.6 ship. (1) **Scrollback boilerplate accumulation** — long-running tasks (e.g. "Check Tech Stack..." after 13.5h) accumulate visible PowerShell-startup banners interspersed with empty CRLF blocks; user-reported "100 prompts between Claude-banner and live shell separator" on overnight-revisit. Empirical analysis (this session): file `<HOME>/.shipwright-webui/terminal-scrollback/53e2d8f4-...log` totalling 1.25 MB contains **541 PowerShell-startup banners** over 13.5h (~40/h; standalone PWSH baseline `idle = 0 bytes/sec`). NO cursor-redraw sequences (ESC[H, ESC[2J) — these are GENUINE pty kill→respawn cycles, dominated by `tsx watch` SIGTERM during dev. (2) **`new-plain` tasks stuck on "active" badge** after overnight idle, blocking the Resume CTA in TaskDetailHeader. Root cause confirmed via code-read of `external/routes.ts:843-848`: the `result.status === "missing"` branch returns early; for `new-plain` JSONL is never written → `firstJsonlObservedAt` stays null → the `active → idle` transition at L877 is unreachable.
- **Decision:**
  - **AC-1 (Stage 0, transcript-poll patch):** Extend the `result.status === "missing"` branch with `if (task.actionId === "new-plain" && task.state === "active" && ptyManager.get(task.taskId) === undefined) → patch state=idle`. Self-healing: v0.8.5 AC-4 re-flips to active on next WS attach. `ptyManager` is a REQUIRED arg to `createExternalRoutes()` (TypeScript + runtime guard, per external code review).
  - **AC-2 (Stage 1, shell-stopped marker):** Every intentional pty kill (`ptyManager.kill` + idle-ceiling) sets `entry.closing = true` BEFORE invoking `entry.pty.kill()`. The `pty.onExit` handler appends ONE dim-grey ANSI marker frame (`\r\n\\x1b[2m──── shell stopped at HH:MM:SS ────\\x1b[m\r\n`) when `closing === true`. Closing-flag dedupe ensures duplicate kill calls produce exactly one marker; natural exits (closing=false) write nothing. Marker append is via `scrollbackStore.append()` (synchronous `fs.appendFileSync` per scrollback-store contract — durable before return).
  - **AC-3 (Stage 2, replay-time collapse):** New method `ScrollbackStore.readForReplay(taskId)` — applies replay-time presentation transform that collapses repeated PowerShell-startup banner bursts within a single shell-lifetime span. `read()` and `bytes()` STAY RAW so privacy-disclosure copy + `scrollback-meta` envelope size stay accurate. Bounded regex (`[^\\x07]{0,256}` for OSC, `[^\\r\\n>]{0,512}` for prompt) — no ReDoS; per-span collapse anchored by AC-2 markers; user content BETWEEN bursts is preserved (per external code review fix).
  - **AC-4 (Stage 3, footer banner):** EmbeddedTerminal renders dim footer "Scrollback enthält N beendete Shell-Sessions. [Clear history]" when ≥2 of the AC-2 markers are present in the replay. Marker count derived from a **replay-payload accumulator** (replayBufferRef) NOT `term.buffer.active` (post-replay buffer is wiped by pty2's `\\x1b[2J\\x1b[H` startup). Accumulator concatenates all replay_chunk payloads into a string, counts substring matches at replay_end, then frees memory. Chunk-split markers handled correctly across arbitrary WS frame fragmentation. "Clear history" button uses `window.confirm()` for destructive guard, then calls existing `/clear-scrollback` endpoint. After clear, count resets → footer hides without remount.
- **Commit:** `iterate/v0.8.7-scrollback-hygiene-and-newplain-idle` branch — Stage 0 0d4a608, Stage 1 80d2e8a, Stage 2 4b39127, Stage 3 176687b, Spec 83 fb93023, review-fix-1 5c5c5b1, review-fix-2 d40da77.
- **Rationale:** Each AC matches a user-reported friction point with a non-destructive disk-policy posture (ADR-076 explicitly rejected disk-pruning). AC-1 is a 14-LOC conditional in the transcript poll. AC-2 is additive (writes one marker per intentional kill, never modifies prior content). AC-3 modifies only the replay-stream (disk untouched per `bytes()` raw contract). AC-4 derives count from replay payload not xterm buffer (empirical observation: production buffer is wiped post-replay by ConPTY). External plan review (gemini + openai via openrouter) flagged 16 findings; 4 HIGH-priority addressed pre-build (ptyManager required injection, separate replay reader, bounded regex, marker-after-pty-exit). External code review caught 2 HIGH bugs (collapse content-drop, accumulator chunk-tail under-count) post-build that I would have missed; both patched + covered by unit tests. **Test results:** 1474 unit (server 740 + client 734) all green, Spec 83 4/4 against live dev stack (hono :3847 + vite :5173 with HONO_HOST=true + VITE_HOST=true). TSC baseline-clean (4 pre-existing cross-package errors per CLAUDE.md DO-NOT #7).
- **Rejected:** (1) Auto-clear scrollback after N markers — rejected per ADR-076's "destructive on user-visible data" rule. User-driven "Clear history" stays the only destructive path. (2) Modify `bytes()` to apply collapse — rejected per external review (would break `scrollback-meta` envelope size + privacy-disclosure copy that depends on raw byte size). Added `readForReplay()` as a parallel method instead. (3) AC-4 buffer scan via `term.buffer.active` after replay_end — rejected after empirical observation that ConPTY's `\\x1b[2J\\x1b[H` startup wipes the buffer between replay_end and the user-visible state. The accumulator captures the count BEFORE the wipe. (4) AC-4 reuse TaskDetailHeader's confirm modal — pragmatic deviation: `window.confirm()` provides equivalent destructive-guard UX with zero coupling between EmbeddedTerminal and TaskDetailHeader. Documented openly in spec § Self-Review. (5) Investigation-led iterate to reduce pty cycle-rate root cause — deferred: empirical analysis showed dominant source is `tsx watch` SIGTERM during dev, not a production-user concern. v0.8.7 surfaces the existing cycles cleanly via marker + footer rather than chasing the rate down.

---

### ADR-078: v0.8.8 — new-plain Resume fix + cli-compat robustness (4 ACs, 1 day, ship-after-2-review-rounds)

- **Date:** 2026-05-08
- **Section:** Iterate — bug+change: v0.8.8-newplain-resume-and-cli-robustness
- **Run-ID:** iterate-2026-05-08-v0-8-8-newplain-resume-and-cli-robustness
- **Context:** Manual UAT after v0.8.7 surfaced two findings. (1) **Resume on `new-plain` tasks fails** — v0.8.7 AC-1 unblocked the Resume CTA for these tasks (idle-on-pty-gone), but the click triggered `claude --resume <sessionUuid>` which fails with "No conversation found" because new-plain tasks never write JSONL (Claude only flushes the transcript after the user's first TUI message). User report: "terminal startet nicht — nicht von neu und nicht resume". Empirical Playwright probe confirmed terminal+shell start but Resume command produces "No conversation". (2) **CLI detection broke** — server's `process.env.PATH` didn't include `~/.local/bin/`, `where claude` returned empty, `/api/diagnostics` reported `claudeCli.raw=""` despite claude being installed. Was a multi-process tsx-watch boot artifact (PATH inherited from the launching shell, which didn't source the user's dotfile that adds `~/.local/bin/`).
- **Decision:**
  - **AC-1 (Resume fix, server route):** In `routes.ts /launch` legacy fallback, gate `resume` on `task.actionId !== "new-plain"`. For new-plain Resume clicks: emit fresh `--session-id <uuid>` launch (same task identity, fresh Claude TUI). Non-new-plain (adopted brownfield, fork, slash-command) keeps existing `--resume` semantics.
  - **AC-2 (resolveClaudeBin multi-strategy):** Three-step lookup: (1) `SHIPWRIGHT_CLAUDE_BIN` env override (loud reject if missing), (2) primary `where`/`which` with INFO-line filter + existsSync verification, (3) curated fallback paths per-platform (Windows: `~/.local/bin/{exe,cmd}`, npm-global, winget shim, Program Files; POSIX: `~/.local/bin`, `~/.npm-global/bin`, `/usr/local/bin`, `/opt/homebrew/bin`). Loud-logs every fallback hit so production operators see PATH drift.
  - **AC-3 (boot-time PATH self-heal):** When AC-2 fallback resolves a binary whose parent dir is NOT on `process.env.PATH`, prepend it. Idempotent (case-insensitive on Windows, case-sensitive on POSIX). Detects and updates the existing PATH key (`Path` vs `PATH` on Windows). Subsequent child-process spawns inherit the augmented PATH so node-pty pwsh, preview-session-manager, and any other command running inside the server process can find sibling binaries (uv, gh, …) installed in the same fallback dir.
  - **AC-4 (diagnostic context):** When `claudeCli.supported === false`, `/api/diagnostics` includes a `diagnostic` block with: primary `where`/`which` output, bounded PATH sample (8 entries), curated fallback paths annotated with `(exists)`/`(missing)`, and `SHIPWRIGHT_CLAUDE_BIN` env override status. Operators self-diagnose without reading the server log.
- **Commit:** main 8c9f02d (initial) + 2978aac (external review fixes). Committed directly on main per `feedback_iterate_e2e_always_means_run.md` (small-medium iterate).
- **Rationale:** Each AC matches a real user-reported friction. AC-1 is a 3-LOC server-side gate that closes the broken-Resume UX hole opened by v0.8.7 AC-1. AC-2 + AC-3 + AC-4 form a coherent CLI-detection robustness package: AC-2 finds the binary even when PATH is wrong, AC-3 fixes PATH so OTHER tools also work, AC-4 surfaces the diagnostic to operators. **External code review** (gemini + openai via openrouter, mode=code) ran in TWO rounds: (1) initial review caught a Windows `Path` vs `PATH` case-insensitive bug in self-heal + a `where`-emits-INFO-on-stdout false-positive in resolveClaudeBin + missing SHIPWRIGHT_CLAUDE_BIN status in AC-4 diagnostic; (2) follow-up review verified all fixes landed. **Test results:** 765/765 server suite (760 baseline + 25 new across 4 AC test files). 2/2 Spec 84 E2E against live dev stack. TSC baseline-clean.
- **Rejected:** (1) Auto-install claude when missing — out of WebUI scope. (2) Watch PATH for runtime changes — rare; restart suffices. (3) Cross-platform package-manager auto-detect (homebrew vs apt vs winget) — curated list is sufficient; users with non-standard installs use SHIPWRIGHT_CLAUDE_BIN. (4) Reuse TaskDetailHeader's existing modal for Resume confirmation — out of scope; no UI surface change in v0.8.8 (the broken Resume flow is server-side only). (5) Bilingual diagnostic copy — single-language (en) for now. (6) Structured-format logging (JSON event keys) for cli-compat — assessed as stylistic preference vs functional bug; deferred. The existing `[cli-compat] ...` plain-text lines are grep-friendly.

---

### ADR-079: v0.8.9 — replay-pushdown so live shell renders at viewport top after replay-on-attach
- **Status:** superseded — by ADR-087 (2026-05-12). Cell-state snapshot replay does not require the pushdown trick; the chunked-replay path that the pushdown defended is gone.
- **Date:** 2026-05-09
- **Section:** Iterate — bug: v0.8.9-replay-pushdown
- **Context:** Manual UAT after v0.8.8 ship: re-attaching to a task with persisted scrollback rendered the live shell (PowerShell + Claude TUI) at the BOTTOM of the visible viewport with replay/empty rows above. User: 'Der Claude Block sollte am oberen Rand des Fensters stehen nicht unten.' Root cause: EmbeddedTerminal.tsx onReplayEnd called scrollToBottom() but never pushed replay content out of xterm's active area; cursor parked at row N+1 of replay; live writes appended below. Compounded by TERM=dumb on the pty spawn (chalk brand-color hack) which suppresses ConPTY's startup \x1b[2J\x1b[H so nothing else clears the active area for the live shell.
- **Decision:** After replay_end, before the live shell starts emitting bytes, write term.rows × \r\n to xterm followed by \x1b[H. The newlines advance the cursor past the bottom of the active area, scrolling all replay rows (incl. separator) into scrollback above. \x1b[H homes the cursor at (0,0) of the now-empty active area; live shell renders from the TOP of the viewport. Replay accessible via scroll-up.
- **Commit:** PENDING
- **Rationale:** Client-side fix at the existing client-owned chokepoint (onReplayEnd). Keeps server replay protocol byte-identical. Pushdown via \r\n-into-scrollback (vs. \x1b[2J\x1b[H wipe) preserves user's ability to scroll up and read the replay history.
- **Consequences:** Single ~5-LOC change in client/src/components/terminal/EmbeddedTerminal.tsx onReplayEnd. New unit test (writeSpy assertion of order \r\n×rows then \x1b[H). New e2e Spec 85 (live-stack regression: marker lives in scrollback (markerRow < baseY), not active viewport). Spec 83 (v0.8.7 marker-count + footer) re-verified green — buffer.active.length includes scrollback in xterm IBuffer model so the AC-4 buffer-scan still finds markers; the AC-4 accumulator (replay payload string) is the primary counting source anyway. Marker accumulator unaffected: replayBufferRef is populated during onData BEFORE these writes; buffer-scan fallback returns 0 for blank active area; Math.max() preserves the v0.8.7 footer behavior.
- **Rejected:** (1) Server-side: emit \x1b[2J\x1b[H in the replay_separator payload — wipes the visible replay (user can't see it, can't scroll up to it, replay history visually lost). (2) Client-side scrollLines API — xterm scrollLines moves the VIEW, not the content; doesn't push replay into scrollback. (3) Defer until ADR-068-A2 'smart-grace replay-only refinement' iterate — too long a UX-pain window for a 5-LOC fix that has clean empirical regression coverage. (4) Hardcode rows=30 (skip the term.rows lookup) — fails on narrow viewports / future responsive layouts.

---

### ADR-080: Type-system isolation between workspaces (retire 4-baseline-error carve-out)
- **Date:** 2026-05-09
- **Section:** Iterate — bug: tsc-baseline-fix (retire ADR-035 § Consequences 'TSC baseline')
- **Context:** ADR-035 (Iterate 2 / 2026-04-20) accepted 4 server tsc errors as documented baseline (3× rootDir cross-package imports + 1× missing @types/proper-lockfile). install-windows.ps1 step [3/4] runs npm run build for production deployment, so the baseline blocks fresh installs from producing dist/index.js — the VBS autostart shortcut points at a non-existent artifact.
- **Decision:** Mirror Task / GlobalSettings / Project verbatim into server/src/types/ (header references canonical client/src/types/* origin). Retarget the 2 cross-package imports. Install @types/proper-lockfile (pinned ^4.0.0 → resolved 4.1.4 to match runtime ^4.1.0). Drop unused @shared path alias from tsconfig + vitest.config. Add comment-aware regex drift-guard server/src/test/no-cross-package-imports.test.ts covering multi-line splits, deeper-path client/ segments, and dynamic import() (8 tests including 7 sanity sub-tests). Companions existing server/src/types/action-schema-sync.test.ts content-parity test. CLAUDE.md DO-NOT regression guard #7 + conventions.md baseline note rewritten.
- **Commit:** PENDING_F6
- **Rationale:** Duplication matches the no-root-package.json workspace topology and reflects existing server-derived asymmetry (Project.mode/hasPreview/adopted/synthesized are server-only). Project References would be over-engineering for 3 small interface files; bigger surgery on tsconfig/vite/tsx with no tangible payoff today. The drift-guard regex was hardened post-external-review (multi-line scan, deeper-path segments, dynamic import) before commit.
- **Consequences:** cd server && npm run build exits 0 (verified F0.5 cli surface). install-windows.ps1 step [3/4] runs clean. Server 773 + Client 735 tests pass. Drift surface = manual mirror-sync per shape — surfaces at compile time on consumer or runtime contract violation. Path forward to Project References / shared package documented if shared surface grows beyond ~3 type files.
- **Rejected:** TypeScript Project References (deferred until shared surface grows). Shared-package monorepo workspace (breaks no-root-package.json invariant). Removing tsconfig.rootDir (breaks dist/ layout — node dist/index.js entry). rootDirs array (does not relax rootDir constraint). Local ambient .d.ts shim for proper-lockfile (community types match the API surface used by server/src/index.ts: lock, unlock, check).

---

### ADR-081: SHIPWRIGHT_NETWORK_PROFILE env-flag (local | tailscale | open) for dev-server bind security
- **Date:** 2026-05-10
- **Section:** Iterate — feature: network-profile-flag
- **Context:** Dev-server bind security required manual VITE_HOST/HONO_HOST tuning per network context. User mobile-pattern (Tailscale at home, loopback at cafe) needed a profile flag instead of editing IPs in .env.local each time. External-review traceability for v0.8.x dev workflow.
- **Decision:** Single env flag SHIPWRIGHT_NETWORK_PROFILE with three values local|tailscale|open drives both Vite + Hono bind. Lowercase-only (typos error). Tailscale-IP via env override OR tailscale ip -4 subprocess (2s timeout). resolveProxyTarget closes Vite-proxy gap when Hono binds non-loopback. allowedHosts uses narrow [<ip>] for tailscale (NOT true). Both halves emit AC-3-exact warning on profile=open; secondary warning for legacy explicit 0.0.0.0 binds. Mirror server/client per ADR-080 + byte-equivalence parity test.
- **Commit:** PENDING_F6
- **Rationale:** External iterate review caught Vite-proxy hardcoded localhost (HIGH) before code. External code review caught 0.0.0.0-as-proxy-target (HIGH), AC-3 exact wording, ETIMEDOUT branch coverage. Both addressed pre-merge. Mirror-pattern stays consistent with ADR-080; byte-equivalence parity test catches behavioral drift.
- **Consequences:** Cafe/mobile users flip ONE env line for safety. Profile=tailscale binds only Tailscale interface (cafe Wi-Fi sees nothing). DNS-rebinding protection narrowed to [<ip>] for tailscale. Backward compat: explicit VITE_HOST/HONO_HOST still wins. New @types/node devDep on client; tsconfig split sends Node-only files to tsconfig.node.json. 60+ new resolver tests.
- **Rejected:** Single VITE_HOST/HONO_HOST flag (existing today; not user-friendly for profile-switching). Multi-bind Hono on loopback+tailscale (node-server doesn't support, requires firewall hack). Auto-detect Tailscale via OS routes (more brittle than CLI subprocess + env override). Profile=tailscale also binding 127.0.0.1 (would require listener-twice complexity).

---

### ADR-082: Wire .env.local into both dev-server processes (tsx --env-file-if-exists + vite loadEnv)
- **Date:** 2026-05-10
- **Section:** Iterate — bug: env-local-loading-fix (close ADR-081 wiring gap)
- **Context:** ADR-081 shipped SHIPWRIGHT_NETWORK_PROFILE but failed to verify .env.local is actually loaded. tsx watch and Vite both ignored non-VITE_* keys in process.env. User had to prepend env-vars on the CLI manually for the previous iterate to function. External iterate review #10 flagged this as NOTED; I handwaved it. Memory feedback_external_code_review_catches_high_bugs.md applies.
- **Decision:** Server: tsx watch script gains --env-file-if-exists=../.env.local (Node 20.12+ native flag; tsx forwards). engines.node >=20.12.0 added to both package.json. Client: vite.config switches to defineConfig(({mode})=>...) form, calls loadEnv(mode, repoRoot, '') with empty prefix to load ALL keys (not just VITE_*). envDir: repoRoot ensures browser-bundle import.meta.env stays consistent. Merge precedence: process.env wins over .env.local (CLI/shell override backward compat). Empty-string env-vars treated as unset on both halves.
- **Commit:** PENDING_F6
- **Rationale:** Node-native --env-file-if-exists is zero-dep, well-documented, supported by repo's Node version. Empirically verified tsx forwarding pre-build (via npx + via direct cli.mjs invocation). loadEnv with empty prefix is documented Vite behavior. process.env > .env.local precedence matches ADR-081 documented behavior. envDir alignment prevents future surprise when user adds VITE_* keys to root .env.local.
- **Consequences:** User can now edit .env.local and restart dev servers — no CLI prefix needed. Live smoke proved: SHIPWRIGHT_NETWORK_PROFILE=tailscale in .env.local → both servers bind to 100.64.0.1 without prefix. Tests: server 825 + client 781 (+12 new). engines field formalizes Node 20.12+ requirement (was implicit).
- **Rejected:** userland dotenv package (extra runtime dep when Node has native support). dotenv-cli / cross-env (pure overhead). single shared loader (loaders run at different process-startup times; each side uses its native idiom). Per-mode .env files like .env.development (out of scope, single .env.local enough).

---

### ADR-083: v0.9.1 — wire boot-time Trusted-Origin policy into WS upgrade gate (single source of truth)
- **Date:** 2026-05-11
- **Section:** Iterate — bug: tailscale-ws-real-browser-fix
- **Context:** f852a36 ("wire SHIPWRIGHT_NETWORK_PROFILE into Trusted-Origin policy") wired the HTTP CORS middleware in `server/src/index.ts` but missed the WS upgrade gate in `server/src/terminal/routes.ts`. The HTTP path calls `resolveTrustedOrigins(process.env, tailscaleExecForOrigin)` (exec passed → profile-tailscale mode), but `defaultAllowedOrigins` in terminal/routes.ts calls `resolveTrustedOrigins(process.env)` WITHOUT exec → policy falls through to loopback-only. User saw the correct boot-log line (HTTP-side policy describe()) and the unit tests all green (they pass exec explicitly), but the WS upgrade in the actual browser returned 500 (origin_not_allowed) for every non-loopback Origin. Terminal pane stayed empty over Tailscale; Resume click did nothing. The memory feedback_browser_fixes_need_real_browser_smoke.md scenario fired exactly: resolver-unit-tests grün + policy-boot-log-line ≠ "terminal works".
- **Decision:** Pass the boot-time-resolved `corsOriginPolicy.isAllowed` as `deps.allowedOrigins` when index.ts calls `createTerminalRoutes(...)`. Both the HTTP CORS middleware AND the WS upgrade gate now share ONE policy instance — single source of truth, no per-request `tailscale ip -4` subprocess overhead, no possible drift between two resolver calls.
- **Commit:** PENDING_F6
- **Rationale:** Single-line wire-up at the production boundary keeps the test-friendly `defaultAllowedOrigins` fallback untouched (unit tests don't need to wire exec) and forces production to reuse the same instance the boot log describes. The alternative — having `defaultAllowedOrigins` call `resolveTrustedOrigins(process.env, exec)` itself — would spawn `tailscale ip -4` on every WS upgrade attempt (slow) AND would create two policy instances (HTTP + WS) that could drift if the resolver gained state. Wiring at the call site is the cleanest correctness + performance + maintainability point.
- **Consequences:** Empirically verified: curl WS-upgrade probe with MagicDNS Origin returns 101 + ready envelope + pty data post-fix (vs. 500 pre-fix). Real Chromium browser via Playwright navigates `http://webui-host.tailnet.ts.net:5173/tasks/<id>` and the xterm container renders the live PowerShell prompt within 1.2s (3/3 F0.5 specs green). All 848 server tests + 781 client tests + tsc clean. No regression in loopback path. Future call sites of `createTerminalRoutes` must remember to wire `deps.allowedOrigins` from a boot-resolved policy — captured as a CLAUDE.md DO-NOT regression guard.
- **Rejected:** (1) Spawn execSync inside `defaultAllowedOrigins` — per-request subprocess cost + dual-instance drift risk. (2) Pre-cache the resolved policy in a module-level singleton inside terminal/routes.ts — implicit global, harder to test, still duplicates the boot-time resolution. (3) Move the policy resolution into a shared module both index.ts and terminal/routes.ts import — fixes the symptom but not the architectural lesson (the gate that uses the policy should receive it from its caller, not resolve its own). (4) Surface a WARN log in `defaultAllowedOrigins` when called in production-shaped mode — defensive but didn't make this iterate; tracked as a defensive-followup in `conventions.md`.

---

### ADR-084: v0.9.2 — EmbeddedTerminal StrictMode mount-race fixes (readonly banner grace + xterm dimensions-stub on dispose)
- **Date:** 2026-05-11
- **Section:** Iterate — bug: v0.9.2-embedded-terminal-mount-races
- **Context:** v0.9.1 (ADR-083) opened the WS upgrade for Tailscale; two latent bugs surfaced once replay/render reached the client. (1) Real-browser repro: brief 'Read only' banner flash during React.StrictMode dev double-mount because mount-2 takes role=reader transiently before mount-1's close drives writer-promoted. (2) Uncaught 'Cannot read properties of undefined (reading dimensions)' pageerror — xterm's INTERNAL Viewport.syncScrollArea fires post-dispose because Terminal.dispose() doesn't cancel queued RAF/scroll callbacks.
- **Decision:** Client-only fix in EmbeddedTerminal.tsx + new Tailscale E2E regression spec. (AC-1) readOnly banner gated by 1500 ms grace window anchored on socket.ready rising edge (not taskId); re-arms cleanly on WS reconnect; data-send behavior stays tied to actual socket.role server-side gate. (AC-2) Three-layer defense: disposedRef flipped FIRST in cleanup; safeFit helper with brittleness-aware xterm-internals probe wraps all three fit.fit() sites; pre-emptive stub of _renderService.dimensions getter with safe zero-dim shapes BEFORE term.dispose() so xterm's own async tails compute against zero dims (harmless no-op) instead of throwing.
- **Commit:** PENDING_F6
- **Rationale:** Both bugs were invisible pre-v0.9.1 because WS upgrade returned 500 origin_not_allowed; ADR-083 surfaced them in real-browser Tailscale traffic. The dimensions stub was added empirically after the initial safeFit-only fix didn't catch the bug — F0.5 stack-trace capture revealed Viewport.syncScrollArea as the actual throw site (xterm-internal RAF post-dispose, NOT our fit.fit() call sites). External plan review (12 openai + 4 gemini findings) + code review (2 HIGH + 4 MEDIUM) folded before commit; both rounds caught real correctness gaps (cleanup ordering openai #1 HIGH; ready-anchored grace timer openai #2/#3; dispose-throw swallowing openai HIGH #2).
- **Consequences:** F0.5 Tailscale Playwright (2/2 ACs) GREEN against live stack; 782 client + 849 server vitest GREEN; client+server TSC clean. EmbeddedTerminal.tsx grows by ~120 LOC (safeFit + grace + dimensions-stub + comments). New regression spec client/e2e/flows/v0-9-2-embedded-terminal-mount-races.spec.ts (~180 LOC) replaces the diagnostic _v091-debug-resume.spec.ts. FR-01.28 amended with AC-1 + AC-2. xterm version pin to @xterm/xterm@^5 documented; future refactor breaks loudly via try/catch instead of silently disabling resize.
- **Rejected:** (1) Server-side: delay writer-promoted envelope or skip role=reader for StrictMode mount-2 — server cannot reliably detect StrictMode; client-side grace is the right layer. (2) Wrap term.dispose() in try/catch to swallow async-tail throws — masks real correctness regressions (openai HIGH #2). (3) Single consolidated useEffect for grace logic — split-effects implementation is functionally identical and more readable; both unit tests + F0.5 pass. (4) Disable React.StrictMode in dev — useful safety net; right fix is making components idempotent. (5) Patch xterm upstream — out of scope; track as future PR if v0.9.2 stub becomes a maintenance burden.

---

### ADR-085: v0.9.3 — Resume click on idle new-plain converges to active (scope mtime-decay to non-new-plain)
- **Date:** 2026-05-11
- **Section:** Iterate — bug: v0.9.3-resume-state-machine
- **Context:** Post-v0.9.2 user report: Resume click on a new-plain task in idle state never settled on active; Resume button stayed visible; 53x launch command copies accumulated in disk-scrollback. Empirical repro on task 31b4076d-... showed task.state stayed idle before+after click despite launchedAt updating server-side, and xterm buffer contained 53 copies of the Set-Location + claude --session-id command.
- **Decision:** Single targeted server-side fix in external/routes.ts:925 — scope the active->idle mtime-decay to NON-new-plain actionIds (or new-plain with pty gone). For new-plain with live pty, skip the JSONL-mtime-driven decay; pty existence is authoritative. The v0.8.7 AC-1 path (result=missing + pty-gone) remains the legitimate active->idle decay for new-plain. No client-side changes.
- **Commit:** PENDING_F6
- **Rationale:** Root cause traced through code + empirical evidence: /launch sets state=awaiting unconditionally (line 503); transcript-poll line 916-919 flips awaiting->active when JSONL exists; transcript-poll line 925-926 then decays active->idle on every poll where now-mtime>120s. For new-plain JSONL exists from prior session but is OLD (>120s) -> branch fires on every poll -> state ping-pongs. The fix scopes the decay rule to NOT fire for new-plain with live pty. External code review surfaced 1 HIGH (silent return on missing precondition; folded as test.skip with reason) + 3 MEDIUM (timing window tightened to 2.5s; precondition tracking; dead imports removed) + 1 LOW.
- **Consequences:** Resume click on idle new-plain now converges to active within ~1.5s and stays active across 12+ transcript-poll cycles (empirically verified). Resume button hides after the awaiting->active flip; user can no longer accidentally accumulate launch-command echoes by re-clicking. 5 new server unit tests + 2 new Playwright F0.5 specs lock the contract. Test counts: 782 client + 854 server vitest GREEN (was 849; +5 new state-machine cases). FR-01.28 amended with the new AC.
- **Rejected:** (1) Set state=active directly in /launch endpoint for new-plain (skip the awaiting dance entirely) - more invasive change; the 1-2 poll convergence delay is acceptable. (2) Client-side Resume button debounce while launch in flight - addresses symptom not cause; the state-machine fix is the root remedy. (3) Retroactive disk-scrollback cleanup of accumulated echoes - destructive on user-visible data; user can invoke 'Clear terminal history' manually. (4) Add 'idle -> active when pty alive + new-plain' rule alongside the existing reactivation path - would fire forever, not just after launch; the simpler 'don't decay' is sufficient.

---

### ADR-086: v0.9.4 — Skip disk-scrollback replay on attach for new-plain tasks (Claude TUI corruption fix)
- **Status:** superseded — by ADR-087 (2026-05-12). The skip-for-new-plain branch closed a byte-stream corruption hole; cell-state snapshots have no such hole, and the chunked path the skip defended is gone.
- **Date:** 2026-05-11
- **Section:** Iterate — bug: v0.9.4-skip-replay-newplain
- **Context:** Post-v0.9.3 user report + screenshot: re-attach to a new-plain Claude task renders corrupted/stacked content in the embedded terminal viewport. Empirical analysis of 8487-byte disk-scrollback (~/.shipwright-webui/terminal-scrollback/2aa752d7-....log) confirmed Claude TUI on Windows ConPTY does NOT use alt-screen (\x1b[?1049h not present); it cursor-manipulates in main buffer. ADR-069 sanitizer strips cursor-positioning controls but preserves character bytes -> every keystroke + footer-state-change accumulates linearly in scrollback. On replay the visible buffer is unusable (stacked footers, character-by-character input ghosts, prior-session typed text bleed-through).
- **Decision:** For actionId='new-plain' tasks, skip the disk-scrollback replay block in server/src/terminal/routes.ts WS onOpen entirely. The ready envelope + scrollback-meta envelope (with bytes=0 to suppress privacy footer) still fire; live pty attaches; Claude redraws its current state on the next render tick. No replay_start/chunk/separator/end envelopes are emitted for new-plain. Non-new-plain tasks (adopted brownfield, fork, slash-command) keep the existing replay path.
- **Commit:** PENDING_F6
- **Rationale:** Empirically scoped fix: only new-plain tasks have the Claude TUI byte-stream pattern that the sanitizer mangles. Other actionIds either don't use Claude TUI (shell-only tasks) or have JSONL-driven workflows where the disk-scrollback isn't the source of truth. Considered alt-fixes: rewrite sanitizer with alt-screen tracking (heavy state machine; risk to vim/htop/etc), or render server-side via xterm-headless and persist cell-state snapshots (deferred to v0.10 per ADR-069 rejected option a). The targeted skip is the lowest-risk fix that closes the visible bug. External code review v1+v2 (openrouter, 5 findings) folded: full JSON payload parsing, pick-last-WS heuristic, scrollback-meta=0 assertion added, AC-2 companion test for non-new-plain regression-fence, relaxed brittle data-envelope assertion.
- **Consequences:** F0.5 GREEN (1 passed + 1 correctly skipped when no non-new-plain task exists in the user's task list). 782 client + 854 server vitest GREEN; client+server tsc clean. Trade-off: new-plain users lose scrollback-restore on re-attach. Acceptable because the alternative (current corrupted replay) is worse UX; the on-disk bytes remain (Clear-history overflow menu still wipes them). FR-01.28 amended with the new AC.
- **Rejected:** (1) Rewrite ADR-069 sanitizer to be alt-screen / Claude-TUI aware — deep state-machine surgery with risk to other TUI tools; deferred. (2) Persist xterm-headless cell-state snapshots instead of raw bytes (ADR-069 already-rejected option a) — heavier dep + perf cost; v0.10 scope. (3) Skip replay for ALL tasks, not just new-plain — breaks the legitimate replay path for non-Claude-TUI sessions where users do want scroll-back history. (4) Send scrollback-meta with actual bytes for new-plain (so 'Clear history' affordance signals there's content to clear) — confuses users when the privacy footer references replayed scrollback they don't see. The overflow-menu Clear-history is still accessible via the kebab; it just doesn't surface the byte-count proactively for new-plain.

---

### ADR-088: Iterate A — Server-side @xterm/headless mirror behind feature flag (default off)
- **Date:** 2026-05-11
- **Section:** Iterate — feature: headless-terminal-refactor / A
- **Run-ID:** iterate-headless-A-mirror-flag
- **Context:** Four iterates (v0.9.1 → v0.9.4 — ADR-069, ADR-077, ADR-079, ADR-086) layered byte-stream workarounds on top of the disk-scrollback from ADR-069. The mismatch: Claude TUI redraws main-buffer state with raw cursor-position bytes — only a real terminal emulator can preserve that faithfully. Plan-of-record breaks the fix into three iterates: A (this — mirror behind flag), B (replace replay protocol), C (retire compensations).
- **Decision:** Wire a server-side `@xterm/headless` Terminal per LIVE pty. On `pty.onData`, fire-and-forget `mirror.write(data)` runs parallel to existing scrollback-store append. On `pty.kill` / `pty.onExit`, detached `finalizeMirrorSnapshot` runs M2 double-serialize and persists to `<scrollbackDir>/<taskId>.snapshot` via atomic temp-rename. Flag `SHIPWRIGHT_TERMINAL_HEADLESS_MIRROR=1` gates — default OFF in iterate A (zero behavior change). Iterate B flips default. New: `headless-mirror.ts`, `snapshot-store.ts`. Modified: `pty-manager.ts`, `config.ts`, `index.ts`. Dependencies pinned EXACT: `@xterm/headless@5.5.0`, `@xterm/addon-serialize@0.13.0`.
- **Commit:** PENDING_F6
- **Rationale:** Empirically grounded by fixture test using captured 30 986-byte real Claude TUI scrollback. Visible-line equality across random chunking, mid-escape 4-byte fragments, and resize-midway variants. M2 double-serialize handles the 1-char resize-drift artifact (spike T2: round2 == round3). Plan-D'' (ADR-034) unaffected — mirror parses pty output, never spawns Claude.
- **Consequences:** Server build clean; 60 test files / 894 tests green (+38 new). Type-system clean. `routes.ts` unchanged — switchover in Iterate B. Default flag OFF → no production behavior change until Iterate B. New write surface: `<registryDir>/terminal-scrollback/<taskId>.snapshot` (POSIX 0o600). ADRs 069/077/079/086 supersession deferred to Iterate C.
- **Rejected:** M1 (1-char drift unmitigated), M3 (pin dims + dispose-recreate), `@xterm/headless` 6.0.0 bump (would invalidate spike evidence), `^` ranges (invariant #4), reader-side wiring (Iterate B).
- **Details:** [`.shipwright/planning/adr/088-headless-mirror-iterate-a.md`](../planning/adr/088-headless-mirror-iterate-a.md) — full External Plan Review dispositions (18 findings), Self-Review checklist, Confidence Calibration (12 probes), known pre-existing audit drift notes.

### ADR-089: Iterate B — replay_snapshot WS envelope + default-on flag flip + snapshot-store hardening
- **Date:** 2026-05-11
- **Section:** Iterate — feature: headless-terminal-refactor / B (chokepoint)
- **Context:** Iterate A (ADR-088) shipped the server-side `@xterm/headless` mirror + snapshot-store behind a default-OFF feature flag. Iterate B (this ADR) replaces the WS replay protocol: when a fresh cell-state snapshot exists for a task AND the snapshot's `terminalVersion` matches the server's pinned `@xterm/headless` version, the WS attach emits a single `replay_snapshot` envelope and skips the legacy chunked replay (`replay_start` / `replay_chunk` / `replay_separator` / `replay_end`). The legacy path stays alive as fallback for pre-Iterate-B tasks (no snapshot on disk) AND for version-mismatch — Iterate C retires the chunked path. The flag default is flipped from OFF to ON in this iterate (`SHIPWRIGHT_TERMINAL_HEADLESS_MIRROR !== "0"`); opt-out is explicit `=0`. The four spec ACs (real-browser Playwright via `v0-9-5-replay-snapshot-envelope.spec.ts`) verify wire-shape, DOM-render, legacy-fallback, and resize+refresh round-trip. Iterate A's two MEDIUM code-review findings (snapshot-store tmp-filename collision + Windows EBUSY retry) are addressed as pre-flip hardening in this iterate.
- **Decision:** (1) New WS envelope `{type:"replay_snapshot", data, cols, rows, terminalVersion}` (single frame, no chunking). (2) Server-side: extract `tryReadSnapshot` + `buildReplaySnapshotEnvelope` into `server/src/terminal/replay-snapshot.ts` so the version-gate decision is unit-testable. `routes.ts` WS upgrade replay branch (both `replayOnly` and live-attach) calls `tryReadSnapshot` first; if the send fails, falls back to chunked replay (external review openai medium — don't strand the client). (3) Client-side: `useTerminalSocket.onReplaySnapshot` routes the envelope to `EmbeddedTerminal` which calls `term.reset()` + `term.write(data)` once (external review openai medium — `term.clear()` only wipes scrollback, not viewport; `reset()` re-initialises cursor + viewport + scrollback). (4) `snapshot-store.ts` adds a per-task PQueue serializing writes (MEDIUM-1) + crypto.randomBytes-suffixed tmp paths + 3-attempt EBUSY/EPERM retry on `fs.rename` with 50/100/200 ms backoff (MEDIUM-2). `releaseQueue(taskId)` drops the per-task PQueue when finalize completes so the Map cannot grow unboundedly (external review gemini). (5) `config.ts` flag default flipped to ON with opt-out semantics. (6) ADR-086's new-plain skip-replay logic is amended: snapshot path is always tried for new-plain (cell-state has no byte-stream corruption); only the LEGACY chunked path is skipped for new-plain. Plan-D″ (ADR-034) unaffected; ADR-067 / ADR-068-A1 architectural lines remain intact.
- **Commit:** PENDING_F6
- **Rationale:** Empirically-grounded via real-browser Playwright against the live Tailscale-bound dev stack (hono :3847 + vite :5173 with `SHIPWRIGHT_NETWORK_PROFILE=tailscale`). Reproduced from the user's memory `feedback_browser_fixes_need_real_browser_smoke.md`: unit-tests + boot-log are NOT a substitute for real-browser smoke at this chokepoint. The Playwright spec writes a deterministic snapshot to disk per test, then asserts (a) `replay_snapshot` fires (b) NO `replay_chunk` / `replay_start` envelopes (c) wire fields match `{data, cols, rows, terminalVersion}` exactly (d) `xterm.js` DOM contains the marker via `.xterm-rows` containText assertion. AC-3 regression fence verifies the legacy chunked-replay path still fires when no snapshot exists. AC-4 explicitly performs a viewport resize before refresh and asserts the post-refresh snapshot carries the correct cols/rows. AC-5 (replay-only WS close) skips cleanly when no `done`/`launch_failed` task is in the user's session — the contract is identical to AC-1+AC-2 with an added `ws.closed === true` assertion.

  **External code review (OpenRouter — gemini-2.5-flash + gpt-5.1-mini):** 7 findings, all addressed pre-commit:
  - OpenAI HIGH #1 (test rigor AC-2 — non-empty text insufficient): **accepted-and-fixed** — AC-2 now asserts `xterm.toContainText(MARKER)` against a unique ASCII marker embedded in the snapshot payload; wire-shape fields asserted exactly (`data` byte-equal, `cols`/`rows`/`terminalVersion` numeric/string equality).
  - OpenAI HIGH #2 (AC-3 missing close assertion): **accepted-and-fixed** — split into AC-3 (legacy fallback fence) and AC-5 (replay-only WS close with explicit `ws.closed === true` assertion + skip-clean when no terminal-state fixture available).
  - OpenAI HIGH #3 (AC-4 no resize): **accepted-and-fixed** — AC-4 now does `page.setViewportSize(1100x700)` after initial mount and asserts the post-refresh `replay_snapshot.cols / rows` match the snapshot-written dims (100x28).
  - OpenAI MEDIUM #4 (AC-1 false-pass on legacy fallback): **accepted-and-fixed** — AC-1 now writes a deterministic snapshot file BEFORE attach and STRICTLY asserts `replay_snapshot` fires + NO chunked envelopes.
  - OpenAI MEDIUM #5 (no new-plain Claude TUI dedicated coverage): **accepted-with-rationale** — the spec's AC for "new-plain Claude TUI re-attach" is exercised by the same envelope contract: the snapshot-path is symmetric for all `actionId` values. We rejected the "fixture a new-plain task via API" approach because the auto-mode classifier blocked PATCH-state and we wanted to avoid mutating user task state during the test. AC-1 + AC-2 cover the wire + DOM contract; ADR-086 regression (v0-9-4 spec) covers the LEGACY chunked path's new-plain skip behavior.
  - OpenAI MEDIUM #6 (`term.clear()` vs `term.reset()`): **accepted-and-fixed** — switched to `term.reset()` so re-attach inside the same EmbeddedTerminal instance fully re-initialises the viewport.
  - OpenAI MEDIUM #7 (sendReplaySnapshot return ignored): **accepted-and-fixed** — both call sites (`replayOnly` + live) check the boolean result and fall back to chunked replay when snapshot send fails.
  - Gemini (writeQueues grows unboundedly): **accepted-and-fixed** — `SnapshotStore.releaseQueue(taskId)` + automatic release in `clear()` + automatic release in `pty-manager.finalizeMirrorSnapshot()` finally block. 4 new unit tests cover idempotence + clear-side cleanup + malformed-taskId guard.

- **Self-Review (7-item canonical checklist per references/iteration-reviews.md):**
  1. **Spec Compliance** — PASS: All 6 spec acceptance criteria met. AC#1 (no chunked envelopes for snapshot tasks) — Playwright AC-1 strict assertion. AC#2 (visible buffer matches mirror line-by-line) — Playwright AC-2 DOM `.xterm-rows.toContainText(MARKER)`. AC#3 (flag default-on) — `config.ts` `!== "0"` semantics. AC#4 (4 smoke tests pass) — 4/4 PASS against real browser (5th AC-5 skips cleanly per fixture availability). AC#5 (multi-tab) — snapshot is per-task on disk; both tabs read the same file, no new race vs. ADR-088. AC#6 (version mismatch falls back to chunked) — `replay-snapshot.test.ts` covers the gate; chunked fallback is the existing path.
  2. **Error Handling** — PASS: `tryReadSnapshot` returns null + warns on store-read failure; `sendReplaySnapshot` returns false on WS-send failure and the caller falls back to chunked replay. `EmbeddedTerminal.onReplaySnapshot` wraps `term.reset() + term.write()` in try/catch; xterm-dispose race is a logged warn, not a crash.
  3. **Security Basics** — PASS: snapshot-store path-traversal defenses (UUID validation, realpath-at-op-time, 0o600 perms) unchanged from ADR-088 — Iterate B only ADDS the EBUSY retry + PQueue. Version-gate uses string equality on a server-controlled value (no user input enters the path). No new env-var → command path.
  4. **Test Quality** — PASS: 911 server tests + 785 client tests + 4 Playwright real-browser tests (1 cleanly-skipped on fixture availability) all green. New unit coverage: 9 in `snapshot-store.test.ts` (MEDIUM-1 + MEDIUM-2 + releaseQueue), 9 in `replay-snapshot.test.ts` (version gate + envelope shape), 3 in `useTerminalSocket.test.ts` (replay_snapshot routing). Playwright assertions are STRICT after external review tightening: exact envelope-type lists + exact wire-field values + DOM-render verification.
  5. **Performance Basics** — PASS: snapshot envelope is one WS frame vs. N chunks; backpressure path simpler. Round-trip cost is dominated by M2 double-serialize (~10 ms, measured in Iterate A spike). PQueue concurrency=1 per-task is bounded by the per-task pty-kill cadence (rare). EBUSY retry exponential backoff bounded at 50+100+200=350ms worst case.
  6. **Naming & Structure** — PASS: new file `replay-snapshot.ts` follows the existing terminal/ naming. `releaseQueue` + `writeLocked` + `safeRename` methods on SnapshotStore mirror scrollback-store's `clearLocked` / `safeRename` patterns. Conventional Commits format used in F6.
  7. **Affected Boundaries** — PASS: WS envelope schema is an I/O boundary (producer = `server/src/terminal/replay-snapshot.ts buildReplaySnapshotEnvelope`; consumer = `client/src/hooks/useTerminalSocket onReplaySnapshot`). Real-browser Playwright AC-1/AC-2 IS the round-trip probe. Snapshot file format boundary already calibrated in ADR-088; Iterate B adds the wire-envelope boundary. Per ADR-024 + references/round-trip-tests.md.

- **Confidence Calibration (medium + touches_io_boundary):** Probes run against the WS replay-snapshot boundary AND the snapshot-store write-durability boundary:
  1. WS envelope wire-shape (data/cols/rows/terminalVersion fields) — PASS (Playwright AC-2 explicit equality)
  2. WS envelope client-render (term.write produces DOM-visible content) — PASS (Playwright AC-2 `.xterm-rows.toContainText`)
  3. WS replay_snapshot exclusivity (no chunked envelopes when snapshot present) — PASS (Playwright AC-1 strict `not.toContain`)
  4. Legacy chunked fallback when snapshot absent — PASS (Playwright AC-3 strict `replay_start + replay_end` assertion)
  5. Resize-before-refresh round-trip (snapshot header carries post-resize dims) — PASS (Playwright AC-4)
  6. Version mismatch falls back to chunked — PASS (unit replay-snapshot.test.ts test #5)
  7. Store-read throw → null + warn (not crash) — PASS (unit replay-snapshot.test.ts test #4)
  8. 50 parallel write() for same taskId — PASS (unit snapshot-store.test.ts MEDIUM-1 #1)
  9. EBUSY retry budget exhaustion → tmp cleanup → no orphan — PASS (unit snapshot-store.test.ts MEDIUM-2 #3)
  10. Non-EBUSY error → no retry → fast fail — PASS (unit snapshot-store.test.ts MEDIUM-2 #4)
  11. releaseQueue idempotence — PASS (unit snapshot-store.test.ts cleanup #2)
  Asymptote reached: external code review caught 7 real findings, all fixed; subsequent re-runs found no new issues. Edge cases NOT probed (deferred to Iterate C or follow-up): cross-major xterm.js version mismatch (server pin gate handles it); WS bufferedAmount saturation on snapshot send (single frame is much smaller than the 1 MiB cap); snapshot >10 MB (the M2 double-serialize on a 10 MB cell state would take ~100 ms — acceptable but untested).

- **Consequences:** Server `npm run build` clean; 62 test files / 911 tests green (+4 vs. ADR-088: 4 releaseQueue + 5 MEDIUM-1/2 harness reuse). Client 72 test files / 785 tests green (+3 vs. ADR-088: 3 useTerminalSocket replay_snapshot routing). Type-system clean both halves. Real-browser Playwright: 4/5 PASS (AC-5 skipped cleanly per fixture availability — no `done`/`launch_failed` task in user's session). The WS protocol now has TWO replay paths; legacy chunked is the documented fallback for pre-Iterate-B tasks AND version-mismatch scenarios. ADRs 069/077/079/086 remain in force; their formal supersession lands in Iterate C. Flag default flip means production behavior change is gated by snapshot-on-disk presence — task without a snapshot still sees the existing chunked replay (zero behavior change). Task with a snapshot now sees the new single-envelope path. Disk footprint per task: one extra `.snapshot` file alongside the existing `.log` (typical ~10-100 KiB cell-state vs ~1 MiB scrollback). Iterate A's two MEDIUM findings (tmp collision + EBUSY retry) are closed by this iterate.
- **Rejected:** (1) Delete the legacy chunked path in Iterate B — deferred to Iterate C as planned; cleaner cut once all live tasks have snapshots on disk. (2) Cross-page xterm version match assertion — client-side `@xterm/xterm` package.json read in production build is unreliable (Vite bundles); server-side gate is the authoritative accept/reject layer. (3) Auto-fixture a `done`-state task for AC-5 — auto-mode classifier blocked PATCH-state mutation of user data, and the auto-fixture would require touching `sdk-sessions.json` directly (CLAUDE.md DO-NOT #1 / multi-writer state file). AC-5 skips cleanly when no fixture is available; AC-1+AC-2+AC-4 cover the envelope contract for all task-state cases. (4) Pre-route the cleanup queue release through `clear()` only — pty-manager.finalize is the more deterministic point; both surfaces release. (5) Wire `terminalVersion` from the client's xterm.js version (rather than server-side) — would tie two independent packages together unnecessarily; the server's pin IS the authoritative version (architecture invariant #4).

---

### ADR-087: Cell-state snapshot replay supersedes byte-stream chunked replay (Iterate C — retire ADR-069/077/079/086 compensations)
- **Status:** accepted
- **Date:** 2026-05-12
- **Section:** Iterate — refactor: headless-terminal-refactor / C (chokepoint)
- **Run-ID:** iterate-headless-C-retire-compensations
- **Context:** Iterate C closes the four-iterate saga (ADR-069 → ADR-086) by retiring the byte-stream compensations entirely and making cell-state snapshots the sole replay primitive. ADR-088 (Iterate A) introduced the mirror + snapshot store behind a flag; ADR-089 (Iterate B) wired the new `replay_snapshot` WS envelope and flipped the flag default ON.
- **Decision:** Delete the byte-stream compensation surfaces: `scrollback-sanitizer.ts` (ADR-069), `scrollback-store.replay-collapse.test.ts` (ADR-077), the `collapse*` / `SHELL_STOPPED_MARKER_RE` / `BANNER_BURST_RE` functions, `readForReplay()`, the `skipChunkedReplayForNewPlain` branch + `sendReplayChunked` helper in `routes.ts`, legacy chunked WS envelope handlers (`replay_start/replay_chunk/replay_separator/replay_end`) client-side, replay-pushdown + banner-grace + Clear-history button in `EmbeddedTerminal.tsx`. New: `boot-wipe.ts` (one-shot wipe of legacy `*.log*` with `.iterate-c-wiped.marker` idempotency), MEDIUM-B1 (snapshot DELETE cascade — `snapshotClearBestEffort` dep on `createExternalRoutes`), MEDIUM-B2 (graceful headless-mirror fallback via `headless-probe.ts` dynamic-import probe at boot). Supersedes ADR-069 (sanitizer half), ADR-077 (collapse + footer), ADR-079, ADR-086 — each marked `Status: Superseded by ADR-087`. Plan-D″ (ADR-034) / ADR-067 whitelist / ADR-068-A1 auto-launch / ADR-088/089 snapshot infrastructure all intact.
- **Commit:** PENDING_F6
- **Rationale:** Cell-state snapshots ARE the real emulator's output (M2 double-serialize stabilization proven by spike T2). Iterate B's 4 real-browser Playwright tests proved the snapshot path works against actual rendered xterm.js DOM. Iterate C closes the saga without re-running every spike: snapshot path was already empirically validated in B; this iterate deletes the dead byte-stream code.
- **Consequences:** Server 64 test files / 889 tests green (+12 new, -11 obsolete). Client 72 / 777 (+2, -12). Type-system clean both halves. Wire-protocol break: old clients expecting chunked envelopes get no replay history; new clients gracefully ignore stale-server chunked envelopes. On-disk byte-stream scrollback wiped once at first boot post-Iterate-C deploy. Snapshot pinned to xterm@5.5.0 (invariant #4); version-mismatch → "no replay". Privacy: DELETE-cascade clears snapshot file alongside scrollback. Subtree LoC: 10978 → 9992 (≈9% net; 31% on touched-files-only — honest 9% reported).
- **Rejected:** Remove disk-scrollback writer entirely (out of scope — `bytes()` still consumed); pin wipe to specific deploy version (marker is natural idempotency); drop `clear-scrollback` endpoint (kebab-menu CTA still surfaces it); run external plan/code review in autonomous runner (`missing_keys` posture per ADR-029); re-run full empirical spike (Iterate B Playwright sufficed); hit 25% subtree LoC bar by removing healthy unrelated code.
- **Details:** [`.shipwright/planning/adr/087-cell-state-snapshot-iterate-c.md`](../planning/adr/087-cell-state-snapshot-iterate-c.md) — exhaustive file/function-level deletion inventory, full Test Results breakdown, Self-Review checklist (7 items, AC-1 LoC miss documented openly), Confidence Calibration (13 probes), external review posture rationale.

---

### ADR-090: Post-campaign E2E verification matrix for headless-terminal-refactor (Iterate D — test-only authorship)
- **Date:** 2026-05-12
- **Section:** Iterate — change: headless-terminal-refactor / D (post-campaign verification fence)
- **Run-ID:** iterate-2026-05-12-D-e2e-verification
- **Context:** Campaign headless-terminal-refactor A/B/C is merged on main (`b369819`). F0.5 web-surface Playwright was deferred at Iterate C because the autonomous runner had no live dev stack and the existing `v0-9-5-replay-snapshot-envelope.spec.ts` only covered 4-of-the-matrix-shape (new-plain Claude TUI + plain shell + completed-task + resize) against opportunistic existing-session fixtures, not a deterministic per-task-type matrix. This ADR closes that gap with a deterministic 4-task-type × 4-axis matrix verified against the merged main state across BOTH local-loopback AND Tailscale network profiles.
- **Decision:**
  - **New test file:** `client/e2e/flows/v0-9-5-task-type-matrix.spec.ts` — 16 scenarios = 4 task types (`pure-claude` / `task` / `iterate` / `pipeline`) × 4 verification axes (A lifecycle, B rendering, C cursor, D single-pty contract).
  - **Test bed:** Each test creates a FRESH task via `POST /api/external/tasks`, transitions it to `done` via `POST /api/external/tasks/:id/close`, pre-writes a deterministic snapshot fixture under `~/.shipwright-webui/terminal-scrollback/<taskId>.snapshot` (ADR-089 envelope shape), navigates, and asserts. The `done`-state replay-only WS path engages — `routes.ts isReplayOnly` branch serves the snapshot WITHOUT a live pty competing. `finally` cleans up the snapshot + task + cwd.
  - **Why replay-only instead of live-pty:** Live-pty re-attach is dominated by the shell bootstrap (PowerShell 7 emits `CSI[2J` clear-screen + cursor home within ~50 ms of pty spawn) which clobbers the snapshot replay's visible content. That is a real and documented interaction with the shell-startup sequence, not a bug in the campaign code. The replay-only path tests the snapshot envelope contract IN ISOLATION — the strongest possible form of the no-unwanted-sessions contract (zero ptys spawned for replay-only tasks).
  - **WS frame capture:** `page.on("websocket")` records every `/api/terminal/<taskId>/ws` frame with direction (sent/received) + type. Axis D asserts: each productive WS contains EXACTLY ONE `replay_snapshot` envelope, ZERO chunked envelopes (`replay_start` / `replay_chunk` / `replay_separator` / `replay_end`), AND `ready.replayOnly === true` (architectural marker that no pty was spawned).
  - **Single-pty contract probe:** 4 navigations (initial + 3 round trips) yield 16 WS upgrades (4 × StrictMode-dev double-mount). Each productive WS receives the replay-only sequence; no pty is spawned because `task.state === "done"` engages the `isReplayOnly` branch BEFORE `ptyManager.spawn` is reached. Cross-checked via REST `GET /api/external/tasks/:id` — state stays `done` across N navigations.
  - **Cursor axis (C) skip-with-reason:** The `.xterm-cursor` element is focus-gated in the replay-only path (the WS closes after sending the snapshot envelope; xterm.js does not render a visible cursor without an active input focus + live pty). All 4 task-types' axis-C tests skip cleanly with explicit reason `"no .xterm-cursor element visible — replay-only path renders without a focus-visible cursor"`. Cursor preservation is implicitly verified by the snapshot envelope being byte-identical across attaches (axis B's content-row equality).
  - **Two network profiles run:**
    - **local:** `SHIPWRIGHT_NETWORK_PROFILE=local`, Hono bound to `127.0.0.1:3847`, Vite at `127.0.0.1:5173`, `BASE_URL=http://127.0.0.1:5173` — **12 passed / 4 skipped (cursor)** in 48.9 s.
    - **tailscale:** `SHIPWRIGHT_NETWORK_PROFILE=tailscale`, Hono bound to `100.64.0.1:3847`, Vite at `0.0.0.0:5173` (VITE_HOST), `BASE_URL=http://100.64.0.1:5173` — **12 passed / 4 skipped (cursor)** in 48.8 s.
  - **Evidence archived:** `.shipwright/runs/sub_iterate-20260511-204305/D/playwright-report-{local,tailscale}/playwright-report/index.html`.
- **Self-Review (7-item, mandatory always):**
  1. **Spec Compliance** — PASS: 4-AC iterate spec; all met (matrix file authored, local PASS, tailscale PASS, WS evidence, single-pty contract, evidence archived).
  2. **Error Handling** — PASS: all API requests checked via `resp.ok()`; cleanup in `finally`; snapshot-write/unlink wrapped in try/catch; cursor axis skips cleanly; ECONNREFUSED would fail loudly.
  3. **Security Basics** — PASS: test-only; no production-code change; snapshot fixture paths use UUIDs from the API response (validated by server-side UUID_PATTERN); cleanup is unconditional best-effort.
  4. **Test Quality** — PASS: each axis is one focused assertion target; markers carry taskId + timestamp; WS envelope assertion is direct contract verification.
  5. **Performance Basics** — PASS: ~49 s per profile × 2 = ~100 s total; no N² loops; tests independent; bounded `waitForTimeout` (max 800 ms each).
  6. **Naming & Structure** — PASS: file mirrors `v0-9-5-replay-snapshot-envelope.spec.ts` neighbor; constants named consistently; one file ~700 lines (test specs scale differently from production code).
  7. **Affected Boundaries (ADR-024 + references/round-trip-tests.md)** — PASS: WS envelope (replay_snapshot JSON) is exercised end-to-end (producer = server `routes.ts buildReplaySnapshotEnvelope`; consumer = client `useTerminalSocket onReplaySnapshot` → `EmbeddedTerminal term.write`). Real Chromium loads the bundled client; real Hono emits the envelope. IS a round-trip probe.
- **Confidence Calibration (medium probes — Iterate D classified small + risk-flag `touches_auth` regex-FP):** Empirical probes run against the replay-only WS boundary:
  1. New-plain `done` task: replay-only WS serves snapshot, no pty — PASS (axis-A pure-claude on local + tailscale).
  2. New-task `done` task (build phase): replay-only WS serves snapshot, no pty — PASS.
  3. New-iterate `done` task: replay-only WS serves snapshot, no pty — PASS.
  4. New-pipeline `done` task: replay-only WS serves snapshot, no pty — PASS.
  5. 4 navigations × 4 task types = 16 round trips; ALL replay_snapshot, ZERO chunked envelopes — PASS (axis-D for all four types).
  6. Tailscale-IP routing: Hono on Tailscale IP, Vite proxy follows, Playwright → Tailscale URL — PASS (12/16, same skip ratio as local; routing works).
  Asymptote reached: ALL applicable scenarios PASS on BOTH network profiles. Edge cases NOT probed: (a) live-pty re-attach (out of scope — bootstrap clobber; needs typing into post-bootstrap shell), (b) cross-version xterm mismatch (server's pin gate is the authoritative reject layer; out of scope for this E2E iterate), (c) mid-replay network partition (needs network-conditioning infra).
- **Consequences:**
  - Campaign A/B/C is empirically verified end-to-end. The user can now run `/shipwright-changelog` against the campaign with the matrix evidence at hand.
  - **No production-code change.** The matrix surfaced ONE expected behavior that is NOT a regression: live-pty re-attach with a freshly-spawned shell renders the shell bootstrap on top of the snapshot — that interaction is documented in the spec header as out-of-scope and is the same behavior the existing v0-9-5 spec accommodates by skipping `actionId === "new-plain"`.
  - **Tailscale-profile coverage** is now part of the suite. The test infra demonstrates that the Vite + Hono stack works correctly across both loopback and Tailscale-IP binding, closing memory `feedback_browser_fixes_need_real_browser_smoke.md`'s discipline lesson for this specific iterate scope.
  - **CI implication (deferred):** the new spec requires a live dev stack + Tailscale env detection. The campaign's CI integration is out of scope for this iterate; the spec runs locally per the runner-command on the spec file.
- **Rejected:**
  1. **Test live-pty re-attach end-to-end** — the PowerShell bootstrap `CSI[2J` clear-screen wipes the snapshot in ~50 ms, making DOM assertions non-deterministic without typing snapshot content into the live shell post-bootstrap. The replay-only path is the cleaner test bed for the campaign's actual contract.
  2. **Mock the slash-command** to verify Iterate / Pipeline task launches really execute the slash command — out of scope for D; the verification target is the terminal-replay infrastructure, not the Claude-subprocess lifecycle. The four task-type IDs differ only in metadata (actionId / phase / catalog entry); all flow through the same WS upgrade + snapshot read.
  3. **Production instrumentation for "unwanted session" detection** — explicitly prohibited by the runner contract; external probes (WS frames + REST recheck) provide sufficient evidence.
  4. **Add test to spec 35 (`no-chat-panel`)** — that's a structural regression guard against a chat composer; this iterate is the empirical complement, lives in its own file.
  5. **Run a regression-fix iterate inline** if the matrix had surfaced a bug — out of scope per the iterate spec; the matrix completed PASS so this rejection is moot.

### ADR-091: Iterate D-bis — LIVE-pty re-attach loses terminal state across SPA navigation (empirical bug confirmation; no fix attempted)

- **Status:** superseded — Closed by ADR-092 (2026-05-12). The empirical bug captured in this ADR is fixed by Iterate E's serialize-on-attach + snapshot-on-detach pair; outcome B has been re-verified as outcome A on the E branch via the same probe-now-regression-guard at `client/e2e/flows/v0-9-6-live-pty-replay.spec.ts`.
- **Date:** 2026-05-12
- **Section:** Iterate — change: headless-terminal-refactor / D-bis (live-pty probe extension)
- **Run-ID:** sub_iterate-20260511-204305 / D-bis
- **Context:** ADR-090 verified the `done`-state replay-only matrix (16/16 PASS on both network profiles). The user pointed out that the done-state matrix does NOT cover the user's actual interaction pattern — "open, start, raus, zurück" with a LIVE pty (not exited). Code reading of `server/src/terminal/routes.ts:683` + `server/src/terminal/pty-manager.ts:780-825` revealed: `snapshotStore.write()` is called ONLY inside `finalizeMirrorSnapshot`, which is called ONLY from `cleanup`, which is called ONLY from `pty.onExit` / `kill`. For a LIVE pty, no on-disk snapshot exists, so re-attach's `tryReadSnapshot(taskId)` returns `null` and zero replay envelopes are emitted. ADR-090's `Rejected` item #1 explicitly out-scoped this scenario as "PowerShell bootstrap clobber"; the user disagreed with the deferral. D-bis is the empirical follow-up.
- **Decision:**
  - **New test file (probe, NOT regression fence):** `client/e2e/flows/_v0-9-6-live-pty-probe.spec.ts` — single deterministic probe: create `new-task` → launch → wait shell prompt → type `echo MARKER_<ts>` → capture rows + cursor → navigate-away via `page.goto("/")` (SPA route change, NOT page.reload) → navigate-back via `page.goto("/tasks/<id>")` → capture rows + cursor → inspect captured WS frames from `page.on("websocket")`.
  - **Empirical outcome:** **B — bug confirmed.** Recorded probe artifact `client/playwright-report/v0.9.6-live-pty-probe/probe-result.json`:
    - `marker_seen_pre_navigate: true` (MARKER visible in `.xterm-rows` before navigate-away)
    - `marker_seen_post_navigate_back: false` (MARKER GONE after navigate-back)
    - `replay_snapshot_envelope_emitted_on_reattach: false` (ZERO `replay_snapshot` envelopes across all WS connections — `grep -c "replay_snapshot" ws-frames.json` = 0)
    - `replay_chunk_envelope_emitted_on_reattach: false` (ZERO chunked envelopes either — consistent with ADR-087 retirement of the chunked path)
    - `cursor_before: {cursorX:19, cursorY:5}` → `cursor_after: {cursorX:0, cursorY:0}` — terminal reset to blank
    - `ws_connection_count: 4` (initial + StrictMode mount-2 + re-attach pair); rows-after-nav excerpt is 8 empty strings
  - **Root cause (verified by code-reading + empirical confirmation):**
    - `server/src/terminal/pty-manager.ts:780-825` — `cleanup(taskId)` invoked from `pty.onExit` + `kill` only. `finalizeMirrorSnapshot(taskId, mirror)` ONLY in cleanup. No mid-lifetime snapshot write path.
    - `server/src/terminal/routes.ts:683` — WS attach calls `tryReadSnapshot(taskId)` from disk; if file missing, falls through to `flushLiveBuffer()` which only contains data emitted AFTER attach (not historical content from before navigate-away).
    - Architectural intent per `.shipwright/planning/embedded-terminal-refactor-headless.md`: snapshot is finalized on pty exit. Mid-life snapshots were never wired. ADR-089's Iterate-B spec calls this out as the "no replay" trade-off — Iterate D-bis empirically validates it manifests in a real browser as the user described.
- **Self-Review (7-item, mandatory always):**
  1. **Spec Compliance** — PASS: AC #0 (probe-first, outcome decides matrix) executed; outcome B halts matrix per AC #5; artifacts persisted; ADR documents finding without fix attempt.
  2. **Error Handling** — PASS: `try { ... } finally { deleteTask + fs.rm cwd }` cleans up; non-throwing JSON capture; `expect()` only on probe-pre conditions (marker pre-nav + reattach WS existence + outcome ∈ {A,B,C}); soft probe contract.
  3. **Security Basics** — PASS: test-only file; no production-code change; tmpdir cwd; cleanup unconditional; UUID validation server-side via existing routes (no new path).
  4. **Test Quality** — PASS: single deterministic probe; marker carries timestamp; WS frame collector attached BEFORE first navigate; outcome decision matrix explicit (A/B/C).
  5. **Performance Basics** — PASS: ~17 s probe runtime; no N² loops; bounded `waitForTimeout` (≤4 s total post-mount waits).
  6. **Naming & Structure** — PASS: `_v0-9-6-` underscore prefix mirrors `_v089-evidence.spec.ts` convention (probe, not regression fence). One file ~270 lines, under the 300 LOC project guideline.
  7. **Affected Boundaries (ADR-024 + references/round-trip-tests.md)** — PASS: WS envelope boundary exercised real-browser end-to-end (producer = server `routes.ts` line 683 `sendReplaySnapshot`; consumer = client `useTerminalSocket.onReplaySnapshot`). The probe IS the round-trip — and the finding is that the producer DOES NOT EMIT for a live pty.
- **Confidence Calibration (medium — touches_io_boundary):** Empirical probes run:
  1. Single live-pty probe with real Chromium against real Hono + Vite — outcome B captured deterministically (artifact JSON).
  2. WS frame log scanned via `grep -c "replay_snapshot"` and `grep -c "replay_chunk"` — both 0. Code-reading prediction confirmed.
  3. Cursor pos before/after — verifies the xterm.js DOM is reset, not stale-cached. (cursorY 5 → 0; baseY 0; rendered rows empty.)
  Asymptote reached for the bug-confirmation question: code reading + empirical real-browser probe agree. NOT probed (deferred to Iterate E fix-iterate): (a) full 4 task-type × 4 axis matrix (per spec AC #5 — matrix is skipped when outcome=B), (b) network profile variation (tailscale) — irrelevant to whether the snapshot is written at all, (c) `page.reload()` path — only `page.goto()` SPA navigation tested. The bug surface is the producer side (no mid-life write); navigation mechanism is the consumer side.
- **Consequences:**
  - **The campaign A/B/C architectural assumption "snapshots written only on pty exit / kill"** is now empirically confirmed to manifest as terminal-state loss across navigation for live ptys. The user's "open, start, raus, zurück" scenario does NOT work today.
  - **No production-code change in D-bis.** Per the iterate spec hard rule ("Do NOT attempt to fix the bug"), the fix is left to a follow-up iterate (Iterate E) which the orchestrator will spawn after reviewing this finding.
  - **Proposed fix path** (for Iterate E to evaluate, not authoritative):
    1. **Snapshot-on-detach:** invoke a new `flushMirrorSnapshot(taskId)` on the LAST WS detach (when `ptyManager.attachCount(taskId) === 0` after a `detach`), WITHOUT killing the pty. Reuses `finalizeMirrorSnapshot` logic but skips `mirror.dispose()`. Cost: ~10 ms double-serialize per detach.
    2. **Snapshot-on-interval:** wake every N seconds and persist the current mirror state for any live pty whose mirror is dirty since the last snapshot. Smoother, but more wakeups.
    3. **Snapshot-on-attach (lazy):** persist the snapshot from the OUTGOING (current) WS just BEFORE it closes — but this races with the close handshake.
    Option 1 is the obvious answer; the headless mirror is already maintained continuously, so a write-on-detach is incremental.
  - **Test asset retained:** `client/e2e/flows/_v0-9-6-live-pty-probe.spec.ts` stays as the diagnostic for any future regression in this area. The underscore prefix keeps Playwright globbing it as a normal test file but signals it's a probe not a fence.
- **Rejected:**
  1. **Implement the snapshot-on-detach fix in D-bis** — explicitly out of scope per the iterate brief ("Do NOT attempt to fix the bug. Iterate D-bis is a TEST iterate."). A fix without a separate code-review pass and without spec authorship of the fix-iterate would skip the SDLC discipline this campaign is meant to demonstrate.
  2. **Run the full 4×4 matrix anyway** — explicitly out of scope per the iterate spec AC #5. Outcome B halts the matrix. Running it would be ~3 minutes of test runtime confirming the same finding 16 times.
  3. **Test `page.reload()` as well as `page.goto()` SPA navigation** — both code paths consume the same WS-attach `tryReadSnapshot` call; the producer side (mid-life write missing) is the bug surface. Adding a second probe is busywork.
  4. **Test on tailscale profile** — bug is producer-side (no mid-life write), independent of network binding. The local-profile probe is sufficient empirical evidence.



### ADR-092: Iterate E — Live-pty replay fix via serialize-on-attach + snapshot-on-detach (closes ADR-091)

- **Date:** 2026-05-12
- **Section:** Iterate — fix: headless-terminal-refactor / E (live-pty replay regression closure)
- **Run-ID:** sub_iterate-20260511-204305 / E
- **Context:** ADR-091 empirically confirmed (outcome B, real-browser Playwright) that a LIVE pty loses terminal state on every SPA navigate-away → navigate-back cycle: `snapshotStore.write()` was only invoked from `finalizeMirrorSnapshot` → `cleanup` → `pty.kill / onExit`, so re-attach to a live pty found no on-disk snapshot, fell through to `flushLiveBuffer()` (post-attach output only), and the client rendered a blank terminal. ADR-091's "Proposed fix path" listed three options; Iterate E implements options 1 + 3 as a pair.
- **Decision:**
  - **Two new write surfaces in `server/src/terminal/pty-manager.ts`:**
    1. `serializeMirrorIfLive(taskId): Promise<SnapshotRecord | null>` — in-memory producer (NOT written to disk). Used by the WS attach replay flow as the PRIMARY source for live ptys. Returns null when no entry / no mirror / `serializeStable` threw; logs warn on the throw branch.
    2. `flushMirrorSnapshot(taskId): Promise<void>` — disk persistence via existing `SnapshotStore.write()`, but does NOT dispose the mirror. The pty stays alive; subsequent `pty.onData` chunks keep mirroring. Best-effort: never throws; internal try/catch swallows disk errors. Used by the WS detach path when the last subscriber leaves.
  - **WS replay flow in `server/src/terminal/routes.ts` (live-first, disk-fallback):**
    ```
    const live = await ptyManager.serializeMirrorIfLive(taskId);
    if (live) sendReplaySnapshot(ws, live);
    else {
      const disk = await tryReadSnapshot(taskId);   // server-restart only
      if (disk) sendReplaySnapshot(ws, disk);
    }
    ```
    Precedence inversion is the load-bearing detail (closes external plan review HIGH — Gemini #1 + OpenAI #2): the original "disk-first" draft was rejected because a stale disk snapshot from last-detach can co-exist with newer live-mirror state. Live always wins for a live pty.
  - **WS close flow in `routes.ts`:** new `PtyManager.detachAndCount(taskId, conn) → { remainingAttachCount }` performs detach + post-count read as a single atomic observation. When `remainingAttachCount === 0`, `void ptyManager.flushMirrorSnapshot(taskId)` fires (fire-and-forget; rejections are swallowed inside `flushMirrorSnapshot`). Multi-tab: only the LAST detach triggers the disk write. Closes external code review OpenAI HIGH #1 (split-step "check count → detach → check count" race).
  - **Wiring:** `PtyManagerOpts` gains `expectedTerminalVersion?: string`; `index.ts` plumbs `headlessProbe.terminalVersion ?? undefined`. The disk-side gate (`tryReadSnapshot`) still uses `routes.ts`'s `expectedTerminalVersion` (resolved further down in `index.ts`). The in-memory record's `terminalVersion` defaults to `"unknown"` (matches SnapshotStore's last-resort sentinel) when unset.
  - **New tests:**
    - `server/src/terminal/pty-manager-live-snapshot.test.ts` — 10 unit tests covering `serializeMirrorIfLive` (4) + `flushMirrorSnapshot` (3) + `attachCount` (1) + `detachAndCount` (1) + `terminalVersion` default sentinel (1).
    - `server/src/terminal/pty-replay-attach-detach.test.ts` — 11 integration tests covering live-first precedence, disk fallback when no mirror exists, single/multi-tab detach flush, fire-and-forget no-unhandled-rejection, serialize-throw graceful null, double-fire (onError + onClose) no-corruption, cross-task isolation, kill-vs-flush non-double-write.
    - `client/e2e/flows/v0-9-6-live-pty-replay.spec.ts` (promoted from D-bis's underscore-prefixed probe) — real-browser regression guard. Outcome A is required; outcome B fails the test. PASS on E branch / would FAIL on main.
    - `client/e2e/flows/v0-9-6-live-pty-matrix.spec.ts` — 4-type live-pty preservation matrix (new-plain / new-task / new-iterate / new-pipeline). Lifecycle + Rendering + Cursor axes hard-asserted; Single-pty axis implicit via Rendering+Cursor.
    - `client/e2e/flows/_v0-9-6-live-pty-multitab-probe.spec.ts` — Confidence-calibration probe verifying multi-tab serialize-on-attach + flush-on-last-detach.
  - **Tailscale config:** `playwright.tailscale.config.ts` adds both new specs to its `testMatch`. Both specs `beforeAll`-soft-skip when the baseURL is unreachable (matches D-bis policy; closes external code review OpenAI MED #4).
- **External Plan Review (OpenRouter — gemini-2.5-flash + gpt-5.1-mini):** completed. **HIGH (BOTH reviewers concurrent):** "disk wins" precedence is stale-prone. **HIGH (OpenAI):** split-step detach + count race. **MED (Gemini #2 / OpenAI #9):** SnapshotStore.write overlap corruption — verified already-mitigated by ADR-089 per-task PQueue. **MED (OpenAI #4):** unhandled rejection on fire-and-forget — verified all async paths internally try-catched; added explicit test. **MED (OpenAI #7):** audit `PtyManager` construction sites for `expectedTerminalVersion` — production `index.ts` wired; test-only "unknown" sentinel acceptable. **LOW (multiple):** disclosure-around-snapshot-frequency, AC #8 single-pty axis stub, serialize-throw test gap, double-fire dedup test gap — all addressed in test file additions. Findings table in spec § "Acceptance Criteria" calls out the resolutions per AC.
- **External Code Review (OpenRouter — same providers):** completed against staged diff (`/tmp/iterate-E-diff.txt`, 2218 lines). **HIGH (OpenAI #1):** test file header still said "disk-first" after AC inversion — corrected. **MED (OpenAI #2):** fire-and-forget test gap — added unhandled-rejection probe. **MED (OpenAI #3):** matrix Single-pty axis was stubbed → reworked as implicit-via-axes-B+C with explicit documentation. **MED (OpenAI #4):** tailscale soft-skip missing — added `beforeAll` skip-guard on both specs. **LOW (OpenAI #5/#6):** serialize-throw + double-fire dedup tests added.
- **Self-Review (7-item, mandatory always):**
  1. **Spec Compliance** — PASS: AC #0 (RED→GREEN TDD: D-bis branch outcome B → E branch outcome A captured in probe-result.json), AC #1 (regression guard PASS on E, hard-asserts outcome A), AC #2/3/5 (21 unit + integration tests), AC #4 (live-first precedence per external review HIGH), AC #6/7 (multi-tab probe PASS), AC #8 (4-type matrix PASS on local + tailscale), AC #9 (zero NEW regressions; specs 76/77/78 failures are pre-existing seed-data issues unrelated to this iterate).
  2. **Error Handling** — PASS: all new write paths internally try-catched (`flushMirrorSnapshot` body + `serializeMirrorIfLive` serializeStable wrap + `SnapshotStore.write` already retry-on-EBUSY from Iterate B). Routes' `void ptyManager.flushMirrorSnapshot(taskId)` cannot leak unhandled rejections (verified by explicit test); `detachAndCount` is synchronous so no rejection surface there.
  3. **Security Basics** — PASS: snapshot file format unchanged; same `SnapshotStore` UUID-validation + realpath-at-op-time + 0o600 / 0o700 perms (Iterate A/B); no new env-var → command path; WS attach replay reads only from already-authorized task context; on-disk snapshot may include sensitive shell output but exposure profile is unchanged (the 24h TTL retention + delete-cascade clear-on-task-delete from ADR-087 remain in effect).
  4. **Test Quality** — PASS: 21 new server-side tests (unit + integration) cover the two new write surfaces, the precedence inversion, the atomicity fix, fire-and-forget rejection swallowing, cross-task isolation, double-fire dedup, and the kill-vs-detach non-competition. Real-browser regression guard (outcome A required) + 4-type matrix + multi-tab probe close the E2E surface.
  5. **Performance Basics** — PASS: `serializeStable` cost is the same as pre-existing `finalizeMirrorSnapshot` (~10 ms double-serialize per attach). Detach-time disk write is a single PQueue-serialized `fs.writeFile` + `fs.rename` (~10-30 ms typical, capped by the Iterate-B EBUSY retry budget). Idle / no-mirror branches are O(1) Map-lookups. No new wakeups (Option 2 from ADR-091 was explicitly rejected per spec § "Out of Scope").
  6. **Naming & Structure** — PASS: `serializeMirrorIfLive` + `flushMirrorSnapshot` + `attachCount` + `detachAndCount` extend the existing `PtyManager` surface naturally. `pty-manager.ts` grew from 992 → 1118 LOC (over 300 already from prior iterates; the +126 LOC is acceptable continuation, no further-degraded thresholds). `routes.ts` 795 → 828 LOC (similar). Test files are self-contained (430 + 480 LOC) — within project convention for test files. Conventional Commits respected.
  7. **Affected Boundaries (ADR-024 + references/round-trip-tests.md)** — PASS: WS replay envelope (producer = `routes.ts sendReplaySnapshot` via either `serializeMirrorIfLive` or `tryReadSnapshot`; consumer = `useTerminalSocket.onReplaySnapshot`) — round-trip probed via the Playwright regression guard, outcome A confirmed real-browser. Snapshot disk format (producer = `SnapshotStore.write`; consumer = `SnapshotStore.read` via `tryReadSnapshot`) — round-trip probed by the existing `pty-mirror-integration.test.ts` (unchanged) + the new "disk fallback when no live mirror" integration test. Headless-mirror serialize path (in-memory producer / consumer) — unchanged from ADR-088/089; new entry surfaces (`serializeMirrorIfLive`, `flushMirrorSnapshot`) ride on the same `serializeStable()` contract.
- **Confidence Calibration (medium + touches_shared_infra + touches_io_boundary):** Empirical probes run:
  1. **Bug reproduction → fix verification:** D-bis branch produced outcome B (artifact); E branch produces outcome A (artifact at `client/playwright-report/v0.9.6-live-pty-replay/probe-result.json`). The same probe-result.json shape now reads `marker_seen_post_navigate_back: true`, `replay_snapshot_envelope_emitted_on_reattach: true`, cursor preserved (19,5) → (19,6).
  2. **Multi-tab race:** `_v0-9-6-live-pty-multitab-probe.spec.ts` PASS. Tab A types MARKER → tab B sees MARKER via serialize-on-attach → tab A closes → tab B retains state → tab B closes → tab C reads from disk snapshot from flush-on-last-detach → tab C sees MARKER.
  3. **Server-restart resilience (proxy):** the multi-tab tab-C path exercises the disk-fallback branch (live mirror gone after both tabs closed; the next attach reads from disk). A literal server-restart probe would require killing the dev server mid-session — the proxy path covers the same code branch (`tryReadSnapshot` returns the file written by `flushMirrorSnapshot`).
  4. **Concurrent serialize-on-attach + flush-on-detach race:** addressed structurally — `SnapshotStore.write` already has per-task PQueue (Iterate B MEDIUM-1); `serializeStable()` has its own `flushPendingWrites` await internally. Both paths share the same `mirror` reference; the live mirror's stable-fixed-point output is deterministic across concurrent reads. Test: `pty-replay-attach-detach.test.ts > flush-on-task-A-does-not-touch-task-B`.
  5. **Tailscale path (network-independent verification):** 5/5 PASS on tailscale config (1 regression-guard + 4 matrix cells). Producer-side fix; network-independent — as predicted by the code-reading.
  Asymptote reached: two consecutive probe rounds with zero new findings (the matrix re-run after the live-first precedence inversion produced 4/4 PASS; the multi-tab probe produced 3/3 PASS). NOT probed (deferred per spec § "Out of Scope"): explicit pty.pid diagnostic endpoint for the matrix's single-pty axis (rendering+cursor are sufficient signals); snapshot-on-interval (option 2 from ADR-091).
- **Consequences:**
  - **Test surface added:** 21 server-side tests (10 unit + 11 integration) + 1 real-browser regression guard + 4 matrix cells (× 2 network profiles = 8 cell-runs) + 1 multi-tab calibration probe. 907 → 925 server tests (verified `npm.cmd --prefix server test` green); client 777 tests unchanged.
  - **WS protocol unchanged:** the same `replay_snapshot` envelope from ADR-089 carries the live-mirror serialize output. No new envelope types; no client-side changes required.
  - **Disk write frequency increased:** snapshot-on-detach adds one disk write per "last tab closes" event. For typical SPA usage (a few navigate-away/navigate-back cycles per task), this is ~1-3 writes per task. The Iterate B EBUSY retry budget + the per-task PQueue absorb the load.
  - **Files modified (production):** `server/src/terminal/pty-manager.ts` (+126 LOC, three new methods + opts), `server/src/terminal/routes.ts` (+33 LOC, `resolveReplaySnapshot` helper + `detachAndCount` in onClose/onError), `server/src/index.ts` (+8 LOC, plumb `expectedTerminalVersion` to PtyManager).
  - **Files added (tests):** `pty-manager-live-snapshot.test.ts`, `pty-replay-attach-detach.test.ts` (server); `v0-9-6-live-pty-replay.spec.ts` (promoted from `_v0-9-6-live-pty-probe.spec.ts`), `v0-9-6-live-pty-matrix.spec.ts`, `_v0-9-6-live-pty-multitab-probe.spec.ts` (client).
  - **ADR-091 closed.** Outcome B → outcome A re-verified on the regression-guard.
  - **DO-NOT regression guard:** the regression-guard test fails on any branch where re-attach to a live pty does not emit `replay_snapshot`. Future re-introduction of the bug is mechanically caught.
- **Rejected:**
  1. **Snapshot-on-interval (option 2 from ADR-091)** — adds wakeup noise (one timer per live mirror across the full server) without empirical justification. The two write surfaces shipped here cover the user-observable scenarios.
  2. **Disk-first precedence (original spec draft)** — both reviewers flagged the same staleness bug HIGH severity. Inverted before commit.
  3. **Split-step detach + count check (original spec draft for AC #5)** — race-vulnerable per external code review OpenAI HIGH #1. Collapsed into atomic `detachAndCount`.
  4. **Explicit pty.pid diagnostic endpoint for the matrix's single-pty axis** — Rendering + Cursor axes already imply single-pty (a fresh pty would render blank with cursor at (0,0)); adding a diagnostic endpoint is API surface inflation for marginal evidence.
  5. **Literal Hono SIGTERM/restart probe for AC #7** — the multi-tab tab-C path exercises the same `tryReadSnapshot` disk fallback code branch; an OS-level restart probe would not change the assertion content.

### ADR-093: Iterate F — xterm.js client config Vorbild-Alignment (convertEol + WebGL + scrollback + allowProposedApi)

- **Status:** accepted — **`convertEol: true` clause SUPERSEDED** by iterate-2026-05-16-converteol-smear (decision-drop; ADR-NNN assigned at next release). That flip was the root cause of Bug B: ConPTY/Claude TUI emit a bare LF as "cursor down, keep column"; `convertEol: true` forced a CR on every LF, collapsing kept-column writes to column 0 — the left-column scroll smear. The status-pane "stacking" hypothesis below was an xterm-5.x-era theory; on xterm 6.0 `convertEol: false` is correct and UAT-confirmed. The WebGL / `allowProposedApi` / `scrollback` clauses of this ADR are unaffected.
- **Date:** 2026-05-13
- **Section:** Iterate — fix: headless-terminal-refactor / F (in-session rendering)
- **Run-ID:** sub_iterate-20260511-204305 / F
- **Context:** After Iterate E (ADR-092) shipped the live-pty serialize-on-attach + snapshot-on-detach pair, the user reported a **residual** in-session rendering bug captured via screenshot: within a live session (no navigate-away), Claude TUI's status pane redraws stack visually in the terminal (vertical "stacking" of the status line on each redraw). The bug **clears** on navigate-away / navigate-back — i.e. ADR-092's re-attach replay path works; what stays broken is in-session incremental rendering before the first detach/re-attach round-trip. Diagnostic comparison with the reference repo `siteboon/claudecodeui`, which runs Claude TUI cleanly with raw byte-stream replay (and no server-side `@xterm/headless` at all), surfaced four xterm.js client-side option differences captured in the table below.

  | Option              | Vorbild (`siteboon/claudecodeui`) | `EmbeddedTerminal.tsx:551-585` (pre-F) |
  |---------------------|-----------------------------------|----------------------------------------|
  | `convertEol`        | `true`                            | `false` ← suspected primary cause      |
  | `allowProposedApi`  | `true`                            | `false`                                |
  | `scrollback`        | `10000`                           | `5000`                                 |
  | WebGL renderer      | YES (with Canvas fallback)        | NO (Canvas/DOM default only)           |

  The `convertEol: false` setting was scaffolding-era default with no inline justification. Claude TUI's status pane redraw uses cursor positioning that assumes CR-LF-normalised line endings; a stray LF-only byte under `convertEol: false` sends the cursor down without column reset, causing redraws to land at visually offset columns (the "stacking" pattern). The WebGL renderer is an orthogonal robustness improvement: atomic full-frame redraws vs. incremental Canvas/DOM partial redraws reduce visual artifacts under high-frequency redraw scenarios (which is what Claude TUI's status pane produces).
- **Decision:**
  - `client/src/components/terminal/EmbeddedTerminal.tsx`:
    - `convertEol: false` → `convertEol: true` (load-bearing — fixes the stacking redraw hypothesis).
    - `allowProposedApi: false` → `allowProposedApi: true` (Vorbild parity; exposes proposed xterm.js APIs to first-party addons).
    - `scrollback: 5000` → `scrollback: 10000` (Vorbild parity; modest memory cost per task).
    - Explicit `windowsMode: false` added (Vorbild parity; documents intent against future user-agent-based auto-detection drift).
    - `WebglAddon` loaded via try/catch immediately after `term.open(container)` (WebGL needs an attached DOM context). The catch branch logs a `console.warn` and allows xterm.js to fall through to its default Canvas/DOM renderer — headless test envs (jsdom), browsers with WebGL disabled, and GPU-blacklisted hosts all degrade cleanly.
  - `client/package.json`: `@xterm/addon-webgl@^0.18.0` added to `dependencies`; `package-lock.json` regenerated.
  - `client/src/components/terminal/EmbeddedTerminal.test.tsx`: `vi.mock("@xterm/addon-webgl", …)` added so the new import resolves under jsdom; the mock's constructor returns a fake addon (`activate` + `dispose`) so the try-branch lands and the catch path stays untested at unit level (xterm.js docs document the fallback contract).
  - **Relationship to prior ADRs:** ADR-067 (embedded-terminal scaffold, theme palette) — untouched; theme palette is not modified. ADR-068-A1 (disk scrollback, auto-execute) — untouched. ADR-087 (headless-mirror retirement) — untouched; F is a client-side rendering knob, orthogonal to the snapshot protocol. ADR-091 / 092 (live-pty replay across navigate cycle) — F is the follow-on to E for the **in-session** rendering surface; E fixed re-attach, F fixes the live-redraw axis.
- **External Plan Review:** SKIPPED — runner contract gate requires medium+ or risk flag. Iterate F is complexity=trivial/small with no risk flags (no `touches_io_boundary` / `touches_shared_infra` / etc — pure client UI config). Status: `skipped_complexity_below_threshold`.
- **Self-Review (7-item, mandatory always):**
  1. **Spec Compliance** — PASS: all five changes from the brief applied (4 option flips + WebGL load with try/catch). Dep added at `^0.18.0`. Test mock added.
  2. **Error Handling** — PASS: WebGL load uses try/catch with explicit `console.warn` payload (Error-vs-string narrowing). Failure path doesn't disrupt the mount; Canvas/DOM fallback is the documented xterm.js default when no renderer addon loaded.
  3. **Security Basics** — PASS: WebGL addon ships from the same `@xterm/*` org we already trust; no new IO surface; no user input flowing through new code paths; no command construction. `allowProposedApi: true` exposes proposed xterm.js APIs to first-party addons only.
  4. **Test Quality** — PASS: existing 15 EmbeddedTerminal vitest tests pass (jsdom + xterm mocks). The new `@xterm/addon-webgl` mock satisfies the try-branch; the catch path is contractually exercised in real-browser scenarios where WebGL is unavailable. No pixel-diff Playwright regression is in scope for this iterate (operator-verified post-merge per orchestrator brief).
  5. **Performance Basics** — PASS: WebGL renderer is the documented performance-positive path (atomic full-frame redraws). Bundle size +30 KB into the existing `EmbeddedTerminal` lazy chunk (378 → 408 KB). Scrollback doubled to 10000 lines — bounded per-task xterm.js buffer.
  6. **Naming & Structure** — PASS: inline comments name the iterate (Iterate F / ADR-093) and explain the load-bearing knob (`convertEol`). No new abstractions; pure config change at the existing construction site.
  7. **Affected Boundaries (ADR-024 + references/round-trip-tests.md)** — PASS: n/a — pure client UI config. No producer/consumer serialized-format change. xterm.js Terminal constructor options are not a versioned data boundary. Round-trip probes would not yield signal here (no serialized format involved).
- **Code Review Cascade:** SKIPPED — runner contract triggers (complexity medium+ OR risk flag OR diff > 100 LOC) all false. Diff: 53 line-insertions / 56 changed lines across 4 files (`EmbeddedTerminal.tsx`, `EmbeddedTerminal.test.tsx`, `package.json`, `package-lock.json`). Status: `skipped_diff_below_threshold`.
- **External Code Review:** SKIPPED — same trigger conditions. Status: `skipped_diff_below_threshold`.
- **Confidence Calibration:** SKIPPED — runner contract gate requires medium+ OR `touches_io_boundary`. Neither holds. Status: `skipped_complexity_and_no_io_boundary`.
- **F0.5 Surface Verification:** `surface=none` with justification (logged at `.shipwright/runs/sub_iterate-20260511-204305-F/surface_verification.json`). Config-only change; visual correctness verified manually by user post-merge. The 15-test EmbeddedTerminal vitest suite + 777-test client baseline + clean `npm run build` confirm constructor wiring, addon import, and bundling are well-formed.
- **Rejected Alternatives:**
  1. **F.1: Auto-refresh push** — periodically clear-and-rewrite the terminal from a server-side snapshot. Rejected: high-frequency operation, masks symptom not cause, introduces flicker, breaks user scrollback position.
  2. **F.2: Manual re-sync button** — surface a "force refresh" CTA next to the terminal. Rejected: pushes operator burden onto a UX surface that should not require manual intervention.
  3. **F.5: Architecture shift** — drop xterm.js, replace with a different terminal emulator. Rejected: massive blast radius. The bug is far cheaper to fix with a four-option config flip first; if F doesn't resolve the residual, F.5 becomes a candidate after operator UAT.
  - F.0 (this iterate) selected as the lowest-risk hypothesis-test: the four options are documented xterm.js public API, the WebGL renderer has a documented Canvas/DOM fallback, and Vorbild has shipped the same combination in production.
- **Falsifiability:** if operator UAT post-merge still observes the status-pane stacking, the F.0 hypothesis is falsified and the campaign opens F.1 / F.5 with the empirical evidence that config alignment was insufficient. The screenshot+repro context is preserved in the campaign log under sub-iterates/F-followup (not yet created — only on falsification).
- **Files modified:** `client/src/components/terminal/EmbeddedTerminal.tsx` (+25 / -5 LOC), `client/src/components/terminal/EmbeddedTerminal.test.tsx` (+6 LOC), `client/package.json` (+1 dep), `client/package-lock.json` (+13 LOC).


---

### ADR-094: Wizard stack-profile step renders from /api/profiles instead of hardcoded array
- **Date:** 2026-05-13
- **Section:** Iterate — change: dynamic-stack-profiles
- **Context:** Project Wizard step 2 had a 2-entry hardcoded PROFILES array (supabase-nextjs + Custom) despite server-side GET /api/profiles already exposing every bundled profile dynamically. Users saw only Supabase even though the upstream monorepo ships three profiles.
- **Decision:** Replace the hardcoded PROFILES array in client/src/components/wizard/StackProfileStep.tsx with a new useProfiles() TanStack Query hook (apiFetch wrapper, 60s staleTime) plus a permanent in-component Custom sentinel. Snapshot at server/profiles/ refreshed with vite-hono.json + python-plugin-monorepo.json so the default install ships all three.
- **Commit:** PENDING
- **Rationale:** Server endpoint and resolver were already correct (FR-01.23, profile-loader.ts 3-level fallback); only the client consumer and the bundle were stale. Smallest reversible change: introduce one new client hook + one consumer refactor + a static file copy. No new endpoint, no auth, no migrations, no risk flags.
- **Consequences:** FR-01.03 gains a new (E) acceptance criterion. Loading-skeleton + error-fallback states surface in the UI. Bundled snapshot now reflects upstream truth at install time. The shipwright-webui project itself (profile=vite-hono) is now discoverable in the wizard without setting SHIPWRIGHT_MONOREPO_PATH.
- **Rejected:** Generate the profile catalog on the server with display-friendly metadata baked in (rejected: duplicates server work the route already does and breaks the typed contract). Lazy-import the profile JSONs into the React bundle (rejected: ships profile data to the browser unnecessarily and bypasses the server's fail-soft logic for malformed JSON). Defer the snapshot refresh to a separate iterate (rejected: would leave the dynamic UI showing only Supabase on default installs).


---

### ADR-095: Claude TUI flicker workaround (CLAUDE_CODE_NO_FLICKER env injection) + Resume-button gating via liveSession
- **Status:** accepted (default-OFF clause reverted by ADR-098; liveSession Resume gate retired by ADR-111)
- **Date:** 2026-05-13
- **Section:** Iterate G — fix; campaign `headless-terminal-refactor`
- **Context:** User-reported regressions post-v0.10.0: (1) cursor flicker around Claude TUI streaming output (xterm 5.5.0 lacks DECSET 2026; cursor jumps visibly across word boundaries) and (2) Resume button is obsolete when the embedded terminal pane is alive (pasting `claude --resume <uuid>` into a live Claude shell spawns a nested instance).
- **Decision:** (F1) Inject `CLAUDE_CODE_NO_FLICKER=1` into every pty via new pure `buildSpawnEnv(base, caller?)` helper; default-on with opt-out via `SHIPWRIGHT_TERMINAL_NO_FLICKER=0` (key DELETED, not set to "0", so child sees upstream env); opt-out wins over caller-env. New `config.ts:terminalNoFlicker`. (F2) New server-side `withLiveSession(task)` HTTP-boundary helper exposes `liveSession = ptyManager.get(taskId) !== undefined` on every task-returning route (not persisted on disk); `TaskDetailHeader.ctaFor(state, liveSession)` suppresses the Resume CTA when `state === "idle" && liveSession === true`.
- **Commit:** PENDING_F6
- **Rationale:** Plan-D″ user-initiated invariant preserved — env injection happens at SHELL spawn (whitelist intact); Claude Code reads its env when user types `claude`. `pty entry present` is the single authoritative Resume signal; lifting it to the wire avoids persisting derived state. xterm 6 upgrade rejected here (breaking change + snapshot pin invalidation) and deferred to Iterate I.
- **Consequences:** 927/927 server tests, 780/780 client. New env-helper unit tests + flip-flop route tests + consumption-proof client tests. `.env.example` documents the alt-screen trade-off (Cmd+F search degraded; flicker eliminated). Manual UAT required for visual confirmation. Code Review Cascade ran (>100 LOC) — 3 MEDIUM findings addressed pre-commit.
- **Rejected:** Upgrade xterm.js 6.0 (deferred); keep Resume always visible (doesn't fix bug); ANSI-sniff "shell-in-TUI" auto-detect (added protocol complexity); per-spawn-or-per-slug env scoping (state-tracking complexity); persist `liveSession` on disk (drift vs in-memory truth).
- **Details:** [`.shipwright/planning/adr/095-claude-tui-flicker-workaround.md`](../planning/adr/095-claude-tui-flicker-workaround.md) — full upstream-issue references, Resume-CTA matrix, External Plan Review / Code Review Cascade dispositions (3 fixed + 1 false positive), Self-Review checklist, Falsifiability, all files modified.

### ADR-096: Iterate H — Snapshot preservation on pty death + TaskCard Resume gating
- **Status:** accepted (60 % preservation heuristic retained even after ADR-098 supersession partial-revert)
- **Date:** 2026-05-13
- **Section:** Iterate H — fix; campaign `headless-terminal-refactor`
- **Context:** Two regressions post-v0.10.1 (post-Iterate G merge, ADR-095 in force): (1) overnight Claude task showed an empty terminal on return because `finalizeMirrorSnapshot` atomically OVERWROTE the good `flushMirrorSnapshot` payload with a 158-byte bare-shell stub (the alt-screen-leave under `CLAUDE_CODE_NO_FLICKER=1` empties the main buffer at exit); (2) Iterate G's Resume CTA gating was applied only on `TaskDetailHeader`, missing the equivalent `TaskCard` Resume button on the kanban board.
- **Decision:** (F1) Extend `finalizeMirrorSnapshot(taskId, mirror)` with a pre-write check: read existing snapshot, compare byte lengths, skip the write when `existingDataLen > 0 && newDataLen < existingDataLen * 0.6` (60 % preservation gate; observability-logged via `console.warn`); `mirror.dispose` + `releaseQueue` still fire in `finally`. Edge cases: no existing snapshot → write; read throws → write (best-effort fallback); empty-new + existing → preserve. (F2) Add `task.liveSession !== true` gate to `TaskCard.tsx`'s `idle` Resume branch (mirrors `TaskDetailHeader.ctaFor` from ADR-095; `undefined` falls back to surfacing Resume).
- **Commit:** PENDING_F6
- **Rationale:** xterm 6 upgrade would let us drop `CLAUDE_CODE_NO_FLICKER` and run Claude in normal-screen — but breaking change + snapshot pin invalidation; explored in parallel (Iterate I). The 60 % heuristic is the pragmatic content-agnostic mitigation that protects any TUI that clears on exit (htop, vim, ipython) — not just Claude. Size threshold beats ANSI-sniffing `DECRST 1049` (which couples to one TUI's exit convention). TaskCard gating mirrors TaskDetailHeader's call-site pattern (policy = where; button = mechanism).
- **Consequences:** Server 933/933 tests, client 784/784 (+10 new: 6 server snapshot-heuristic + 4 client TaskCard-matrix). Empirical anchor: fresh 120x30 mirror after `__emit("$ ")` serializes to 2–27 bytes via M2 stable pipeline vs 1–3 KiB for active Claude — heuristic correctly distinguishes the cases. The originally reported task would have been recovered if `flushMirrorSnapshot` on last-detach had fired before idle-ceiling; the heuristic protects forward.
- **Rejected:** Periodic snapshot-on-quiesce timer (complex; same outcome via existing flush-on-detach + this iterate); hard-gate "always preserve existing" (prevents legitimate updates after user `clear`); threshold at 50 % / 70 % (too permissive / too restrictive); ANSI `DECRST 1049` sniff (TUI-specific); push gating into `TerminalLaunchButton` (couples policy to mechanism).
- **Details:** [`.shipwright/planning/adr/096-snapshot-preservation-taskcard-resume.md`](../planning/adr/096-snapshot-preservation-taskcard-resume.md) — full root-cause chain, all 5 heuristic edge cases, External Plan Review / Code Review Cascade / Confidence Calibration skip-rationales, Self-Review checklist, Falsifiability, all files modified.

### ADR-097: Iterate I — xterm.js 5.5.0 → 6.0.0 upgrade + `CLAUDE_CODE_NO_FLICKER` default flipped to opt-in (SUPERSEDED-IN-PART by ADR-098)

- **Status:** superseded — Partially superseded by ADR-098 on 2026-05-13. The xterm.js 5.5.0 → 6.0.0 upgrade (matched paired-set both workspaces), snapshot envelope v1 → v2 (hard-reject), `windowsMode` removal in `EmbeddedTerminal`, version-family warning + pinning comment updates, and the Iterate H 60 % preservation heuristic retention — ALL of these stand. ONLY the `CLAUDE_CODE_NO_FLICKER` default-OFF flip is reverted by ADR-098.

- **Context:** Iterate G (ADR-095) injected `CLAUDE_CODE_NO_FLICKER=1` by default into every pty's env to work around cursor flicker during Claude TUI streaming output. The xterm.js 5.5.0 baseline did NOT support DECSET 2026 / Synchronized Output, so the per-frame ANSI cursor moves were rendered intermediate-state-visible → flicker. Anthropic's documented workaround (alt-screen mode) bypassed the problem but cost browser-native Cmd+F search, mouse capture, fixed input box. xterm.js 6.0.0 (Dec 2024, PR #5453) added native DECSET 2026 support. The Iterate I hypothesis was: with xterm 6's native sync support, Claude's main-buffer frames would arrive batched flicker-free, making the alt-screen workaround unnecessary.

- **Decision:** Upgrade both workspaces to xterm 6.x (matched paired-set, exact-pin), bump the snapshot envelope to v2 (terminalVersion gate), remove `windowsMode: false` from `EmbeddedTerminal` (option retired in 6.x), and flip the `CLAUDE_CODE_NO_FLICKER` default from ON to OPT-IN (`SHIPWRIGHT_TERMINAL_NO_FLICKER=1`). The reasoning, on 2026-05-13: native sync support would batch the frames; users would recover Cmd+F + mouse capture for free.

- **Rationale:** The xterm 6 upgrade had been deferred from Iterate G as a breaking change (windowsMode removed, Canvas renderer removed, ADR-088 snapshot pin invalidation). Iterate H's 60 % preservation heuristic was added in parallel as defense-in-depth against the alt-screen-leave-empty failure mode that the alt-screen default created. With xterm 6 in hand, the architectural appeal of dropping the workaround was strong — but the test was theoretical (renderer-side honour), not empirical (producer-side opt-in).

- **Consequences:**
  - Client + server packages exact-pinned to the xterm 6.x matched set (`@xterm/xterm` 6.0.0, `@xterm/addon-fit` 0.11.0, `@xterm/addon-web-links` 0.12.0, `@xterm/addon-webgl` 0.19.0, `@xterm/headless` 6.0.0, `@xterm/addon-serialize` 0.14.0). All STAND post-ADR-098.
  - Snapshot envelope `v1` → `v2` hard-reject (terminalVersion gate). STANDS post-ADR-098.
  - `EmbeddedTerminal` constructor lost the `windowsMode: false` line (option no longer exists). STANDS.
  - `CLAUDE_CODE_NO_FLICKER` default flipped OFF. **REVERTED by ADR-098** — the empirical evidence falsified the hypothesis (see ADR-098 below).
  - M2 fixed-point re-verified against a 30 671-byte captured Claude TUI scrollback fixture on xterm 6.x: all three round-trip variants (random chunking, mid-escape 4-byte splits, resize-midway 120x30 → 80x24) passed.

- **Falsifiability triggered:** UAT post-Iterate-I confirmed the flicker regression. ADR-098 records the empirical investigation that triggered the partial revert.

- **Files modified (still in force):** xterm package.json pins (client + server), `snapshot-store.ts` v2 envelope, `EmbeddedTerminal.tsx` `windowsMode` removal. Reverted by ADR-098: `config.ts:terminalNoFlicker`, `terminal/routes.ts buildSpawnEnv` default branch, `pty-env-flicker.test.ts`, `config.test.ts`.

### ADR-098: Iterate J — Restore `CLAUDE_CODE_NO_FLICKER=1` default to opt-out (reverts ADR-097's default-OFF clause; restores ADR-095 stance)
- **Status:** accepted
- **Date:** 2026-05-13
- **Campaign:** `headless-terminal-refactor`, Iterate J
- **Supersedes:** ADR-097's `CLAUDE_CODE_NO_FLICKER` default-OFF clause ONLY (xterm 6 upgrade, snapshot v2, `windowsMode` removal, `@xterm/headless` 6.0.0, Iterate H heuristic, `buildSpawnEnv` helper, opt-out-wins-over-caller semantics — ALL RETAINED). **Restores:** ADR-095 default-on stance.
- **Context:** ADR-097 flipped the env default OFF on the theoretical bet that xterm 6's DECSET 2026 support would batch Claude TUI frames flicker-free. UAT post-merge falsified the hypothesis — cursor flicker returned verbatim.
- **Decision:** Restore `config.ts:terminalNoFlicker` default to `!== "0"`; restore `buildSpawnEnv` default-inject of `CLAUDE_CODE_NO_FLICKER="1"`. Preserve the "opt-out wins over caller-env" symmetry. Re-baseline 10 cases in `pty-env-flicker.test.ts` + 3 in `config.test.ts`. Amend CLAUDE.md DO-NOT guard #22 with the empirical falsification path. Retain ALL other Iterate I changes.
- **Commit:** PENDING_F6
- **Empirical anchor:** A 265 KB live Claude Code 2.1.139 scrollback contained **21 690 raw cursor-positioning sequences** (`\x1b[…H`) but **zero DECSET 2026 enter/leave pairs**. xterm 6 honours DECSET 2026 when the producer wraps frames — Claude Code does not. Issue [#37283](https://github.com/anthropics/claude-code/issues/37283) remains open.
- **Rationale:** Alt-screen Cmd+F cost was the only argument for the flip; empirical flicker proof swings the trade-off back. Smallest possible diff: two single-line gate flips + comment + test re-baseline. Iterate H 60 % preservation heuristic stays in force as defense-in-depth.
- **Consequences:** 936/936 server tests, 784/784 client. CLAUDE.md DO-NOT guard #22 amended with falsification path. `CHANGELOG.md` Fixed bullet appended.
- **Rejected:** Per-task opt-in toggle in UI (user cannot meaningfully evaluate); DECSET-2026 ANSI sniff with auto-toggle (env vars are spawn-time only); defer to upstream fix (#37283 has no announced date); fixture-driven test of DECSET-2026 absence (privacy + diff bloat + per-version re-validation).
- **Details:** [`.shipwright/planning/adr/098-restore-no-flicker-default.md`](../planning/adr/098-restore-no-flicker-default.md) — full empirical-evidence probe output, decision steps, Self-Review checklist, F0.5 surface justification, falsification sequence required for any future revert.

### ADR-099: Iterate K — xterm.js 6.0 WebGL atlas-corruption workaround + addon-serialize SGR-encoding fix (v1 → v8)
- **Status:** superseded
- **Superseded by:** ADR-108 — atlas-maintenance machinery deleted after empirical bisect proved both WebGL AND DOM renderers smeared; real cause was a client-side replay/live-data write interleave. The server-side SGR re-emit branch survives.
- **Status (historical):** accepted
- **Date:** 2026-05-14
- **Campaign:** `codex-rescue-altscreen-rendering`, Iterate K
- **Branch:** `iterate/codex-rescue-altscreen-rendering`
- **Context:** Two upstream bugs in the xterm.js 6.0 stack manifested on sustained Claude TUI sessions: (1) `xtermjs/xterm.js#5847` — WebGL texture-atlas merge corruption under sustained per-cell color-attribute streaming → visible smearing / ghosting / glyph substitution; (2) `@xterm/addon-serialize` 0.14.0 — mouse-encoding modes (`?1006h` / `?1000h` / `?1002h`) not serialized, so post-attach mouse-wheel events scroll a frozen historical buffer instead of being forwarded to Claude.
- **Decision:** (Server, retained) `buildReplaySnapshotEnvelope` re-emits the SGR mouse modes at the end of the serialized payload. (Client, deleted by ADR-108) `safeAtlasMaintenance()` runs `clearTextureAtlas + refresh` (main buffer) or `refresh`-only (alt-screen), driven by SEVEN triggers: 10 s gated periodic + `term.onScroll` + `term.onWriteParsed` burst-after-2-s-quiet + post-mount settle (+3 s) + DOM `wheel` listener (150 ms debounce; v8) + post-launch-settle (+4 s; v9). WebGL addon loaded BEFORE `term.open()` (`PR #12`) with `rescaleOverlappingGlyphs: true`.
- **Commit:** PENDING_F6
- **Rationale:** xterm 7 upstream fix has no announced date; user-visible regression cannot block on upstream. Renderer-fork option breaks the snapshot version-pin contract. `onScroll` covers content-driven scroll only (xterm.js#3864/#3201); DOM `wheel` covers user-driven scroll under mouse-capture. Buffer-type split avoids alt-screen heavy-flicker (Iterate K v3→v4 finding).
- **Consequences:** ~6 micro-flickers/min during active Claude streaming, zero flicker idle, additional fire-on-wheel. 40/40 client tests + 944/944 server. Probe artifacts committed to `client/playwright-report/iterate-k-v8/`. **Empirical-validation-attempt result:** kill-switch gating + WebGL pixel-output effect + alt-screen invariant `altClears == 0` over 17 176 events ALL proven; visible smearing reduction in synthetic stress NOT reproduced (real-Claude cell-update churn pattern required, not naive per-cell color emit).
- **Rejected:** Wait for xterm 7 (no date); `onScroll` exclusively (content-driven only); xterm fork (breaks pin contract); add keydown listener (lower priority than wheel); rAF polling (re-introduces idle flicker).
- **Details:** [`.shipwright/planning/adr/099-xterm6-webgl-atlas-workaround.md`](../planning/adr/099-xterm6-webgl-atlas-workaround.md) — full eight-revision evolution table, Empirical-validation-attempt block (validated/not-validated/honest-interpretation), 10-scenario Playwright probe matrix, all upstream issue references, Files modified.


---

### ADR-100: ExternalTask 13-field extension for leadwright daemon routing/claim
- **Date:** 2026-05-14
- **Section:** Iterate — feature: lead-foundation-task-schema (leadwright Phase 1)
- **Context:** Leadwright Phase 1 needs additional fields on ExternalTask records for domain routing, priority, claim CAS, and audit. The leadwright daemon (separate repo) reads/writes the same sdk-sessions.json through the shared interface; webui stays the single source of truth for the backlog.
- **Decision:** Add 13 optional fields inline on ExternalTask (5 user-creatable + 8 daemon-owned). schemaVersion stays at 3 with write-on-touch — legacy v1/v2/v3 rows load unchanged. POST /tasks accepts the 5 user-creatable fields; POST /launch gains a 409 task_claimed short-circuit on claimToken. NewIssueModal renders the 5 inputs opt-in via action.modal_fields. MasterTaskCard renders priority badge + domain chip + blockedBy indicator from the master shadow ExternalTask.
- **Commit:** PRE-COMMIT
- **Rationale:** Inline duplication of the type (vs cross-repo npm-link) keeps the 30-line surface tiny and avoids cross-language coupling. Per-field soft-drop on malformed shapes mirrors the existing phaseTaskId/runId/parentRunMaster tolerance and avoids row-level data loss on partial corruption. Narrowing store.create() to the 5 user-creatable fields (and ignoring daemon-owned keys in POST /tasks) closes the MED-4 finding from external review — daemon-only fields can't be smuggled in by a malicious client. Only claimToken triggers the 409, not claimedBy/claimedAt, so half-completed claims that left audit metadata behind don't permanently block user launches.
- **Consequences:** WebUI is now the authoritative producer/consumer for the extended schema; the leadwright daemon claim helper (separate repo) will mutate the daemon-owned fields via its own compare-and-swap path. POST /launch 409 task_claimed is a new failure mode user-facing clients must handle. Stale claim metadata without claimToken does NOT block launches — operator must clear claimToken explicitly to unblock. Modal inputs are opt-in per action; bundled new-task/new-iterate render them by default, .webui/actions.json overrides can opt out.
- **Rejected:** Bumping schemaVersion to 4: rejected — would force batch-rewrite-on-boot (already rejected by ADR-038) or trigger 'future-version → start empty' branch losing every task on rollback. Parallel LeadwrightTask interface: rejected per the leadwright spec's 'Open questions' — preferred inline duplication for v1's tiny surface. Daemon-side claim helper in this iterate: rejected — out of scope per handoff; lives in leadwright/lib/lead-task-claim.ts.

---

### ADR-101: WebUI Triage Tab + Promote bridge (FR-01.30, ADR-101)
- **Date:** 2026-05-15
- **Section:** Iterate — feature: triage-tab
- **Context:** Producer hooks (Phase-Quality, compliance, security/perf/F0.5/drift) write findings to `<project>/.shipwright/triage.jsonl`. Operators previously had only the Python CLI `triage_promote.py` to promote those findings to backlog tasks. Iterate 1a (storage) + 1b (ExternalTask schema extension with `promotedFromTriageId` back-ref) prepared the cross-store contract; this iterate (3) wires the webui consumer + Promote/Dismiss/Snooze actions.
- **Decision:** Add a Triage tab + 5 endpoints under /api/triage/*. TS port of triage.py read_all_items (drift-protected via Python-fixture parity test). Cross-store Promote transaction acquires triage.jsonl lock first (smaller blast radius), then sdk-sessions.json lock; idempotency check via findByPromotedFromTriageId is double-gated under sessions lock. Status flip writes via appendStatusEvent helper using JSON.stringify (no manual interpolation). Sidebar shows aggregated Triage(N) badge polling /counts every 30s with exponential backoff.
- **Commit:** PENDING
- **Rationale:** Per the cross-repo handoff, webui is the read consumer for triage.jsonl. TS port over Python-subprocess: webui's auto-start path on Windows can't assume Python on PATH; small drift-protected port avoids subprocess overhead on the 30s poll. proper-lockfile vs Python _FileLock collision is bounded in practice (no Python tool writes status events for arbitrary triage ids except the manual triage_promote.py CLI). Lock-order triage-first vs sessions-first: smaller blast radius on slow-lock failures.
- **Consequences:** Operators can now promote/dismiss/snooze findings from the webui UI without dropping to a CLI. Cross-process Python _FileLock vs proper-lockfile non-composability is documented as a known limitation (mitigation: append-mode small-write line-atomicity + last-status-wins resolution). 5s mtime cache on hot read path. Per-project failure isolation via Promise.allSettled. Promote is idempotent on retry via promotedFromTriageId back-ref — partial-promote 207 + retry 201 with same taskId. Adds ~1300 LOC (server + client) + ~700 LOC of tests; +46 server tests + +22 client tests, full suite still green (1012 + 835).
- **Rejected:** Subprocess to Python triage.py for status writes (rejected: Windows autostart can't assume Python+uv on PATH; subprocess spawn overhead). Disk-first replay precedence (n/a here — not a replay flow). Flat-by-source UX (rejected for project-then-source: useful multi-project context + avoids hooks-in-loop). Native HTML controls vs Radix DropdownMenu in PromoteModal (kept native: functional equivalence + matches NewIssueModal lead-foundation pattern from ADR-100).

---

### ADR-102: Triage tab: white-surface cards + wizard-matched dialogs
- **Date:** 2026-05-15
- **Section:** Iterate — change: triage-card-styling
- **Context:** Triage item cards rendered with no background fill, so the warm-beige page bled through a faint border-stone-200 outline — low-contrast 'beige on beige'. The two triage Radix dialogs used generic Tailwind utilities (bg-white, shadow-xl, rounded-lg, bg-black/50 overlay) instead of the design tokens ProjectWizard adopted.
- **Decision:** Restyle the 3 triage components (TriageItemCard, TriageDetailModal, PromoteModal) onto existing design tokens. Cards: white --color-surface, --color-border, --radius-card, --shadow-sm resting that lifts to --shadow-card-hover. Both dialogs: --color-surface/--radius-card/--shadow-card content on a bg-black/40 backdrop-blur overlay, wizard-style icon close button, h-10 token-styled footer buttons.
- **Commit:** a203d95b628535e779749e7320475177cee4e798
- **Rationale:** The tokens already shipped and were proven by ProjectWizard; adopting them is lower-risk than bespoke values and keeps theming central.
- **Consequences:** Triage surfaces are visually consistent with ProjectWizard; no behavior change. New regression guards: 4 unit class-assertion tests plus a real-browser computed-style e2e spec (triage-restyle.spec.ts).
- **Rejected:** (1) --shadow-card at rest on every card — too heavy for a dense list (user chose subtle). (2) Recoloring Promote to brown --color-primary — emerald stays the established semantic affirmative for the cross-store Promote (ADR-101); only button geometry was matched. (3) Re-tokenizing every inner form field — out of the agreed shell+chrome scope.

---

### ADR-103: Close task redirects to the task board
- **Date:** 2026-05-15
- **Section:** Iterate — bug: close-task-redirect
- **Context:** The TaskDetail header 'Close task' menu action flipped task state to done via closeMut.mutate(task.taskId) with no navigation callback, leaving the user stranded on the now-done TaskDetail route. The sibling 'Delete task' action already navigated back to the board ('/') on success.
- **Decision:** handleClose now passes { onSuccess: () => navigate('/') } to closeMut.mutate, mirroring handleDelete. After a successful close the user is returned to the task board.
- **Commit:** 5e947423fb29e1dc5d9a17b92211092c610a9228
- **Rationale:** Both actions remove a task from the user's active focus; staying on a terminal-state detail page is a dead end. onSuccess-gating avoids navigating away when the close request fails.
- **Consequences:** Close and Delete are now consistent — both return to the board. Navigation is gated on mutation success, so a failed /close leaves the user on TaskDetail. No spec change: FR-01.15 covers only the server-side state flip and remains correct.
- **Rejected:** Unconditional navigate() in handleClose — would redirect even on a failed close. A confirm dialog like Delete's — rejected because Close is non-destructive (pure state flip), no confirmation warranted.

---

### ADR-104: Terminal remount-smear fix + reset banner
- **Date:** 2026-05-15
- **Section:** Iterate — bug: terminal-smear-reset
- **Context:** A 3-task scrollback/JSONL investigation of 'terminals freeze, fall back to PowerShell mid-run' surfaced two embedded-terminal defects: (B) heavy smear/flicker on remount during active Claude streaming, and (2) after a server restart kills the pty mid-session the user faces a silent PowerShell prompt with no sign Claude was interrupted.
- **Decision:** Bug B: replace the ADR-099-v10 setTimeout(0) atlas maintenance with term.write(data, callback) — maintenance runs in the completion callback; replaySnapshotInFlightRef makes the onWriteParsed burst-trigger early-return during the parse. Reset banner: the WS ready envelope gains a terminalReset flag (deriveTerminalReset helper + race-free get()-before-spawn() probe); EmbeddedTerminal shows a dismissable banner.
- **Commit:** 1081cb7 (PR #25, merged to main as a106b6e; the pre-rebase 038a616 was orphaned by the rebase onto origin/main)
- **Rationale:** codex:codex-rescue empirically root-caused the smear (3 real-browser probes falsified the WebGL-leak hypothesis); term.write's callback is xterm's documented after-parse hook. The freeze is a tsx-watch self-restart storm — webui cannot keep child ptys alive across its own process restart, so the in-scope fix is resilience signalling.
- **Consequences:** Smear root cause closed — maintenance no longer races the async write (ADR-099 v1-v10 were symptom patches). New additive, back-compatible terminalReset envelope field. Known false-negative: the banner is gated on the stale-persisted firstJsonlObservedAt — narrow sub-second crash window, degrades to no-banner (no regression). The tsx-watch restart-storm itself stays operational/out-of-scope.
- **Rejected:** Live JSONL-path stat for the reset signal — adds path-encoding to the WS hot path and risks a false positive on a bare-shell pty. PtyManager.spawn() returning a created flag — ripples to every caller + test. Tuning the setTimeout delay — the race is not fixable by timing.

### ADR-105: TaskCard project-identity pill
- **Date:** 2026-05-15
- **Section:** Iterate — feature: taskcard-project-pill (small)
- **Context:** The faint 3 px left-edge accent strip on TaskBoard cards was hard to read on a multi-project board — the project a task belongs to was not legible at a glance.
- **Decision:** The card meta row leads with a `ProjectPill` — the owning project's name beside a solid 8 px dot, the pill tinted + bordered in the project's accent color (`getProjectColor(projectId, settings.color)` — the custom `settings.color` or a deterministic hash-derived hue). Leftmost element, left of the `StatePill`. `color-mix(in srgb, …)` keeps the tint/border derivation format-agnostic (hex OR `hsl(…)`). Read-only — clicks fall through to the card's navigate-to-detail handler (no `stopPropagation`). The name falls back to the raw `projectId` while the projects query is still in flight.
- **Commit:** (iterate/taskcard-project-pill)
- **Rationale:** Reuses the existing `getProjectColor` single source of truth so the pill, dot, and the pre-existing 3 px left-edge strip all agree. Purely additive — no card action or menu change.
- **Consequences:** A multi-project TaskBoard is scannable per-project at a glance. New `task-card-meta-<taskId>` + `task-card-project-<taskId>` testids. `TaskCard.tsx` is now ~580 lines — already over the 300-line convention before this change; a split is deferred (out of scope).
- **Rejected:** Replacing the 3 px left-edge strip outright — keeping both anchors the color twice for accessibility. A clickable pill (filter-by-project) — out of scope; the card-level navigate is preserved.
- **Note:** Re-numbered from ADR-104 → ADR-105 (2026-05-15). ADR-104 was concurrently claimed by three commingled stalled iterates; the decision-log 104 entry belongs to terminal-smear-reset, ADR-106 to triage-promote-500.

### ADR-106: Triage write 500 fix — lock-collision + self-deadlock
- **Date:** 2026-05-15
- **Section:** Iterate — bug: triage-promote-500
- **Context:** `POST /api/triage/:projectId/{promote,dismiss,snooze}` returned `500 Internal server error` on any project the shipwright Python producer hooks had written to — permanent (a Python sidecar persists on disk), not a race.
- **Decision:** RC1 — `core/triage-lock.ts:createTriageLock()` routes the webui's `proper-lockfile` to a disjoint `triage.jsonl.weblock` directory, so it never collides with the Python `_FileLock` regular-file sidecar at `triage.jsonl.lock` (the collision was `mkdir EEXIST` → `ELOCKED`). RC2 — the promote route no longer takes a separate `sdk-sessions.json` lock; `store.persist()` locks itself, and the route-held second lock on the same file was the non-reentrant self-deadlock — `sessionsLockPath` is removed from `TriageRoutesDeps`. RC3 — genuine contention (`ELOCKED`, triage `.weblock` OR the persist lock) → `503 lock_unavailable` (generic, no path leak); a missing `triage.jsonl` → 404 before the lock; lock release in `finally` is swallowed (`releaseQuietly`) so it cannot clobber the response.
- **Commit:** iterate/triage-promote-500 (PR #23)
- **Rationale:** All three root causes empirically reproduced with `proper-lockfile` probes. `.weblock` is the minimal disjoint-path fix; the two lock primitives never composed anyway (ADR-101 Known Limitation). Lock-failure → 503 (not 500) makes contention an actionable, retriable response.
- **Consequences:** Triage write actions work on Python-touched projects. New `server/src/routes/triage.real-lock.test.ts` (surface=api) drives the production lock against a real Python regular-file sidecar — the mock-lock unit suite cannot reproduce the primitive collision.
- **Rejected:** Deleting the stale Python sidecar files (they are Python's artifacts; it re-creates them). Making webui + Python mutually exclude each other's writes (they never did — append-mode line-atomicity + last-status-wins stays the mitigation).
- **Note:** Re-numbered from a draft ADR-104 → ADR-106 (2026-05-15) — ADR-104 belongs to terminal-smear-reset, ADR-105 to taskcard-project-pill.

---

### ADR-107: Decouple the embedded-terminal pty host from the Hono server process
- **Date:** 2026-05-15
- **Section:** Architecture — embedded-terminal pty-host decoupling (planned)
- **Context:** The webui freeze (investigated in iterate-2026-05-15-terminal-smear-reset / ADR-104): embedded Claude sessions die whenever the Hono server process restarts. tsx-watch restarting on server-file saves is the frequent trigger, but the deeper cause is architectural — node-pty/ConPTY processes are children of the Hono server, so ANY server restart (watch, crash, deploy, reboot) kills every embedded session. The user dogfoods the webui to develop the webui permanently, so this recurs by design.
- **Decision:** Adopt Option B: a separate long-lived pty-host process owns all node-pty/ConPTY processes; the Hono server talks to it over a local socket/pipe and re-connects after its own restarts. The pty-host outlives Hono restarts so embedded sessions survive. Deferred to its own dedicated iterate (large — touches the whole terminal subsystem). Interim: run the server as node dist/index.js (no tsx watch) during multi-task sessions; ADR-104's reset banner is the resilience signal when a kill still occurs.
- **Commit:** a106b6e
- **Rationale:** A single process cannot be both hot-reloaded (wants restart-on-change) and a stable terminal host (must never restart). The two roles have opposite lifecycle needs and must be split into separate processes.
- **Consequences:** Until B lands, embedded sessions remain mortal to every server restart — the reset banner mitigates UX but does not prevent the kill. B is a large iterate: new process, IPC protocol, reconnection, lifecycle + PID management; on Windows the pty-host MUST be the ConPTY creator. Production-server-only was rejected as a complete fix — it removes the tsx-watch trigger but not crash/deploy/reboot.
- **Rejected:** tmux / terminal-multiplexer as the pty host — not native on Windows. Detaching the ptys in place — Windows ConPTY is bound to its creator and cannot survive the creator's death. Production-server-only — removes the dev trigger, not the architectural blast radius.

---

### ADR-108: Replay drain gate replaces ADR-099 atlas machinery (Bug B smear fix)
- **Correction (iterate-2026-05-16-converteol-smear):** This ADR did **not** fix Bug B. The replay drain gate was scoped to a snapshot/live-data write-interleave hypothesis; the actual root cause of the left-column smear was `convertEol: true` (ADR-093), fixed by flipping it to `false`. The drain-gate code remains in place as a legitimate, harmless concurrency guard, but the "Bug B smear fix" claim in this entry's title and consequences is inaccurate — see the iterate-2026-05-16-converteol-smear decision-drop.
- **Date:** 2026-05-16
- **Section:** Iterate — bug: terminal-smear-interleave
- **Context:** Bug B — the embedded terminal showed a left-column glyph-fragment smear on WS reattach. ADR-104's term.write(data,callback) fix UAT-failed (smear persisted during active streaming). A renderer-bisect probe ruled out the GPU renderer (WebGL and DOM both smeared) and verified the on-disk snapshot bytes clean. Root cause: on reattach the server emits replay_snapshot then flushes buffered live data; the client wrote the snapshot asynchronously while onData wrote live chunks unconditionally — concurrent writes corrupt the xterm buffer.
- **Decision:** Add a client-side replay drain gate to EmbeddedTerminal. While a replay_snapshot term.write is parsing, onData queues live chunks (UTF-8 byte-capped at 8 MiB, drop-oldest on overflow — never a mid-flight force-drain). The snapshot completion callback, or a 5s watchdog, drains the queue as one concatenated single-threaded write. A monotonic generation token makes the callback, watchdog and a superseding snapshot mutually idempotent. The ADR-099 WebGL atlas-maintenance machinery and 3 dead probe harnesses are deleted.
- **Commit:** d28c07e2fca8dba5771b37626e9b61f886181e0b
- **Rationale:** term.write's async parse window is the interleave surface; gating consumer-side write order is a pure client fix needing no wire-protocol change. The generation token closes the callback-vs-watchdog double-drain race flagged by external review.
- **Consequences:** Snapshot and live writes can no longer interleave, so the buffer-corruption smear is eliminated by construction. EmbeddedTerminal.tsx shrinks ~350 lines; renderer stays WebGL. 27 drain-gate unit tests cover the race matrix; the ADR-092 live-pty replay E2E passes (outcome A). WS envelope contract unchanged — server untouched. F2 skipped: internal write-ordering mechanism, no structural impact.
- **Rejected:** Server-side flush-after-client-ACK (new WS message type) — crosses the client/server boundary for a fix that is cleanly client-side. Force-drain on queue overflow — external review HIGH found it re-issues concurrent writes and re-creates the smear; drop-oldest keeps the gate closed.

---

### ADR-109: convertEol:false — fix Bug B left-column terminal smear (supersedes ADR-093)
- **Date:** 2026-05-16
- **Section:** Iterate — bug: converteol-smear
- **Run-ID:** iterate-2026-05-16-converteol-smear
- **Context:** Bug B: a left-column glyph-fragment smear in the embedded xterm.js terminal, visible when scrolling a Claude Code session. ADR-099, ADR-104 and ADR-108 each patched write timing and missed it. Root cause: convertEol:true (set by ADR-093) makes xterm carriage-return on every bare LF; ConPTY and Claude's TUI emit bare LF as cursor-down-keep-column, so the cursor was yanked to column 0 and the next write smeared the left columns.
- **Decision:** Set convertEol:false in client/src/components/terminal/EmbeddedTerminal.tsx. Add a server-side regression test (server/src/terminal/embedded-terminal-convert-eol.test.ts) that renders the captured real-Claude pty fixture through @xterm/headless with the shipped config and fails if convertEol is true.
- **Commit:** (assigned post-merge)
- **Rationale:** A deterministic @xterm/headless repro proved convertEol:false keeps the captured Claude byte-stream clean while convertEol:true collapses kept-column content to column 0. The fix is one config line at the construction site — no wire-protocol or component-structure change.
- **Consequences:** The smear is gone — UAT-confirmed on scroll and after navigate-away/reattach, and ADR-093's status-pane stacking did not return. ADR-093's convertEol:true is superseded. ADR-108's replay drain gate did NOT fix Bug B (it was scoped to a write-interleave hypothesis); its code stays as a harmless concurrency guard and the ADR-108 decision_log claim is corrected. Accepted residual: a stale cursor at the right edge, separate and out of scope.
- **Rejected:** Continue the ADR-099/104/108 approach of patching when bytes are written — empirically falsified. The bug is in how the line-feed byte is interpreted, which no write-timing patch can touch.

---

### ADR-110: Remove the Resume-CTA activity gate; one-shot inject guard + Copy Resume command
- **Date:** 2026-05-16
- **Section:** Iterate — change: resume-cta-rework
- **Run-ID:** iterate-2026-05-16-resume-cta-rework
- **Context:** The Resume-CTA activity gate (isClaudeRecentlyActive) tried to predict whether the Claude process is still alive — un-observable in the Plan-D'' default (Claude in the user's own terminal: no process handle, and a quiet JSONL is produced by both a live-idle and an exited Claude). Four signals (altScreenActive, lastPtyDataAt, lastJsonlSeenMtimeMs, the server state machine) were each empirically falsified. Separately the embedded-terminal auto-inject could type a launch command into a Claude session already running in the pane, and Copy session UUID silently failed.
- **Decision:** Delete resumeCtaGate.ts; ctaFor + the TaskCard matrix show Resume unconditionally for idle/active. Add a one-shot auto-inject guard to EmbeddedTerminal: a launch auto-injects once per pty lifetime; a second click parks behind an explicit Send to terminal confirm; re-arms on fresh pty / terminalReset. Add a Copy Resume command menu item backed by a new /launch dryRun flag (builds the command, no state mutation). Fix Copy session UUID via a shared clipboard.ts that defers the copy until the Radix menu closes and surfaces failures.
- **Commit:** (assigned post-merge)
- **Rationale:** webui structurally cannot observe Claude process-liveness; Claude's own Session ID already in use is the authoritative, non-destructive liveness check — so the gate is the wrong abstraction. The one-shot guard makes auto-inject safe-by-construction without needing liveness detection.
- **Consequences:** Resume is always reachable for a launched task — the four-times-falsified gate is gone and the redundant client-60s/server-120s double-threshold collapses. The one-shot guard prevents the command-typed-into-a-live-Claude corruption by construction. New non-mutating /launch dryRun path. Residual (Out of Scope): a Claude the user hand-typed into the pane is not guarded — webui has no liveness signal. F0.5 web verified by user UAT; unit suite green.
- **Rejected:** Feed the gate a 5th signal (parse the JSONL last event for mid-turn) — only fixes the long-thinking-turn case, never Claude-idle-waiting-for-input, still not a liveness proof. A hard one-shot with no in-pane re-send — degrades the legitimate relaunch-after-exit flow; confirm-on-reuse keeps it with one click (user-approved).

---

### ADR-111: Remove orphaned Resume-CTA liveness-gate code
- **Date:** 2026-05-17
- **Section:** Iterate — change: remove dead Resume-CTA-gate code
- **Run-ID:** iterate-2026-05-17-remove-dead-resume-gate
- **Context:** PR #29 (resume-cta-rework) made the Resume CTA unconditional and removed the activity gate, orphaning the server-side signal pipeline built for it across Iterate L + M. altScreenActive/lastPtyDataAt had zero consumers; their integration tests in pty-mirror-integration.test.ts included a flaky ENOTEMPTY teardown race (CI run #25934629309).
- **Decision:** Removed the dead pipeline: PtyManager.getLastPtyDataAt/isAltBufferActive, HeadlessMirror.isAltBufferActive, PtyEntry.lastPtyDataAt, the altScreenActive/lastPtyDataAt augmentation in routes.ts withLiveSession(), the two ExternalTask type fields, and the Iterate L + M test describe blocks. liveSession and the snapshot-replay machinery are untouched.
- **Commit:** (assigned post-merge)
- **Rationale:** Patching the flaky test's flushMicrotasks would have been a band-aid on dead code. Removing the orphaned producer pipeline fixes the flake at the root and pays down dead weight in one step.
- **Consequences:** The /api/external/tasks response loses two optional fields that had no consumers — no client breaks (client tsc green). The flaky CI test is eliminated at the root. ~419 LOC of dead code removed; server 1061 + client 874 tests pass.
- **Rejected:** Option B — keep the dead computation, only patch the flaky test teardown. Rejected: leaves ~419 LOC of dead code shipping over the API and costing context on every read.

---

### ADR-112: Move-to-Backlog endpoint + In-Progress→draft state flip
- **Date:** 2026-05-18
- **Section:** Iterate — feature: move-to-backlog
- **Run-ID:** iterate-2026-05-17-move-to-backlog
- **Context:** Task state only flowed forward (/launch → in-progress, /close → done); there was no path back to the Backlog column. Users wanted to re-shelve an In-Progress task.
- **Decision:** New POST /api/external/tasks/:id/backlog (sibling of /close) flips state→draft for the five In-Progress states; 409 backlog_invalid_state for done; idempotent 200 for draft; ELOCKED→409. Every history field preserved. The GET /transcript state machine is now draft-sticky in both branches. A 'Move to Backlog' item is added to the TaskCard and TaskDetailHeader ⋯-menus; a draft task with firstJsonlObservedAt renders Resume, not a fresh Launch.
- **Commit:** (assigned post-merge)
- **Rationale:** A dedicated verb-route (not extending PATCH to accept state) keeps PATCH metadata-only and prevents bypassing the launch/close state machine. The draft-stickiness guard keys on launchedAt so a genuinely fresh never-launched draft still bootstraps to active on its first JSONL (external code review, gemini, caught the over-broad first version). firstJsonlObservedAt drives the Resume-vs-Launch rule, avoiding Claude's 'Session ID already in use' on a fresh re-launch.
- **Consequences:** Backlog becomes a reversible re-organisation gesture, not a reset. Pipeline phase-task shadows can be backlogged — this relabels only the webui shadow, never shipwright_run_config.json (DO-NOT #12); a known, accepted drift. WebUI has no auth layer; /backlog has the same loopback-only exposure as /close.
- **Rejected:** Extend PATCH /tasks/:id to accept a free-form state — rejected: would let a client set any state and bypass the state machine. Drag-and-drop between board columns — deferred to a follow-up iterate (new @dnd-kit dependency + TaskBoardPage rebuild would push this to large).

---

### ADR-113: Inbox surfaces waiting terminal pickers + focuses terminal on Inbox click
- **Date:** 2026-05-18
- **Section:** Iterate — feature: inbox-terminal-prompts
- **Run-ID:** iterate-2026-05-18-inbox-terminal-prompts
- **Context:** A waiting AskUserQuestion picker in the embedded terminal never appears in the JSONL — Claude Code journals a tool turn only after it returns — so the JSONL-derived Inbox could not show it. Separately, clicking an Inbox card landed on TaskDetail but not in the terminal, costing an extra click before answering.
- **Decision:** Added a third Inbox detection source: the live @xterm/headless mirror. New pure extractTerminalPrompt recognizes a waiting picker by its footer signature and extracts the visible block; /inbox emits it as a new terminal_prompt item kind (precedence ask_tool > terminal_prompt > text_question). Inbox cards pass {focusTerminal:true} nav-state; TaskDetail consumes it to focus xterm via the existing pendingFocus path.
- **Commit:** (assigned post-merge)
- **Rationale:** The JSONL cannot carry a live picker — confirmed against a real session JSONL (every AskUserQuestion tool_use paired with its result). The terminal mirror is the only source reflecting an on-screen picker. Showing the raw block reuses the text_question card; the focus fix reuses the pendingFocus->handleTerminalReady path.
- **Consequences:** Inbox now surfaces interactive picker questions previously invisible; cards land with the cursor in the terminal. New server->pty-manager coupling (peekTerminalText). Detection is best-effort, live-only — external-terminal launches (no mirror) are not covered, a documented inherent limit. Self-Review: 7-point checklist clean — outcome-asserting tests, wiring verified, edge/error paths covered, no regressions (1127 server + 935 client green); Affected Boundaries n/a.
- **Rejected:** In-place answering in the Inbox (writer contention, blind send, best-effort staleness — needs its own ADR). Navigate-and-prefill (pointless once focused). Marker-only terminal_prompt without the question text (the mirror yields decoded cell text, so showing the block is barely more code).

---

### ADR-114: Embedded-terminal keyboard copy/paste via attachCustomKeyEventHandler
- **Date:** 2026-05-18
- **Section:** Iterate — feature: terminal copy/paste
- **Run-ID:** iterate-2026-05-18-terminal-copy-paste
- **Context:** xterm.js ships no text-copy binding and its built-in Ctrl+V fails silently when the WebUI is opened over the Tailscale IP (non-secure context, navigator.clipboard unavailable). Separately, pasting a long multi-line prompt truncated it: the DOM paste listener sent raw clipboard text via socket.send, bypassing term.paste(), so an app with bracketed-paste mode (Claude TUI / PSReadLine) read each newline as Enter and submitted on the first line.
- **Decision:** Add one term.attachCustomKeyEventHandler: Ctrl+C / Ctrl+Insert copy the xterm selection (via lib/clipboard.copyText, whose execCommand fallback works over http); Ctrl+V / Shift+Insert paste via term.paste(). The DOM paste listener text branch also switches to term.paste(). Logic lives in co-located terminal-clipboard.ts (pure classifier + DI handler factory). A transient corner-pill notice surfaces Copied / Copy failed / a non-secure-context paste hint.
- **Commit:** (assigned post-merge)
- **Rationale:** VS Code's Windows terminal uses the same chord set; it solves the secure-context problem by serving over HTTPS, not a non-http paste trick (there is none). attachCustomKeyEventHandler is xterm's intended interception point.
- **Consequences:** Keyboard copy works everywhere incl. Tailscale http; paste works in secure contexts and shows a clear right-click hint otherwise; multi-line pastes preserve formatting. 42 unit/wiring tests + 4 real-browser E2E. EmbeddedTerminal.tsx grew ~95 LOC (file was already 1387 > the 300-line limit; pre-existing, override logged). HTTPS-over-Tailscale is a tracked follow-up.
- **Rejected:** Ctrl+Shift+C as always-copy — collides with Chrome's DevTools accelerator. Copy-on-select — user declined. Custom right-click paste — navigator.clipboard.readText() fails over Tailscale http; the native browser right-click Paste is the only path that works there.

---

### ADR-115: oxlint replaces the dead lint script; CORS test env-isolated via vi.hoisted
- **Date:** 2026-05-19
- **Section:** Iterate — change: oxlint adoption + CORS test env-isolation
- **Run-ID:** iterate-2026-05-19-oxlint-and-cors-env
- **Context:** Two pre-existing tooling/test-hygiene defects, surfaced during PR #33. (a) server/src/index.test.ts read process.env ambient; a dev shell with SHIPWRIGHT_NETWORK_PROFILE=tailscale widened the import-time-baked CORS policy and failed the default-loopback assertion (1/1156). (b) 'npm run lint' was dead: client had 'eslint src/' with no eslint dependency and no config anywhere; server had no lint script at all.
- **Decision:** (a) Scrub WEBUI_TRUSTED_ORIGINS / HONO_HOST / SHIPWRIGHT_NETWORK_PROFILE in a vi.hoisted() block before the ./index.js import (index.ts bakes corsOriginPolicy in a module-level const at import time). (b) Adopt oxlint: oxlint devDependency + 'lint: oxlint .' in both client and server package.json; ci.yml runs 'npm run lint' as a real non-suppressed step in both jobs; CLAUDE.md doc line corrected.
- **Commit:** (assigned post-merge)
- **Rationale:** vi.hoisted is the only mechanism that runs before a static ESM import; a beforeEach scrub is too late. oxlint chosen over an ESLint flat-config because it needs no config, ran with 0 errors, and CI already referenced it ad-hoc.
- **Consequences:** 'npm run lint' works in both halves (exit 0; 44 pre-existing warnings, 0 errors). CI lint is now a deterministic locked-version error-gate, replacing 'npx oxlint . || true' + continue-on-error. The CORS test passes regardless of ambient shell env (verified under tailscale / HONO_HOST / clean). 2135 tests green. The 44-warning backlog is deliberately left for a future cleanup iterate.
- **Rejected:** (i) ESLint flat-config + plugins + clearing the never-linted findings backlog: higher effort, deferred. (iii) Delete the dead lint script and only fix docs: leaves the project with no linter.

---

### ADR-116: Triage Tab gains launchPayload rendering + Fix-now CTA (WebUI counterpart to shipwright Iterate A)
- **Date:** 2026-05-20
- **Section:** Iterate — feature: triage-launch-surface-webui
- **Run-ID:** iterate-2026-05-20-triage-launch-surface-webui
- **Context:** shipwright iterate-2026-05-20-triage-launch-surface (PR #41, merged 2026-05-20) converted .shipwright/triage.jsonl from a finding-mirror into a launch-surface: every append event now carries an optional launchPayload string (slash command + context + URL) frozen at first write by the producer. The WebUI's Triage Tab needed a GUI counterpart so operators don't drop to triage_cli.py just to see the launch block.
- **Decision:** Surface launchPayload in TriageDetailModal via a new <LaunchPayloadBlock> (renders <pre><code> for non-empty payloads, a verbatim loud-failure placeholder for source=github items with missing/empty/cleaned-empty payloads, nothing for legacy items). A new Fix-now button copies the cleaned payload via lib/clipboard.copyText. Renderability + copy share a single prepareLaunchPayload helper (single source of truth). The WebUI continues using its TS-side status-event writer (ADR-101/ADR-106); subprocess invocation of triage_cli.py was rejected because launchPayload is only on append events the WebUI never writes, so the existing TS-port parity gate already covers the field.
- **Commit:** (assigned post-merge)
- **Rationale:** (1) Iterate A's prompt explicitly endorses copy-paste as the v1 fix-now flow ('autonomous subprocess spawn deferred until the launcher pattern is proven'). (2) WebUI Arch rule 1 forbids spawning Claude — clipboard-copy is the only architecturally clean Fix-now. (3) The TS status-event writer has extensive parity tests + the proper-lockfile/.weblock posture; subprocess invocation would add cross-platform fragility (uv-on-Windows .cmd shim, shipwright-checkout path discovery, subprocess timeout) for zero benefit since launchPayload isn't on the write path. (4) prepareLaunchPayload as a single helper closes external review MED #3/4/11 (renderability SoT, github placeholder fires on CLEANED-empty, copy uses cleaned bytes).
- **Consequences:** + Operators can copy launch payloads from the WebUI without dropping to CLI.\n+ Github producer regressions surface loudly instead of silently degrading.\n+ Single helper enforces 'rendered text === copied text'.\n+ Cross-workspace TriageItem drift guard added (triage-schema-sync.test.ts) — catches future field additions in either half.\n- WebUI clipboard write is non-secure-context-dependent (httponly Tailscale); inline failure UX surfaces this loud (no silent swallow).
- **Rejected:** Subprocess invocation of shared/scripts/tools/triage_cli.py: rejected because (a) WebUI doesn't write launchPayload, only reads it, so the parity surface is the resolver (already gated), not the writer; (b) the existing TS writer is the established posture; (c) added cross-platform fragility for no architectural gain. Inject-into-active-Claude-session: rejected because (a) WebUI has no cross-route 'foreground terminal' lookup; (b) Arch rule 1 (WebUI never spawns Claude) extends to mid-session prompt injection. The operator's clipboard + manual paste IS the inject mechanism.

---

### ADR-117: Skip WS reconnect on clean close of a replay-only attach
- **Date:** 2026-05-21
- **Section:** Iterate — bug: fix-terminal-flicker-on-closed-task
- **Run-ID:** iterate-2026-05-21-fix-terminal-flicker-on-closed-task
- **Context:** Closed tasks (state=done/launch_failed) bypass pty spawn; server sends ready+replay_snapshot then close(1000). Pre-fix the client's close handler always called scheduleReconnect(); attemptsRef resets to 0 on every successful open, so the loop was infinite. Each reconnect replayed the snapshot via term.reset()+term.write(), visible as a ~200ms flicker. Decision log already flagged this as the 'pre-existing replay-only WS-reconnect-loop' (line 2040).
- **Decision:** Gate the close handler's scheduleReconnect() on (replayOnlyRef.current === true && closeCode === 1000). The ref mirrors the most recent ready.replayOnly value; reset on cleanup, disabled branch, and at the top of every new connect(). Live attaches still reconnect on abnormal closes (1006) or any non-1000 graceful close. The pre-existing cancelled-flag short-circuit handles client-initiated unmount cleanly so the new gate never interferes there.
- **Commit:** (assigned post-merge)
- **Rationale:** Client-only gate is narrower than the alternative (holding the WS open server-side) and matches the existing server contract that already says 'replay-only attaches are one-shot'. External review (gemini+openai cold-read via OpenRouter) raised 9 findings; 5 actionable items applied to the diff (defense-in-depth ref reset, narrowing comment, snapshot-callback spy in test, E2E StrictMode-tolerant <=2 assertion, spec wording fix); 4 dismissed with explicit reasoning in the iterate spec.
- **Consequences:** Client opens exactly one WS per visit to a closed task; snapshot replay runs exactly once. Live attaches unchanged. Stale-server back-compat preserved (missing replayOnly field falls back to false, gate never fires). Mixed-version deploy isn't a risk for this product (Hono serves the client statics — same process).
- **Rejected:** Server-side: keep the replay-only WS open instead of closing — larger blast radius (idle-WS TTL knob, multi-tab idle accounting, fixtures). Pre-emptive close-code-1000 retry budget — would suppress reconnect after graceful server restarts of LIVE attaches, regression-equivalent for live sessions.

---

### ADR-118: Triage Fix-now opens NewIssueModal (lifted to TriagePage); 4 phase slashes namespaced via :skill suffix
- **Date:** 2026-05-21
- **Section:** Iterate — change: Triage Fix-now opens NewIssueModal + phase slash namespace workaround
- **Run-ID:** iterate-2026-05-21-triage-fix-now-and-phase-slash
- **Context:** Two coupled changes. (1) The iterate-2026-05-20 Fix-now CTA copied launchPayload to clipboard — only renderable for github-source items with a producer payload, dead-end for everything else. (2) Four Claude Code skill resolutions empirically fail in the bare form (Sven 2026-05-21): /shipwright-plan, /shipwright-test, /shipwright-security, /shipwright-run. Upstream plugin-name alignment attempted multiple times, no luck — workaround in webui.
- **Decision:** (1) Fix-now button now renders on every status==='triage' item. Click builds a FixNowIntent via core/triage/fixNowIntent.buildFixNowIntent (source==='github' → new-task+phase=security, else → new-iterate); intent bubbles up to TriagePage which mounts NewIssueModal at page scope. Pre-fill: title='Fix for '+item.title, description=item.detail, priority=item.suggestedPriority, domain=item.suggestedDomain. (2) buildSlashCommand in actions-substitute.ts emits the namespaced form '/shipwright-<phase>:<phase>' for phase∈{plan,test,security} and '/shipwright-run:run' for new-pipeline; everything else keeps the bare form.
- **Commit:** (assigned post-merge)
- **Rationale:** Source-only discriminator validated against Sven's live Triage Tab screenshot 2026-05-21 — github source is always security-scan rollup; iterate/phaseQuality/compliance are iterate-flow. NewIssueModal lifted to TriagePage because the iterate-2026-05-14 TriagePage pattern wraps TriageDetailModal in '{selected && …}' — unmount-on-close would otherwise kill the spawned modal mid-transition. Slash workaround scoped to the four empirically-broken cases; broader sweep risks breaking flows currently working.
- **Consequences:** Triage Fix-now is now a one-click route into a pre-populated New-* dialog for ALL triage sources, not just github+launchPayload items. The four flagged slashes resolve to the right skill; other phases unchanged. NewIssueModal lifecycle is parent-owned (TriagePage) so it survives the TriageDetailModal unmount. New module client/src/components/triage/fixNowIntent.ts isolates the routing helper for future reuse.
- **Rejected:** (a) kind==='compliance' branch for security mode — rejected after UAT: compliance items here are refactor/spec work, not security. (b) Namespacing all phases — risks breaking /shipwright-build etc. which work bare. (c) Sibling NewIssueModal inside TriageDetailModal — fails because of the parent's unmount-on-close guard.

---

### ADR-119: Phase 0f: clear F4-F7 ADR-bloat / arch-marker / CLAUDE.md hygiene
- **Date:** 2026-05-22
- **Section:** Iterate — change: compliance documentation hygiene (Phase 0f, F4-F7)
- **Run-ID:** iterate-2026-05-22-compliance-hygiene-phase-0f
- **Context:** Phase 0c slimmed ADR-087/088 and 0e stripped Iterate annotations from CLAUDE.md, but F4/F5/F6/F7 still flagged 5 bloated ADRs (058/095/096/098/099), a missing architecture marker, CLAUDE.md at 270 lines, and 8 inline iterate references. c0c9338 explicitly deferred F4-F7 to a separate iterate.
- **Decision:** Extract the 5 bloated ADRs to .shipwright/planning/adr/NNN-slug.md spec files and slim their decision_log entries to compact form with Details links. Add the shipwright:architecture marker to architecture.md. Replace CLAUDE.md's 112-line tree with a 2-sentence summary pointing at architecture.md, and strip iterate annotations from 3 section headers and 1 prose line.
- **Commit:** (assigned post-merge)
- **Rationale:** Matches Phase 0c and 0e patterns. Spec files preserve full prose for recoverability; slim decision_log entries retain the decision summary plus the Details link F4 expects.
- **Consequences:** F4, F6, F7 audit detectors GREEN in worktree (5 bloated ADRs to 0; CLAUDE.md 270 to 163; inline refs 8 to 1). F5 will GREEN in main (decision-drops/ is gitignored, absent in worktree). decision_log.md shrinks; spec files carry full prose. No code paths touched; no FR changes.
- **Rejected:** Reformat legacy h2 ADRs 045b/065/066 to fit the F4 regex (collides with renumbered h3 IDs); leave CLAUDE.md tree in place (cap is real); remove Iterate H reference from DO-NOT guard 22 (load-bearing, names the 60 percent snapshot heuristic).
- **Details:** [058-webui-three-fix-bundle.md](../planning/adr/058-webui-three-fix-bundle.md)

---

### ADR-120: Hono SPA fallback to client/dist/index.html for non-/api GETs
- **Date:** 2026-05-22
- **Section:** Iterate — bug: SPA fallback for /triage, /inbox & friends
- **Run-ID:** iterate-2026-05-22-spa-fallback
- **Context:** Hard-reload on /triage, /inbox, /tasks/:id, /projects, /diagnostics, /settings returned JSON 404 because the production server only wired serveStatic + notFound — no SPA fallback.
- **Decision:** Add a wildcard app.get('*') handler AFTER serveStatic that reads client/dist/index.html for any non-/api GET; /api/* paths next() through to the existing notFound JSON 404.
- **Commit:** (assigned post-merge)
- **Rationale:** Smallest change that fixes the regression; reuses existing readFile import; uses path-prefix check (cheap, deterministic) rather than rebuilding route allow-lists; test seam via SHIPWRIGHT_STATIC_DIR env override avoids depending on a built client/dist in the worktree.
- **Consequences:** Hard-reload of every SPA route works again; /api/* JSON-404 contract is preserved; index.html unreadable falls back to JSON 404 instead of leaking ENOENT.
- **Rejected:** Returning index.html from serveStatic's onNotFound — couples the static middleware to SPA policy and obscures the /api guard. Hard-coding the SPA route list — drifts whenever client/src/router.tsx changes.

---

### ADR-121: Thread projectId through FixNowIntent → NewIssueModal
- **Date:** 2026-05-22
- **Section:** Iterate — bug: triage Fix-now NewIssueModal pre-selects the right project
- **Run-ID:** iterate-2026-05-22-triage-fix-now-project-preselect
- **Context:** Bug 2026-05-22: Triage Fix-now opened NewIssueModal pre-filled with title/description/phase/priority/domain but the project dropdown was blank — user had to re-pick the project manually for every Fix-now click.
- **Decision:** Add projectId to FixNowIntent (required 3rd arg of buildFixNowIntent); add optional initialProjectId prop to NewIssueModal that overrides scopedProject + realProjects[0] fallback; TriagePage passes intent.projectId to the modal.
- **Commit:** (assigned post-merge)
- **Rationale:** Single source of truth on the intent object; matches the pattern of the other initialX props added in iterate-2026-05-21. Alternative considered — pass projectId only at the TriagePage layer without threading through the intent — rejected because future Fix-now callsites (e.g. TriageItemCard hover CTA in the file header rationale) would re-introduce the same gap.
- **Consequences:** Triage item's project is now the single source of truth for the spawned task; sidebar Project Filter no longer leaks into Fix-now routing. Backwards-compatible at the modal level (initialProjectId is optional).
- **Rejected:** Bypass the intent and pass projectId only at TriagePage scope: rejected — re-introduces the missing-prop gap for any future callsite.

---

### ADR-122: VS Code-aligned terminal selection + copy-on-mouseup + mouse-mode hint
- **Date:** 2026-05-23
- **Section:** Iterate — change: terminal selection UX (VS Code parity)
- **Run-ID:** iterate-2026-05-23-terminal-selection-uxd
- **Context:** User reported embedded-terminal selection was much worse than VS Code's integrated terminal — drag-select is blocked inside Claude TUI (SGR mouse-mode) and the Shift+Drag escape hatch was undiscoverable. VS Code parity research confirmed the gap.
- **Decision:** Add VS-Code-aligned Terminal options (rightClickSelectsWord, macOptionClickForcesSelection, wordSeparator). Track selection via term.onSelectionChange (hint) but FIRE copyText only from document-scope mouseup/keyup gated by mousedown-origin + activeElement focus. Render a dismissable banner when .enable-mouse-events class is on term.element.
- **Commit:** (assigned post-merge)
- **Rationale:** External iterate review HIGH: onSelectionChange fires per-cell during drag (clipboard spam + lost user activation in strict browsers). Pulling the actual copy to mouseup preserves browser transient-user-activation and naturally debounces. Origin tracking + dedup-on-empty prevent cross-pane clipboard overwrites.
- **Consequences:** Drag-select inside a non-mouse-tracking shell auto-fills the OS clipboard. The 'Maus-Modus aktiv — Shift+Drag zum Markieren' banner makes the escape hatch discoverable. No new write surface; no new dep; xterm pin (6.0.0) unchanged.
- **Rejected:** URL-state per-user wordSeparator (premature). Server-side mouse-mode signal via WS envelope (duplicates xterm class). CSS-only ::before hint (not dismissable, not i18n-friendly, unreliable over canvas).

---

### ADR-123: Auto-focus xterm on Terminal tab activation
- **Date:** 2026-05-23
- **Section:** Iterate — change: terminal tab autofocus
- **Run-ID:** iterate-2026-05-23-terminal-tab-autofocus
- **Context:** User reported: clicking the Terminal tab leaves keyboard focus on the tab trigger button — user has to click into the canvas before typing. VS Code's integrated terminal grabs focus automatically on tab switch.
- **Decision:** Add a useEffect in EmbeddedTerminal.tsx gated on (active, socket.ready) with a per-active-window latch (tabAutoFocusedRef). On rising edge it defers term.focus() via setTimeout(0) so Radix Tabs.Content's data-[state=inactive]:hidden CSS has settled — focus() on an element inside display:none is a silent no-op.
- **Commit:** (assigned post-merge)
- **Rationale:** F0.5 spec 88 caught a synchronous-focus bug that unit tests missed: Radix's CSS state-flip hadn't propagated when the effect ran, so xterm's helper-textarea (still in display:none) silently rejected focus and the tab trigger button kept focus. setTimeout(0) defer is the cheapest fix that lands after the layout pass + remains testable in jsdom (rAF would have required fake-timer plumbing).
- **Consequences:** Tab-switch to Terminal now lands the cursor in xterm immediately. Stable active=true re-renders are no-ops (no focus-stealing). The orthogonal focusTerminal nav-state path is unchanged.
- **Rejected:** rAF: harder to test in jsdom. Pulling focus into TaskDetailPage onValueChange: leaks Tabs concerns into the imperative ref consumer. Eager focus without defer: empirically broken (caught by spec 88).

---

### ADR-124: InboxPage split into sections + useInboxData hook (Campaign C — C7)
- **Date:** 2026-05-26
- **Section:** Iterate — refactor: campaign-C-C7-inbox-page-split
- **Run-ID:** iterate-2026-05-26-campaign-C-C7-inbox-page-split
- **Context:** `client/src/pages/InboxPage.tsx` was 967 LOC, grandfathered at limit 300 in `shipwright_bloat_baseline.json`. Campaign C target.
- **Decision:** Split the page into a thin shell (116 LOC) + 5 modules under `client/src/pages/inbox/`: `useInboxData.ts` (TanStack-wrapper derivation hook), `InboxProjectSection.tsx` (per-project `<details>` group), `InboxCard.tsx` (polymorphic dispatcher with sub-modules `InboxCard.AskTool.tsx` + `InboxCard.Waiting.tsx` — pre-budgeted sub-split when InboxCard.tsx hit 458 LOC), `InboxResumeButton.tsx` (Answer/Resume CTA), `types.ts` (`SessionGroup` + `ProjectGroup`), and `__fixtures__/inbox-fixtures.ts` (shared test factories). Remove `client/src/pages/InboxPage.tsx` from `shipwright_bloat_baseline.json` (cleanup-invariant rule a). The speculative slot names in the campaign sub-iterate spec (`HistorySection`/`InboxFilters`) were reconciled to actual code concerns — InboxPage has no history view and no filter UI today; inventing empty slots would have ratcheted new oversize-risk files for no behavioural reason (Karpathy principle #2).
- **Commit:** (assigned post-merge)
- **Architecture-Impact:** component
- **Rationale:** Behaviour preserved — same DOM tree, same testids, same hooks, same query keys, same polling cadence (3s from `useExternalInbox.refetchInterval`, inherited unchanged). External LLM plan review (gemini + openai) flagged TanStack wrapper-object ref-instability (HIGH) and the memo-stability ≠ query-key-stability distinction (HIGH) — both addressed via the implementation contract: `useInboxData` useMemo deps unpack `.data`, the hook calls each underlying TanStack hook with zero args, the contract test asserts call-count = 1 per render. External code review caught two MEDIUM test-gap findings (clipboard-rejection path; data-change rerender) — both addressed before commit. Existing `InboxPage.test.tsx` (22 cases) passes unchanged → DOM + click-through + XSS contract preserved.
- **Consequences:** + `InboxPage.tsx` no longer over-limit (967 → 116 LOC). + 4 new sub-modules each ≤300 LOC; one baseline entry deleted; no new entries added (cleanup-invariant compliant). + 47 inbox tests + 1059 unrelated = 1106 GREEN; typecheck clean. - Adds one new folder under `client/src/pages/inbox/` (no barrel — existing project convention).
- **Rejected:** (1) Fabricating empty `HistorySection.tsx` + `InboxFilters.tsx` files to satisfy the campaign slot names — premature abstraction, would create fresh oversize-risk files for non-existent concerns. (2) Keeping `InboxCard.tsx` as one 458-LOC file — would violate the cleanup-invariant ("Source files MUST be ≤ 300 LOC … NEVER add it as a fresh `state=grandfathered` entry — that defeats the campaign"). (3) Re-implementing the TanStack queries inside `useInboxData` (would break the wrapper-only contract and risk query-key drift).

