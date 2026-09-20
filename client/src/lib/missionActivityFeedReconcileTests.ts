/**
 * The test-gate reconciliation half of `missionActivityFeedReconcile.ts`'s
 * `reconcileArtifactCards` — folding MissionContext's own recorded test gate
 * onto the transcript's own test card(s), or synthesizing a summary card
 * when none exists. Split out once that file re-crossed the project's
 * 300-line convention (iterate-2026-09-20-mission-feed-transcript-fidelity)
 * — a self-contained concern (the ONLY part of reconciliation that reads
 * `testCards`/`unresolvedTest`/`awaitingTestResult`), pure mutation of
 * `cards` in place, no behavior change from the verbatim extraction. */
import type { ArtifactKind, MissionContext } from "./missionContextApi";
import type { ActivityCard } from "./missionActivityFeedTypes";

/** Shared with `missionActivityFeedReconcile.ts` (code-review catch, same
 *  run: the split had introduced a third copy of this trivial predicate,
 *  already duplicated once against `missionActivityFeedTurn.ts`'s own —
 *  exported from here, the callee, so `Reconcile.ts` -> `ReconcileTests.ts`
 *  stays a one-directional import rather than a cycle). */
export function artifact(context: MissionContext | null, kind: ArtifactKind): boolean {
  return context?.artifacts.some((item) => item.kind === kind && item.state === "available") ?? false;
}

export function reconcileTestGate(
  cards: ActivityCard[],
  context: MissionContext | null,
  testCards: ActivityCard[],
  unresolvedTest: ActivityCard | null,
  awaitingTestResult: Set<ActivityCard>,
): void {
  // 30th-round external review catch (glm, low, declined): a completed run
  // whose recorded `context.tests?.gate` is genuinely "pass"/"fail" cannot
  // reach this guard with BOTH disjuncts false. `context.tests` and the
  // `tests` artifact's own `results` are the SAME `toMissionTests(run.tests,
  // run.ts)` call over the SAME `work_completed` record (server
  // `resolver-iterate.ts` + `artifacts-tests.ts buildTestsArtifact`) — a
  // non-null `context.tests` (the only way `gate` is ever "pass"/"fail"
  // rather than absent/"unknown") means `results` is non-null there too,
  // which unconditionally yields `state: "available"` (the `!results &&
  // !hasFiles` early-return is the only path to anything else, and it
  // cannot fire). Verified by tracing both call sites, not merely assumed —
  // this iterate makes no server-side artifact-resolution changes (spec's
  // own out-of-scope note), and the pairing predates it.
  if (!(cards.some((card) => card.kind === "test") || artifact(context, "tests"))) return;
  const gate = context?.tests?.gate;
  const status: ActivityCard["status"] = gate === "pass" ? "ok" : gate === "fail" ? "err" : "warn";
  // The run-wide gate belongs on the last GENUINE verification card, never
  // on a TDD authoring run (reported: the newly-authored test's own first
  // run inherited the whole run's pass/fail pill, looking like an official
  // result it never was, iterate-2026-09-16-mission-feed-render-fidelity).
  // Does NOT fall back to an authoring card when no verification card
  // exists yet — an earlier draft did, and two independent external
  // reviewers caught that it reintroduces the exact misleading stamp in
  // the single most common real trigger: a freshly-written test fails and
  // the run ends there (no later genuine run to supersede it).
  const verificationCards = testCards.filter((card) => !card.authoringRun);
  const latest = verificationCards.at(-1);
  // An earlier test still genuinely open must never be silently hidden
  // behind a later completed/recovered one (pre-existing) — surfaced via
  // `latest`'s text below even when `latest` itself already settled.
  // Structural check, not a text regex (iterate-2026-09-05-mission-feed-
  // ux-gaps): both a genuinely never-resolved card and a resolved-then-
  // recovered one now share `status === undefined` and no distinguishing
  // text, since resolution no longer overwrites `card.text` at all.
  // Read only by the `else if (pendingTest)` branch below — the `!latest`
  // synthesis branch never consults it (28th-round external review catch,
  // glm, medium, declined: this if/else-if/else chain is mutually
  // exclusive, so a still-in-flight authoring card can never make the
  // synthesized summary card show anything but the recorded gate).
  const pendingTest = testCards.some((card) => awaitingTestResult.has(card));
  if (!latest) {
    // No genuine verification card exists — either no test card at all,
    // or every one that exists is an authoring run. Either way, synthesize
    // a SEPARATE summary card from the recorded gate so the run's own
    // verdict is never silently invisible (8th-round external review
    // catch, glm, medium — with the completed-run header/verdict banner
    // removed per item 1, a recorded FAILING gate whose only transcript
    // activity was a failing authoring run used to show NO signal
    // anywhere in the feed). This never touches the authoring card(s)
    // themselves — they keep their own unstamped `status` exactly as
    // `resolveToolResults` left it, deliberately, per item 5.
    // 55th-round catch (glm, medium), FIXED: while the run is STILL LIVE and
    // the gate has recorded nothing yet, there is nothing to make visible —
    // synthesizing "No reliable test result is recorded." mid-run reads as a
    // verdict on a run that has not finished. The 8th-round purpose this
    // branch exists for is a RECORDED pass/fail that would otherwise be
    // invisible, so it is unaffected: both of those still synthesize while
    // live, and an unknown gate still synthesizes once the run is terminal.
    // 56th-round catch (glm, low): the skipped card is also the only carrier
    // of the `tests` artifact chip, so a mid-run authoring-only feed loses
    // that chip until the run settles - glm calls this acceptable as shipped
    // (the left rail's `record-node-tests` still reaches the artifact) and
    // names the remediation if it is ever reported: attach the link to the
    // pending authoring card WITHOUT stamping its pill.
    // 61st-round catch (glm, low): with `context == null` this read as
    // terminal and synthesized anyway. ACCEPTED then as literally true and
    // pre-existing; REVERSED by the 65th (glm, low), which supplies the
    // argument round 61 lacked - `null` is also the TRANSIENT initial-load
    // state (`MissionBody.tsx` derives it from `useMissionContext`'s data
    // and renders the feed without waiting), and requirement 1 removed the
    // completed-run header, so this card is now the run's ONLY gate signal.
    // A run whose context has not arrived yet would flash a "warn" verdict.
    // The branch exists to keep a RECORDED gate visible; with no context
    // there is no recorded gate to keep visible, so it synthesizes nothing.
    // A LOADED context with an unknown gate still synthesizes, unchanged.
    // 79th + 83rd (glm, low, "no action needed now"): the residual visible
    // gap — a PERMANENTLY failing context fetch shows no gate verdict at all
    // — and the same remediation if reported (thread the runDetail gate into
    // the feed's empty state). Unchanged: a transient null is the common case
    // and a wrong verdict is worse than a late one.
    if (gate === "pass" || gate === "fail" || (context != null && !context.runLive)) {
      const text = gate === "pass" ? "Tests have a recorded passing result."
        : gate === "fail" ? "Tests have a recorded failing result." : "No reliable test result is recorded.";
      cards.push({ kind: "test", text, commands: [], artifact: artifact(context, "tests") ? "tests" : undefined, status });
    }
  } else if (pendingTest) {
    // Same "own words win" rule as the fallback three lines below (spec-
    // reviewer catch, iterate-2026-09-05-mission-feed-ux-gaps): `latest`
    // may itself carry real narration from its own turn even though some
    // OTHER, earlier test card is still unresolved — that narration must
    // not be clobbered by this generic caveat about the run as a whole.
    if (!latest.text) latest.text = "The latest test attempt needs attention.";
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
      // Only fill in when the transcript itself left no words of its own
      // (`latest.text` empty — no more hardcoded sentence to match against,
      // iterate-2026-09-05-mission-feed-ux-gaps): the turn's own narration,
      // when it exists, always wins over this generic fallback.
      if (gate === "pass" && !latest.text) latest.text = "Tests have a recorded passing result.";
      if (gate === "fail" && !latest.text) latest.text = "Tests have a recorded failing result.";
      if (gate === "unknown" && !latest.text) latest.text = "No reliable test result is recorded.";
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
