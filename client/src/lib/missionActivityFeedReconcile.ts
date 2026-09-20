/**
 * Post-event-loop reconciliation for `missionActivityFeed.ts`'s reducer:
 * folding MissionContext's own artifact/test-gate evidence onto the cards
 * already built from the transcript, plus the final `outcome` computation.
 * Split out once the reducer crossed the project's 300-line convention
 * (iterate-2026-08-22-mission-feed-fixes) — a distinct concern from the
 * event-driven card-building loop above it: this half reads `context`, the
 * loop above never does except to gate whether an artifact chip is shown.
 */
import type { ArtifactKind, CommitArtifact, MissionContext } from "./missionContextApi";
import type { ActivityCard, ActivityFeed } from "./missionActivityFeedTypes";
import { artifact, reconcileTestGate } from "./missionActivityFeedReconcileTests";

/** Clears a stale `explanation` written for a card that turned out to span
 *  MORE than one assistant turn — an explanation is only ever exactly one
 *  turn's words (see `ActivityCard.explanation`'s doc comment) and a later
 *  turn coalescing into the same card must not leave an earlier turn's
 *  words looking like they cover the whole card. Extracted from
 *  `deriveActivityFeed`'s own post-loop pass (iterate-2026-09-16-mission-
 *  feed-render-fidelity bloat-ceiling split) — pure mutation, no behavior
 *  change. A card that never got a turn's own prose (`text === ""`) still
 *  renders its command chip(s); nothing to clear here for it. */
export function clearMultiTurnExplanations(cards: ActivityCard[], cardTurnCounts: Map<ActivityCard, number>): void {
  for (const card of cards) {
    if (card.explanation && cardTurnCounts.get(card) !== 1) {
      delete card.explanation;
      delete card.explanationFull;
    }
  }
}

export function reconcileArtifactCards(
  cards: ActivityCard[],
  context: MissionContext | null,
  testCards: ActivityCard[],
  unresolvedTest: ActivityCard | null,
  awaitingTestResult: Set<ActivityCard>,
): ActivityFeed {
  reconcileTestGate(cards, context, testCards, unresolvedTest, awaitingTestResult);
  // A tool-only turn that wrote no words of its own renders as a bare header
  // + command chip(s) with nothing a reader can learn from (reported: "viele
  // implement mit ... Bashbefehlen, aber ohne Text", iterate-2026-09-20-
  // mission-feed-transcript-fidelity; the same shape for `spec` is the bare
  // "Open Spec"-and-nothing-else card called out separately). Filtered here
  // — BEFORE the spec/requirement/decisions backfill loop, not after (code-
  // review catch, medium): a wordless `spec`-bucket card can already carry
  // `artifact: "spec"`, and the backfill's own dedupe guard would otherwise
  // see it and skip synthesizing the richer server-summary card — losing the
  // evidence altogether. `review`/`test`/`user-input` are exempt: `review`
  // gets its own narrower filter below (after the review-artifact reconcile
  // has a chance to supply real content), and `test`'s pill/chip already
  // carry real information with no narration needed. `droppedNoSummaryKinds`
  // below is what stops that SAME backfill loop from resynthesizing the
  // generic PLACEHOLDER sentence for a kind whose only card was just
  // wordless-dropped here AND whose artifact carries no real summary either
  // — item 5 of the bug report wants a content-free "Open Spec and nothing
  // else" gone, not reworded. It must NOT also suppress a REAL summary
  // (round-2 code review catch, medium: an earlier version keyed only on
  // "was a card dropped", which threw away genuine spec/requirement/decision
  // evidence too — issue #6's guarantee that durable evidence is never
  // invisible merely because `summary` is null still has to hold for the
  // "dropped" case, not just the "never touched" one).
  const droppedNoSummaryKinds = new Set(
    cards
      .filter((card) => (card.kind === "implement" || card.kind === "investigate" || card.kind === "spec")
        && !card.text && !card.explanation && card.artifact
        && !context?.artifacts.find((entry) => entry.kind === card.artifact)?.summary)
      .map((card) => card.artifact),
  );
  // Preserves a dropped wordless card's command evidence (the tool call(s)
  // that actually produced the artifact) for the backfill loop below to
  // carry onto its synthesized replacement — without this, a card dropped
  // here because it had a `summary` to fall back on (so it's NOT in
  // `droppedNoSummaryKinds` and DOES get backfilled) silently lost its
  // command chip/count along the way (round-6 external review catch, glm,
  // low): the backfilled card always started from `commands: []`.
  const droppedCardCommands = new Map(
    cards
      .filter((card) => (card.kind === "implement" || card.kind === "investigate" || card.kind === "spec")
        && !card.text && !card.explanation && card.artifact)
      .map((card) => [
        card.artifact,
        { commands: card.commands, commandCount: card.commandCount, commandFullText: card.commandFullText },
      ] as const),
  );
  let filtered = cards.filter((card) => !(
    (card.kind === "implement" || card.kind === "investigate" || card.kind === "spec")
    && !card.text && !card.explanation
  ));
  for (const kind of ["spec", "requirement", "decisions"] as const) {
    // The server already writes a rich, always-populated `summary` for every
    // `state: "available"` artifact (`server/src/core/mission-context/
    // artifacts.ts`) — prefer it over the generic placeholder text, which
    // was rendering unconditionally regardless of what actually happened
    // (iterate-2026-09-05-mission-feed-ux-gaps: "Requirement evidence is
    // available. ist irgendwie leer immer am Ende der Kette"). The fallback
    // stays for the rare artifact shape with no `summary` field at all
    // (issue #6) — but never for a kind whose own wordless, summary-less
    // card was just dropped above (code-review-driven full-suite catch,
    // iterate-2026-09-20-mission-feed-transcript-fidelity).
    const item = context?.artifacts.find((entry) => entry.kind === kind && entry.state === "available");
    if (item && !droppedNoSummaryKinds.has(kind) && !filtered.some((card) => card.artifact === kind)) {
      const fallback = kind === "spec" ? "Specification evidence is available."
        : kind === "requirement" ? "Requirement evidence is available." : "A recorded decision is available.";
      const preserved = droppedCardCommands.get(kind);
      filtered.push({
        kind: "spec", text: item.summary ?? fallback, commands: preserved?.commands ?? [],
        commandCount: preserved?.commandCount, commandFullText: preserved?.commandFullText,
        artifact: kind, status: "ok",
      });
    }
  }
  if (artifact(context, "review")) {
    const review = [...filtered].reverse().find((card) => card.kind === "review");
    if (review) {
      review.text = "The recorded review evidence is available.";
      // A rewritten headline must never sit above an explanation excerpted
      // from a DIFFERENT turn's own words (iterate-2026-08-25-mission-feed-progress-narration,
      // Internal Plan Review finding). `test`-kind cards' own text rewrites
      // above need no equivalent clear — a `test` card never gets
      // `explanation` in the first place (only investigate/spec/implement/review
      // cards can).
      delete review.explanation;
      review.artifact = "review";
      review.status = "ok";
    } else {
      filtered.push({ kind: "review", text: "The recorded review evidence is available.", commands: [], artifact: "review", status: "ok" });
    }
  }
  const pipelinePhase = context?.artifacts.find((item) => item.kind === "phase");
  const pipelineFinished = context?.scenario === "pipeline" && context.runLive === false && pipelinePhase?.state === "available" && /^(done|completed|succeeded)$/i.test(pipelinePhase.detail?.status ?? "");
  const requirement = context?.artifacts.find((item) => item.kind === "requirement");
  const requirementRecorded = requirement?.kind === "requirement" && (
    requirement.detail?.lifecycle === "recorded" || (
      requirement.detail?.lifecycle === "none" && requirement.detail.confidence === "finalized"
    )
  );
  // These fields are populated from the same `work_completed` record by the
  // server resolver. A merely terminal task can have neither, so it cannot
  // fabricate a completed delivery card.
  const iterateFinished = context?.scenario === "iterate" && context.runLive === false && (
    requirementRecorded || context.tests !== null
  );
  const finished = iterateFinished || pipelineFinished;
  if (finished) {
    const link: ArtifactKind = pipelineFinished ? "phase" : "commit";
    const commit = context?.artifacts.find((item) => item.kind === "commit") as CommitArtifact | undefined;
    const text = !pipelineFinished && commit?.detail?.message
      ? `Merged as "${commit.detail.message}".`
      : "This completed run is recorded through durable artifacts.";
    filtered.push({ kind: "delivery", text, commands: [], artifact: link });
  }
  // A blocker still open at this point (its `kind` never flipped back — see
  // `resolveToolResults`' recovery branch) tells the reader WHAT failed via
  // its headline + raw output, but not whether it needs THEM specifically —
  // reported as "Blocker sind immer noch rot ohne info ... ob es seine
  // Interaktion braucht" (iterate-2026-09-20-mission-feed-transcript-
  // fidelity). `context.runLive` is the one honest signal available here
  // (no LLM call, MissionContext stays the sole verdict source): while the
  // run is still live, Claude may yet retry or is waiting on the terminal;
  // once it has ended with the blocker never recovering, nothing further is
  // coming on its own. A `null` context (transient initial load, same state
  // referenced by the gate-verdict guard above) gets its OWN conservative
  // wording rather than no explanation at all (external review catch,
  // medium: skipping it entirely reproduced the exact uninformative red
  // blocker the run was fixing, just windowed to the load gap) — never
  // claims live-vs-ended either way, since that isn't known yet.
  for (const card of filtered) {
    if (card.kind !== "blocker") continue;
    card.explanation = context == null
      ? "Run status is still loading — check the terminal for next steps."
      : context.runLive
        ? "Claude may retry this automatically, or may be waiting for you to respond in the terminal."
        : "This run ended before the blocker was resolved — resume the task or check the terminal to continue.";
  }
  // A `review`-bucket card whose dispatch turn produced no narration of its
  // own AND no artifact reconcile above supplied one is dropped the same
  // way as the implement/investigate/spec filter earlier — but ONLY here,
  // after the review-artifact reconcile block has had its chance to
  // rewrite the card's `text` (code-review catch, medium): `reviewerDisplayName`
  // only synthesizes narration for a `Task` spawn, so a review invoked via
  // a shell command (`uv run review.py`, `gh pr review`, matched by
  // `isReviewInvocation` in `missionActivityFeedClassify.ts`) still reaches
  // this point wordless when no durable review artifact exists yet to
  // rewrite it. `!card.detail` is load-bearing here, unlike the earlier
  // filter: `resolveToolResults`' review branch attaches the tool_result's
  // own verdict text to `card.detail`, which IS real content a reader can
  // use even with no headline.
  filtered = filtered.filter((card) => !(
    card.kind === "review" && !card.text && !card.explanation && !card.detail
  ));
  const outcome = finished ? "Completed run" : context?.runLive ? "In progress" : "Waiting for reliable evidence";
  return { outcome, cards: filtered };
}
