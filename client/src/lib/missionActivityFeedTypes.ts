import type { ArtifactKind } from "./missionContextApi";
import type { WrittenTestFileTracker } from "./missionActivityFeedAuthoringTrack";

export type ActivityKind = "goal" | "investigate" | "spec" | "implement" | "test" | "review" | "user-input" | "user" | "blocker" | "system" | "delivery" | "subrunner";

export interface ActivityQuestion {
  text: string;
  options: string[];
  /** Separates "genuinely still pending" from "answered" — the unresolved
   * CTA renders only while this is false, independent of whether the
   * answer matched a listed option. */
  resolved: boolean;
  picked?: string;
  answer?: string;
  /** The untruncated counterpart of `answer` — set only when the real
   * content is actually longer than the bounded excerpt shown by default
   * (iterate-2026-09-05-mission-feed-ux-gaps: an answer's own excerpt was
   * silently cropped with no way to read the rest). */
  answerFull?: string;
}

export interface ActivityCard {
  kind: ActivityKind;
  text: string;
  /** The untruncated counterpart of `text` — set only when the turn's real
   * headline text is actually longer than the 280-char display cap (most
   * often a real turn's ENTIRE explanation, since a genuine turn is very
   * often one long paragraph with no internal newline — so there is no
   * separate `explanation` to fall back to). Never set for a static/generic
   * card text (nothing to expand). iterate-2026-09-05-mission-feed-ux-gaps. */
  textFull?: string;
  /** Deduplicated command CHIP labels. Populated ONLY via `attachCommand`
   *  (51st-round catch, glm, low — pinned at the type, as glm asked, rather
   *  than left in prose): a site that pushes here directly, or seeds this
   *  array at card creation, breaks BOTH `commandCount` invariants below. */
  commands: string[];
  /** The TRUE number of tool-call events `attachCommand` has attached to
   *  this card — deliberately separate from `commands.length`, which
   *  deduplicates by label and under-counts when two distinct calls share
   *  one label (e.g. two identical `Read` calls). Drives the collapsed
   *  summary's "N commands" count (24th-round external review catch,
   *  openai, medium). Absent on a card with no tool call behind it at all
   *  (a reconcile-synthesized summary card).
   *
   *  INVARIANT (47th/48th-round catches, glm, low — documented here at glm's
   *  own suggested spot rather than re-guarding the renderer): a set
   *  `commandCount` implies `commands.length >= 1`. `attachCommand` is the
   *  SOLE writer of this field and its very next statement pushes the label;
   *  nothing anywhere removes from `commands`. A hand-built card (only tests
   *  build one) that sets `commandCount` with `commands: []` breaks the
   *  invariant and would render a blocker toggle revealing no chips —
   *  `FeedCommands` stays guarded on `commands.length` on purpose, since
   *  guarding it on `commandCount` would render an EMPTY chip row instead. */
  commandCount?: number;
  /** Untruncated command/detail text for one of `commands`' entries, keyed
   * by that (possibly-truncated) label — populated only when the full text
   * actually differs from the label shown, so a click-to-expand affordance
   * has something real to reveal (iterate-2026-09-05-mission-feed-ux-gaps:
   * a long Bash command could not be inspected past its 180-char preview). */
  commandFullText?: Record<string, string>;
  artifact?: ArtifactKind;
  /** ISO-8601 timestamp of the JSONL event that created this card (its OWN
   * transcript timestamp, never a client-side "now") — absent when the source
   * event carried none (older transcripts predate the field), AND for a card
   * synthesized from MissionContext with no source event at all (e.g. the
   * test/spec/review/delivery cards missionActivityFeedReconcile.ts builds).
   * Set once, at creation; a later event coalescing into the same card does
   * not move it, since the card represents when the activity STARTED
   * (iterate-2026-08-31-mission-feed-gaps). */
  timestamp?: string;
  /** Bounded, sanitized raw-output excerpt — real transcript content, never
   * a gate verdict (MissionContext stays the sole verdict source). */
  detail?: string;
  /** Bounded excerpt of prose beyond the first line already shown in `text`
   * (iterate-2026-08-25-mission-feed-progress-narration). Assistant-authored
   * prose, rendered as plain text — NEVER conflate with `detail`, which is
   * raw tool/test output from a different source and rendered as a literal
   * `<pre>` block. NOT necessarily this card's own tool-calling turn's
   * words: a real session almost never combines narration and a tool call
   * in one JSONL event, so this is sourced from that turn's own text when
   * it wrote any, otherwise the most recent preceding pure-narration turn's
   * — surviving a bounded run of intervening test/user-input-only turns,
   * not just the single immediately preceding one
   * (iterate-2026-08-27-mission-feed-narration-scroll). Either way it is
   * exactly ONE turn's words, never a blend of two — set only when exactly
   * one assistant turn contributed to this card (see `cardTurnCounts` in
   * `missionActivityFeed.ts`); never an empty string. */
  explanation?: string;
  /** The untruncated counterpart of `explanation` — same "set only when
   * real truncation happened" contract as `textFull`
   * (iterate-2026-09-05-mission-feed-ux-gaps). */
  explanationFull?: string;
  /** Pill state, always derived from MissionContext — never string-matched
   * from `text`. */
  status?: "ok" | "err" | "warn";
  /** The untruncated counterpart of `detail` — same contract as `textFull`
   * (iterate-2026-09-05-mission-feed-ux-gaps). */
  detailFull?: string;
  question?: ActivityQuestion;
  /** True when a `test`-kind card is the immediate TDD "run the single test
   * file I just wrote" moment (this invocation's own single target path
   * matches the most recently `Write`/`Edit`-ed test file) rather than a
   * broader suite/directory verification run. Reconciliation
   * (`missionActivityFeedReconcile.ts`) skips such a card when choosing
   * which test card receives the run-wide gate's pass/fail pill, so
   * authoring a new test never looks like an official verification result
   * (iterate-2026-09-16-mission-feed-render-fidelity). Never set on a
   * non-`test` card. */
  authoringRun?: boolean;
  /** True when `text` is a SYNTHESIZED sentence embedding raw, verbatim
   * excerpted content (currently: a blocker's derived "A command failed:
   * …" headline) rather than a turn's own markdown-authored prose — the
   * renderer shows it as a literal text node instead of through
   * `MarkdownChunk`, so markdown-significant characters in the raw excerpt
   * can't be reinterpreted as emphasis/code and garble the plain-language
   * explanation (18th-round external review catch, glm, medium: gating on
   * `kind === "blocker"` alone was an implicit invariant an unrelated
   * future change could silently violate — this flag makes "this text is
   * synthesized" an explicit, set-at-the-mutation-site fact instead).
   * Never set on a non-`blocker` card today; cleared when a blocker
   * recovers back to its original kind. */
  textLiteral?: boolean;
  /** Set only on a `kind: "subrunner"` card — PROVISIONALLY the dispatching
   * tool_use's own id until `applySubrunnerAck` overwrites it with the
   * dispatch's real, stable agent id (parsed from its ack tool_result); this
   * is the value a later `task-notification` event's `taskId` is correlated
   * against (iterate-2026-09-26-mission-tab-subrunner — see
   * `missionActivityFeedSubrunner.ts`'s doc comment for why the dispatch's
   * own id alone isn't stable enough across a `SendMessage` continuation). */
  subrunnerId?: string;
  /** Set only on a `kind: "subrunner"` card. `"running"` from dispatch until
   * a matching `task-notification` event resolves it — `"done"` for a clean
   * completion, `"failed"` for a notification whose own `<status>` says so
   * (external-review finding: a terminal/failed state is needed, not just
   * running/done). A `SendMessage`-continued agent can notify MORE than
   * once for the same `subrunnerId` (a partial "stopped at its turn limit"
   * notification, then a later final one) — each arrival overwrites the
   * previous status/report, last one wins. */
  subrunnerStatus?: "running" | "done" | "failed";
  /** The delegated subagent's own final report, once resolved — same bounded
   * excerpt / untruncated-counterpart contract as every other `xFull` field. */
  subrunnerReport?: string;
  subrunnerReportFull?: string;
}

export interface ActivityFeed {
  outcome: string;
  cards: ActivityCard[];
}

/** A tool_use id awaiting its matching `tool_result` — set when the card is
 *  created (deriveActivityFeed), consumed in `missionActivityFeedResolve.ts`
 *  once the result arrives. Moved here from that file (18th-round bloat-
 *  ceiling split) so `missionActivityFeedAuthoringRollback.ts` can share the
 *  type without a circular import between the two. */
export interface PendingTool {
  bucket: ActivityKind;
  card: ActivityCard;
  commandKey: string;
  label: string;
  /** The untruncated counterpart of `label` — carried alongside it so a
   *  recovered/retried command re-attached here can still populate
   *  `commandFullText` via `attachCommand()` (iterate-2026-09-05-mission-
   *  feed-ux-gaps). */
  full: string;
  background: boolean;
  /** Set when this tool_use is a `Write` targeting a test-file path — its
   *  optimistic `writtenTestFiles` tracker entry (added at tool_use time,
   *  before this result is known) must be rolled back if the write itself
   *  turns out to have failed (11th-round external review catch, openai,
   *  medium, confirmed independently by two reviewers across rounds 7 and
   *  11: a FAILED write still left the path tracked, so a later genuine test
   *  run that happened to name the same path was wrongly excluded from the
   *  run-wide gate stamp — the file was never actually "just written").
   *  Write-only, NOT also `Edit` (28th-round external review catch, openai,
   *  medium): `trackWrittenTestFile` stopped tracking Edit at all (27th-
   *  round fix), so computing this for a failed Edit restored an entry the
   *  Edit itself never touched — duplicating the still-present original. */
  writtenTestFile?: string;
  /** The entry `writtenTestFile`'s path already had tracked, if any, right
   *  BEFORE this tool's own optimistic add replaced it — restored (not just
   *  deleted) on rollback (14th-round catch: a failed EDIT to an already-
   *  successfully-WRITTEN test file used to roll back by PATH, destroying
   *  the earlier write's own entry too — still relevant now Write-only,
   *  since a same-path Write can still follow an earlier tracked Write).
   *  Also the fallback source of truth when THIS tool's own run got consumed
   *  by a same-turn test card before this result was known (17th-round catch
   *  — see `missionActivityFeedAuthoringRollback.ts`). `staleness` is stored
   *  as `+1` from capture time (the one aging tick this tool's own
   *  `trackWrittenTestFile` call applies to every OTHER entry) and topped up
   *  at restore via `writtenTestFileRestoreAt`. */
  writtenTestFileRestore?: WrittenTestFileTracker;
  /** `toolCallIndex` when `writtenTestFileRestore` was captured. 65th-round
   *  catch (openai, medium), FIXED: tool_results are processed only after ALL
   *  tool_uses of their assistant event, so every call BATCHED after this
   *  Write ages the live tracker while the frozen snapshot kept its capture-
   *  time value — the doc here used to call that exact "unless another Write
   *  lands between" and it is in fact ANY tool call. The rollback now ages the
   *  restored entry by the elapsed call count and drops it past the cap. */
  writtenTestFileRestoreAt?: number;
}

/** The mutable per-run state `resolveToolResults` reads and updates. Threaded
 *  in (never module-level) — `deriveActivityFeed` owns it for the lifetime of
 *  one derivation and nothing here survives past that call. */
export interface ResolveState {
  cards: ActivityCard[];
  testCards: ActivityCard[];
  pendingTools: Map<string, PendingTool>;
  unresolvedBlockers: Map<string, { card: ActivityCard; bucket: ActivityKind }>;
  unresolvedTest: ActivityCard | null;
  /** Test cards genuinely still awaiting ANY result — a card leaves this set
   *  the moment it gets a real (non-background-ack) outcome, whether that
   *  outcome is failure, success, or a recovery merge. `deriveActivityFeed`
   *  adds every test card here at creation; `reconcileArtifactCards` reads
   *  it to tell "no result yet" apart from "resolved, then recovered" —
   *  both leave `card.status === undefined`, so this can no longer be told
   *  from `card.text` now that resolution never rewrites it
   *  (iterate-2026-09-05-mission-feed-ux-gaps removed every invented test
   *  sentence, including the "…it is awaiting a result." this check used to
   *  regex-match). */
  awaitingTestResult: Set<ActivityCard>;
  /** The reducer's own "recently written/edited test files" tracker —
   *  threaded through (not module state) so a failed `Write`/`Edit`'s
   *  optimistic entry can be rolled back here, the only place its own
   *  tool_result is observed. Reassigned, never mutated in place, same
   *  immutable-array contract as `trackWrittenTestFile` itself; the caller
   *  reads `state.writtenTestFiles` back after this function returns. */
  writtenTestFiles: readonly WrittenTestFileTracker[];
  /** Which test CARD (if any) a Write/Edit's tracker entry was consumed
   *  into, keyed by that Write/Edit's own tool_use id — see
   *  `WrittenTestFileTracker.sourceToolId`'s doc comment. Read-only in
   *  `resolveToolResults` (mutated by `deriveActivityFeed`'s own reducer
   *  loop) — only consulted to un-stamp a card on rollback. */
  authoringConsumedBy: Map<string, ActivityCard>;
  /** Every Write/Edit tool_use id whose own result has already come back as
   *  an error — lets a rollback tell "the earlier write this one's restore
   *  points at already failed too" apart from "not yet known" (23rd-round
   *  external review catch, openai, medium: `writtenTestFileRestore` alone
   *  only proves an earlier write WAS optimistically tracked, never that it
   *  actually succeeded). See `missionActivityFeedAuthoringRollback.ts`. */
  failedWriteToolIds: Set<string>;
  /** A consumed card whose `authoringRun` was preserved on the (still
   *  unconfirmed) assumption that an earlier same-path write succeeded,
   *  keyed by that earlier write's own tool_use id — if THAT write's result
   *  later also comes back as an error (either order relative to the
   *  write that set this), the preservation must be retroactively undone. */
  restoreValidationPending: Map<string, ActivityCard>;
  /** Every `test`-kind card whose OWN `tool_result` has already come back as
   *  an error — the reliable "this card's own run genuinely failed" signal a
   *  retroactive un-stamp needs (27th-round external review catch, openai,
   *  medium: checking `card.detail`'s truthiness instead missed a failure
   *  whose bounded excerpt happened to be empty/whitespace-only, silently
   *  leaving that card neither stamped `err` nor its recovery slot opened).
   *  See `missionActivityFeedAuthoringRollback.ts`. */
  failedTestCards: Set<ActivityCard>;
  /** How many tool calls the derivation has processed so far — the clock
   *  `PendingTool.writtenTestFileRestoreAt` is read against. Read-only here. */
  toolCallIndex: number;
}
