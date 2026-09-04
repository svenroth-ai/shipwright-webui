/**
 * Post-event-loop reconciliation for `missionActivityFeed.ts`'s reducer:
 * folding MissionContext's own artifact/test-gate evidence onto the cards
 * already built from the transcript, plus the final `outcome` computation.
 * Split out once the reducer crossed the project's 300-line convention
 * (iterate-2026-08-22-mission-feed-fixes) — a distinct concern from the
 * event-driven card-building loop above it: this half reads `context`, the
 * loop above never does except to gate whether an artifact chip is shown.
 */
import type { ActivityCard, ActivityFeed } from "./missionActivityFeed";
import type { ArtifactKind, CommitArtifact, MissionContext } from "./missionContextApi";

function artifact(context: MissionContext | null, kind: ArtifactKind): boolean {
  return context?.artifacts.some((item) => item.kind === kind && item.state === "available") ?? false;
}

export function reconcileArtifactCards(
  cards: ActivityCard[],
  context: MissionContext | null,
  testCards: ActivityCard[],
  unresolvedTest: ActivityCard | null,
): ActivityFeed {
  if (cards.some((card) => card.kind === "test") || artifact(context, "tests")) {
    const gate = context?.tests?.gate;
    const status: ActivityCard["status"] = gate === "pass" ? "ok" : gate === "fail" ? "err" : "warn";
    const latest = testCards.at(-1);
    // An earlier test still genuinely open must never be silently hidden
    // behind a later completed/recovered one (pre-existing) — surfaced via
    // `latest`'s text below even when `latest` itself already settled.
    const pendingTest = testCards.some((card) => /awaiting a result/i.test(card.text));
    if (!latest) {
      const text = gate === "pass" ? "Tests have a recorded passing result."
        : gate === "fail" ? "Tests have a recorded failing result." : "No reliable test result is recorded.";
      cards.push({ kind: "test", text, commands: [], artifact: artifact(context, "tests") ? "tests" : undefined, status });
    } else if (pendingTest) {
      latest.text = "The latest test attempt needs attention.";
      // A real "fail" gate still escalates the pill (code review catch: a
      // hardcoded "warn" could under-claim a genuine failure), but "pass"
      // cannot claim "ok" here (doubt-review catch, high): something in
      // this run is still unresolved, so a green pill next to "needs
      // attention" text would be self-contradictory.
      latest.status = gate === "fail" ? "err" : "warn";
    } else {
      // The status PILL follows `gate` unconditionally — even when the
      // transcript's own retry-tracking left the last observed attempt
      // unresolved (`unresolvedTest`), the pill must never contradict the
      // recorded gate (external review catch: a stale local "err" from an
      // unretried failure was surviving past a `gate: "pass"` reconcile).
      // The prose TEXT stays conservative under that same guard — it is
      // local-transcript colour commentary, not the verdict itself, and
      // "needs attention" text next to a real recorded pass is deliberate:
      // this transcript never proved the recovery it would be claiming.
      latest.status = status;
      if (!unresolvedTest) {
        if (gate === "pass" && latest.text === "This test command completed.") latest.text = "Tests have a recorded passing result.";
        if (gate === "fail") latest.text = "Tests have a recorded failing result.";
        if (gate === "unknown") latest.text = "No reliable test result is recorded.";
      } else if (status === "ok") {
        // The gate overrode an unretried local failure back to ok (this
        // attempt was never locally proven to recover — code review catch,
        // high) — the stale FAIL excerpt must not keep rendering under a
        // pill that now says "Passing". An "unknown" gate leaves the pill at
        // "warn" and INTENTIONALLY keeps the detail: the local failure is
        // still the best evidence available, not contradicted by anything.
        latest.detail = undefined;
      }
    }
  }
  for (const kind of ["spec", "requirement", "decisions"] as const) {
    // The server already writes a rich, always-populated `summary` for every
    // `state: "available"` artifact (`server/src/core/mission-context/
    // artifacts.ts`) — prefer it over the generic placeholder text, which
    // was rendering unconditionally regardless of what actually happened
    // (iterate-2026-09-05-mission-feed-ux-gaps: "Requirement evidence is
    // available. ist irgendwie leer immer am Ende der Kette"). The fallback
    // stays for the rare artifact shape with no `summary` field at all
    // (`CommitArtifact`, `TestsArtifact`, `ReviewArtifact` — not reachable
    // through this loop's three kinds, but kept as a defensive floor).
    const item = context?.artifacts.find((entry) => entry.kind === kind && entry.state === "available");
    if (item && !cards.some((card) => card.artifact === kind)) {
      const fallback = kind === "spec" ? "Specification evidence is available."
        : kind === "requirement" ? "Requirement evidence is available." : "A recorded decision is available.";
      cards.push({ kind: "spec", text: item.summary ?? fallback, commands: [], artifact: kind, status: "ok" });
    }
  }
  if (artifact(context, "review")) {
    const review = [...cards].reverse().find((card) => card.kind === "review");
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
      cards.push({ kind: "review", text: "The recorded review evidence is available.", commands: [], artifact: "review", status: "ok" });
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
    cards.push({ kind: "delivery", text, commands: [], artifact: link });
  }
  const outcome = finished ? "Completed run" : context?.runLive ? "In progress" : "Waiting for reliable evidence";
  return { outcome, cards };
}
