# ADR-058 spec — WebUI three-fix bundle: stuck Awaiting-launch state, chat padding, system pills

**Linked decision:** `.shipwright/agent_docs/decision_log.md` → ADR-058.
**Date:** 2026-04-24.
**Section:** Iterate — bug bundle: status-fix + chat-padding + system-pill-filter.
**Commit:** `89e55bf43b9c471ae8bdc6e610bc6d3a5346eafb`.

## Context

Live-test feedback on TaskDetail surfaced three independent issues:

1. The status badge stayed on **Awaiting launch** after the user re-launched a task even though the embedded terminal had clearly resumed.
2. Chat bubbles in `BubbleTranscript` rendered flush against the chat-column edges, making the message column feel uncomfortably wide.
3. Title / Agent-name / Permission-mode "system pills" were leaking past the system-message visibility toggle and cluttering the chat for users who had toggled them off.

## Decision

Three minimal targeted fixes:

1. **Status state machine** — add `awaiting_external_start` to the transcript-poll auto-recover branch (alongside `jsonl_missing`) so re-launched tasks transition `→ active` on the next polling tick when their JSONL becomes fresh.
2. **Chat padding** — bump `BubbleTranscript`'s lateral padding from 22 px to 40 px on both `PlainBubbles` and `VirtualBubbles`.
3. **System pill filter** — introduce a `SYSTEM_KINDS` set covering `system` + `custom-title` + `agent-name` + `permission-mode`; both the filter predicate and the show-system-messages toolbar count consult it.

## Rationale

The status-machine change preserves the special-case "fresh task gets its first transition logged via `firstJsonlObservedAt`" — only the auto-recover branch is widened. Padding chosen to match a comfortable reading inset without making bubbles narrower than the existing `max-width` caps. The pill-filter route picks Option A (default-hide-behind-toggle) over Option B (renderer removal) so the data is still inspectable when a user enables the toggle.

## Consequences

1. Re-launches now self-recover within one polling tick (≤1 s). The `firstJsonlObservedAt` gate remains authoritative for the very first transition out of `draft`.
2. The chat column reads as visibly inset; no other layout knobs were touched.
3. The "show system messages" toggle now reveals all four pill kinds atomically; the default chat is cleaner. Iterate-3 chip-variant tests opt-in via the toggle.

## Rejected Alternatives

- **Option B for pills (renderer removal):** rejected because it loses debug affordance for advanced users without any real benefit.
- **Status-fix variant: "don't reset to `awaiting_external_start` in POST /launch when `firstJsonlObservedAt` is set":** rejected because the "fresh launch" semantic of `POST /launch` is load-bearing and weakening it risks Resume / Fork regressions elsewhere.
