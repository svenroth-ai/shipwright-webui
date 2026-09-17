/**
 * TDD authoring-run detection - tells a "run the single test file I just
 * wrote" authoring moment apart from a broader suite/directory verification
 * run, so `missionActivityFeed.ts` can exclude it from the run-wide gate
 * stamp (reported: a freshly-authored test's own first run got the same
 * "Passing"/"Failing" treatment as a genuine whole-suite verification,
 * iterate-2026-09-16-mission-feed-render-fidelity). Split out of
 * `missionActivityFeedClassify.ts` at the 300-line convention. */
import { isTestSegment, splitTopLevelSegments, tokenize } from "./missionActivityFeedClassify";
import { IS_ABSOLUTE_PATH, normalizeTestFilePath, sameTestFilePath } from "./missionActivityFeedTestPaths";
export { sameTestFilePath } from "./missionActivityFeedTestPaths";
import type { ShellSegment } from "./missionActivityFeedClassify";

// A test-FILE path shape, JS/TS and Python. `[cm]` covers the ES/CommonJS
// module extensions (39th, openai, medium: `foo.test.mts` kept the stamp).
// 41st (openai, medium, spec), DECLINED — no Go/Rust/Ruby/Java shape belongs
// here: the stamp lands only on a TEST-bucket card, and `isTestSegment`
// (…Classify.ts) takes exactly `npm test`/`npm run test*` plus
// `vitest|playwright|pytest|jest`. Probed: `go test`, `cargo test`, `rspec`,
// `mvn test` are ALL false. Pinned in `…BlockerAndTdd.test.ts`.
const TEST_FILE_PATH = /(^|[\\/])(?:test_[^\\/]+\.py|[^\\/]+_test\.py|[^\\/]+\.(?:test|spec)\.[cm]?[jt]sx?)$/i;
// Jest's OTHER `testMatch` half — `__tests__/`, any depth (42nd, openai).
const TESTS_DIR_PATH = /(^|[\\/])__tests__[\\/](?:[^\\/]+[\\/])*[^\\/]+\.[cm]?[jt]sx?$/i;

/** Does this path look like a test file by NAME shape, regardless of whether
 *  it is invoked as one? Used for a `Write`/`Edit` and for a run's target. */
export function isTestFilePath(path: string): boolean {
  return TEST_FILE_PATH.test(path) || TESTS_DIR_PATH.test(path);
}

// Strips a trailing pytest node-id selector (`::test_name`, chained or not):
// the `$`-anchored regexes miss `test_foo.py::test_bar` otherwise (6th, glm).
function stripNodeIdSelector(token: string): string {
  return token.replace(/(::[^:/\\]+)+$/, "");
}

// Flags whose VALUE names a file to EXCLUDE, never one being run (3rd, glm,
// low); `--exclude` (9th) / `--testPathIgnorePatterns` (10th) are the same.
// A CONFIG/SETUP file is the same hazard (44th, openai, medium): `vitest run
// --setupFiles src/__tests__/setup.ts` is a BROAD run whose option value is a
// test-looking path, so it read as targeted (reachable via the 42nd's
// `__tests__` widening). NOT "positional args only": a BOOLEAN flag precedes a
// genuine target all the time.
const EXCLUSION_FLAGS = new Set(["--deselect", "--ignore", "--ignore-glob", "--exclude", "--testPathIgnorePatterns", "--setupFiles", "--setupFilesAfterEnv", "--globalSetup", "--config", "-c", "--reporter", "--root", "--testMatch", "--coverage.include", "--testNamePattern"]);

// Flags making the WHOLE invocation broad, whatever it names: the run is
// selected by RELATION or VCS state, never "this one file" (58th, openai).
// 69th (openai, medium), FIXED: Jest's twins were missing. `--findRelatedTests
// <file>` is `--related`'s analogue - it runs every test IMPORTING the named
// file, so its value fell through to the scan and was read as the run's own
// target; `--onlyChanged` is `--changed`'s. NOT the short `-o` (a bare two-char
// token collides too easily). Closed enumeration, like EXCLUSION_FLAGS.
const BROAD_RUN_FLAGS = new Set(["--related", "--changed", "--findRelatedTests", "--onlyChanged"]);

// The `--flag=value` spelling (5th, openai, medium: `--deselect=x` is ONE
// token). DERIVED from BOTH sets above so no spelling can drift apart, and
// each name is REGEX-ESCAPED (64th, glm, low): `--coverage.include`'s `.` was
// raw, so `--coverage-include=src/foo.test.ts` matched and split - and the
// split value, preceded by no real EXCLUSION_FLAGS token, became the "target":
// a FALSE exemption, the UNSAFE direction. Escaped, the token stays whole.
const FLAG_EQUALS = new RegExp(`^(${[...EXCLUSION_FLAGS, ...BROAD_RUN_FLAGS].map((flag) => flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})=(.+)$`);
// MAINTENANCE SURFACE (53rd, glm, low): enumerated per runner, so a NEW runner
// means auditing this set. 60th (openai, medium): `--root`, `--testMatch` and
// `--coverage.include` all take a DIRECTORY or GLOB, never the run's own
// target, so they join it. 75th (openai, medium): `--testNamePattern` is the
// same shape - a value-taking SELECTOR taking a test NAME regex, so a
// path-looking pattern was read as the target and wrongly exempted what may be
// a whole-suite run (Jest and Vitest share the spelling; `-t` omitted like
// `-o`). openai's general form - bail on any UNRECOGNIZED value-taking option -
// stays DECLINED: boolean and value-taking flags are indistinguishable without
// a per-runner grammar (`vitest --run x.test.ts`, 44th), so it would swallow
// every targeted run behind a boolean flag, losing the exemption entirely.

/** The single test-file path a test invocation names, when it names EXACTLY
 *  one - quote-aware via the same splitter/tokenizer used for bucket
 *  classification. A broad run (bare `npm test`, a directory) names none, and
 *  so does a MULTI-file run (external review, both reviewers: first-match-wins
 *  read one as authoring whenever its first file was the new one). An
 *  exclusion flag's VALUE is skipped, and a RELATION/VCS mode (`--related`,
 *  `--changed`) makes the whole segment broad (58th, openai). Only a
 *  segment that IS ITSELF a test invocation is scanned (6th-round, openai:
 *  `git diff --check src/foo.test.ts && npm test` read the `git diff` mention
 *  as the target), and MORE THAN ONE test segment is itself a broader run
 *  (7th-round, openai). Two spellings of one file collapse to a single match
 *  (13th-round, glm); a leading `cd <dir>` resolves in (13th, openai). */
export function testInvocationTargetPath(shell: string): string | null {
  const shellSegments = splitTopLevelSegments(shell);
  const allSegments = shellSegments.map((s) => s.text);
  const testSegmentIndex = allSegments.findIndex(isTestSegment);
  if (testSegmentIndex === -1 || allSegments.filter(isTestSegment).length !== 1) return null;
  const cdPrefix = leadingCdPrefix(shellSegments, testSegmentIndex);
  const matches = new Set<string>();
  // Expand a `--flag=value` exclusion token into its separated-token
  // equivalent so the `tokens[i - 1]` check below covers both spellings.
  const tokens = tokenize(allSegments[testSegmentIndex]).flatMap((raw) => {
    const equalsMatch = FLAG_EQUALS.exec(raw);
    return equalsMatch ? [equalsMatch[1], equalsMatch[2]] : [raw];
  });
  // 80th (openai, medium), FIXED - and it FALSIFIES the 68th/76th ACCEPTANCE,
  // which called a quoted target containing a SPACE detection LOSS only.
  // Probed: `vitest run "src/my file.test.ts"` shatters into `"src/my` +
  // `file.test.ts"`, and the strip below turned the TAIL into a clean
  // `file.test.ts` - suffix-matching a freshly written `/repo/src/file.test.ts`,
  // a DIFFERENT file, so a real verification run lost its gate stamp. HARMFUL,
  // not safe. An unbalanced quote is that shatter's mechanical signature, so a
  // token carrying one is never READ AS A TARGET; with the shard dropped the
  // `size === 1` rule bails the invocation on its own. 81st (glm, low),
  // NARROWED from a segment-wide bail to a per-token one - the wider form also
  // fired on an apostrophe inside a quoted FILTER, for free.
  // 58th-round catch (openai, medium), FIXED: a RELATION mode makes the run
  // broad - `vitest --related x` runs every test that imports `x`, not `x`
  // itself - so its value is never one freshly-written test's own run. The doc
  // above said `--related` was "deliberately unhandled", but unhandled meant
  // the value fell through to the scan below and WAS read as the target.
  if (tokens.some((raw) => BROAD_RUN_FLAGS.has(raw))) return null;
  tokens.forEach((rawToken, i) => {
    if (i > 0 && EXCLUSION_FLAGS.has(tokens[i - 1])) return;
    if (isShatteredQuoteShard(rawToken)) return;
    let token = stripNodeIdSelector(rawToken.replace(/^["']|["']$/g, ""));
    if (!isTestFilePath(token)) return;
    if (cdPrefix && !IS_ABSOLUTE_PATH.test(token)) token = `${cdPrefix}/${token}`;
    matches.add(normalizeTestFilePath(token));
  });
  return matches.size === 1 ? [...matches][0] : null;
}

// Does this chain-separator run keep the SAME shell (so an earlier `cd` still
// governs what follows)? Exactly `&&` and a single `;` qualify (as does `null`,
// the first segment); everything else forks, backgrounds or skips. `;;` is
// EXCLUDED (36th, glm, low): a `case`-body terminator, a syntax error outside
// `case`. 42nd (glm, low), DECLINED as unreachable: an EMPTY segment (leading
// `&& vitest run x`) is dropped so its operator lands on the next segment —
// both shapes are shell SYNTAX ERRORS, and the leading-`&&` outcome is right
// regardless: the test segment becomes index 0, so the prefix is `""`.
function isSameShellSequencing(op: string | null | undefined): boolean {
  return op == null || op === "&&" || op === ";";
}

const countOf = (text: string, char: string) => text.split(char).length - 1;

// Is this token HALF of a quoted argument the whitespace tokenizer tore apart?
// The scan's strip removes one LEADING or TRAILING quote, so that is the only
// position from which a shard is laundered into a clean-looking path; an odd
// count there means the partner quote is in another token. 82nd (glm, low): the
// round-81 spelling tested the count ALONE, dropping an ordinary apostrophe
// INSIDE a filename (`it's.test.ts`) that never met the stripper at all.
function isShatteredQuoteShard(token: string): boolean {
  return [...`"'`].some((q) => countOf(token, q) % 2 === 1 && (token.startsWith(q) || token.endsWith(q)));
}

// A `cd` arg unresolvable lexically: a flag, tilde or expansion (37th, glm).
const UNRESOLVABLE_CD_ARG = /^[-~$]/;

// The relative directory leading `cd <dir>` segments (chained via `&&`/`;`)
// would leave the test command running from — `""` when there is none, and
// `""` rather than a guess on an unresolvable target.
function leadingCdPrefix(segments: readonly ShellSegment[], testSegmentIndex: number): string {
  const parts: string[] = [];
  // Walks BACKWARD, accumulating each `cd` and skipping non-`cd` segments
  // (22nd-round, openai, medium - corrects a 16th-round premise that only a
  // CONTIGUOUS chain counts): `cd a && npm run build; cd client && vitest ...`
  // = `a/client`, `cd` persisting for the rest of the sequence.
  for (let i = testSegmentIndex - 1; i >= 0; i--) {
    // EVERY operator between here and the test segment must be same-shell -
    // checked on each step of the walk, not only on the one adjacent to a `cd`
    // (35th-round catch, glm, low; openai raised its `||` half as medium).
    // Once an operator forks, no `cd` at or before `i` reaches the test
    // command: in `cd client && npm run build & vitest run x.test.ts` the `&`
    // BACKGROUNDS the whole `&&` chain, so `vitest` runs in the parent from
    // its original cwd — yet the adjacent-only check saw just the `&&`. Wrong
    // even on full success, which separates it from the case declined below.
    // Which operators qualify is an ALLOW-list, not a bail-list (34th-round
    // catch, glm, low): the raw run can be any mash of `&|;`, and a deny-list
    // let `&|`/`;&` through. The rejected shapes fail for three reasons: `||`
    // (30th/32nd) runs what follows ONLY IF the `cd` FAILED; `|` (33rd) runs
    // each stage in its OWN SUBSHELL; `&` BACKGROUNDS the `cd`.
    if (!isSameShellSequencing(segments[i + 1]?.precedingOperator)) return "";
    const [a, rawB, extra] = tokenize(segments[i].text);
    if (a !== "cd") continue;
    // 67th-round catch (glm, low), FIXED: `tokenize` is a whitespace split and
    // strips no quotes, while the TARGET scan above does
    // (`rawToken.replace(/^["']|["']$/g, "")`). `cd "client" && vitest run
    // src/foo.test.ts` therefore built the prefix `"client"` and produced
    // `"client"/src/foo.test.ts`, which no absolute `Write` path can suffix-
    // match — a silent detection LOSS, the same failure mode as the 37th
    // round's tilde. Stripped BEFORE the bails below so `cd "~/x"` still hits
    // the unresolvable-arg guard. A quoted arg containing a SPACE still bails
    // via `extra`: whitespace splitting cannot reassemble it.
    const b = rawB?.replace(/^["']|["']$/g, "");
    // 37th-round catch (glm, low): `~`/`~/client`/`$HOME` are expanded by the
    // SHELL, not lexically, so carrying them in produced
    // `~/client/src/foo.test.ts` — which no absolute `Write` path can ever
    // suffix-match, a silent detection LOSS. Bail like the absolute case. A
    // SECOND `cd` argument (`cd a b`) bails too: real `cd` ERRORS on it, so
    // the directory never changes. glm's paired claim that `cd -- client`
    // yields the prefix "--" is FALSIFIED — `--` hits the leading-`-` bail and
    // returns ""; resolving it instead is the riskier direction.
    if (!b || extra || IS_ABSOLUTE_PATH.test(b) || UNRESOLVABLE_CD_ARG.test(b)) return "";
    parts.unshift(b);
  }
  return parts.join("/");
}

// 35th-round catch (openai, medium), DECLINED - a DIFFERENT property from what
// the loop enforces. openai asks that `cd client && true; vitest ...` bail: if
// `cd client` FAILED, `&&` skips and `;` still runs from the original cwd. True
// as shell semantics, but (1) it contradicts this module's standing model,
// fixed in round 22, re-pinned in 33 — a step is assumed SUCCEEDED unless an
// operator is POSITIVE evidence otherwise (`||` is, `;` is not); (2) it flags
// `cd X && ...; test` but not `cd X; test`; and (3) the only consistent rule,
// an unbroken `&&` chain, would reverse rounds 22 and 33.

// Path normalization + the absolute/relative bridge live in their own module
// (60th-round bloat-ceiling split, matching the `…SamePath.test.ts` companion
// that already covered them); `IS_ABSOLUTE_PATH` is re-exported from there.

/** How many further tool calls a tracked "just-written test file" survives
 *  before going stale - mirrors `pendingNarration`'s cap (all three reviewers:
 *  unbounded, a file written at the start of a long stretch still read as
 *  "immediate"). Fits write/edit/run. */
export const MAX_AUTHORING_TRACK_CARRY = 6;
// 39th-round catch (openai, medium), DECLINED — it asks to shrink this window
// to "the immediate TDD sequence" (clear on unrelated tool categories). The
// cap EXISTS to bound that false positive, and 6 fits the canonical shape.
// Clearing on an "unrelated tool category" would break it: a `Read` between
// writing and running a test is the most ordinary TDD move there is.
// RE-RAISED VERBATIM ~30 further times across later rounds (one bare approve
// among them, so the re-raise pattern is nondeterministic, not new evidence)
// and declined identically each time; boundary tests for both sides of the
// window now ship in `missionActivityFeedAuthoringWindow.test.ts`.
// 62nd round asked additionally to "consume the tracked file" — that is what
// already happens, and it FALSIFIES the finding's own stated harm ("can
// suppress a LATER, genuine targeted verification run"). `missionActivityFeed.
// ts` deletes the matched entry the moment a run consumes it
// (`writtenTestFiles.filter((_, i) => i !== matchIndex)`), so the exemption is
// ONE-SHOT per Write: the second run of that same file inside the window is
// already stamped normally. Only the file's OWN FIRST run is exempt — exactly
// the specified scope. Pinned by the "consumes" arm in
// `missionActivityFeedAuthoringWindow.test.ts`. 63rd round repeats the SAME
// harm claim ("a later targeted verification loses its Passing/Failing
// treatment") that arm empirically falsifies, and newly asks to REVERSE the
// intervening-`Read` test. Declined: that test is not an oversight to correct
// but the pinned contract this knob decides, and rewriting a passing guard to
// match a rejected proposal is how a decision gets lost. 64th re-raises both
// plus the round-53 "narration-only turns never age it" sub-claim, already
// ANSWERED there and recorded in that test file's header: aging is per TOOL
// CALL by design, because prose is not work that staleness should count.

export interface WrittenTestFileTracker {
  readonly path: string;
  readonly staleness: number;
  /** The `Write` tool_use id that added/last-refreshed this entry - lets the
   *  reducer un-stamp the card that consumed it if that Write's own result
   *  later turns out to be an error (16th-round catch, openai, medium: all
   *  tool_use processing for a turn precedes any of its tool_results, so a
   *  FAILED write left a genuine verification run wrongly exempt). */
  readonly sourceToolId: string;
}

// How many distinct just-written test files stay tracked at once - a real TDD
// burst writes a handful before running any (4th, openai, medium: tracking
// only the most recent dropped `a.test.ts` when `b.test.ts` followed).
// 73rd (openai, low), FIXED: at 5 this cap could evict an entry that the
// STALENESS window still considered fresh - six consecutive Writes dropped the
// first one, so its own first run was stamped as official verification, the
// exact false NEGATIVE the exemption exists to prevent. The two bounds were
// simply inconsistent. Tied to `MAX_AUTHORING_TRACK_CARRY` so they cannot
// drift again: an entry ages out after that many further tool calls, so at
// most that many can ever be alive, and the staleness window is now the SOLE
// bound. This is not a relaxation - nothing survives longer than before.
const MAX_TRACKED_TEST_FILES = MAX_AUTHORING_TRACK_CARRY;

/** The updated set of "recently written test files" for one tool call - a
 *  `Write` targeting a test file adds/refreshes that path at staleness 0
 *  (moved to the front if already tracked, so it doesn't count twice against
 *  `MAX_TRACKED_TEST_FILES`); every entry ages by one otherwise, and is
 *  dropped once it exceeds `MAX_AUTHORING_TRACK_CARRY`. `Edit` alone does NOT
 *  create/refresh an entry (27th-round catch, openai, medium): the exemption
 *  is "the freshly-WRITTEN test file's OWN first run", and an Edit to a
 *  pre-existing test file is ordinary verification. Pure. Call once per tool
 *  AFTER checking whether that call already consumed a matching entry. */
export function trackWrittenTestFile(
  current: readonly WrittenTestFileTracker[],
  toolName: string,
  input: Record<string, unknown> | undefined,
  toolId: string,
): readonly WrittenTestFileTracker[] {
  const aged = current
    .map((entry) => ({ path: entry.path, staleness: entry.staleness + 1, sourceToolId: entry.sourceToolId }))
    .filter((entry) => entry.staleness < MAX_AUTHORING_TRACK_CARRY);
  if (toolName === "Write") {
    const filePath = typeof input?.file_path === "string" ? input.file_path : undefined;
    if (filePath && isTestFilePath(filePath)) {
      const withoutDup = aged.filter((entry) => !sameTestFilePath(entry.path, filePath));
      return [...withoutDup, { path: filePath, staleness: 0, sourceToolId: toolId }].slice(-MAX_TRACKED_TEST_FILES);
    }
  }
  return aged;
}
