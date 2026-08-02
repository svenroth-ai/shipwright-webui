/**
 * network-verdict.mjs — the skip-vs-fail rule for network-dependent tests.
 *
 * THE CONVENTION (iterate-2026-08-01-bootstrapper-ci-contract). This repo had no
 * network-dependent test before the marketplace contract test, so the rule is
 * set here once, in one pure function, rather than re-decided per test:
 *
 *   "could not ask"          -> SKIP, loudly
 *   "asked, got a bad answer" -> FAIL
 *
 * The asymmetry is the whole point. A build that goes green because the network
 * was down has recorded "cannot check" as "check passed", which is exactly the
 * failure mode a contract test exists to prevent.
 *
 * WHY A SEPARATE, PURE MODULE. Three reasons, in order of weight:
 *  1. The rule is verified on EVERY run, offline and deterministically, by the
 *     unit tests in marketplace-contract.test.mjs. So even on the day the live
 *     probe skips, the thing that decides skip-vs-fail is still under test — the
 *     skip path can never quietly widen into "everything is a skip".
 *  2. It is reviewable as a table (see below) instead of as control flow buried
 *     in an async test body.
 *  3. It keeps the classification honest about its INPUTS: callers may only feed
 *     it an error captured from the request/response-body phase. Wrapping more
 *     than that would let a coding defect (a typo raising TypeError) disguise
 *     itself as a transport failure and skip.
 *
 * WHY test/helpers/ AND NOT lib/. `package.json#files` publishes `lib/`, so a
 * module placed there ships to every `npx @svenroth-ai/shipwright` user. This is
 * test-only support code; it must not be in the tarball. `vitest.config.mjs`
 * collects only files under `test/` whose name ends in `.test.mjs`, so this
 * file is imported by a test, never collected as one.
 */

import { appendFileSync } from "node:fs";

// Written as char codes on purpose: a literal CR/LF escape in this source is
// fragile under some editing tooling, and this file's whole job is exactness.
const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);

/**
 * The classification table. Statuses not named here fall to `fail`.
 *
 * | Outcome                                  | Verdict | Why                                    |
 * |------------------------------------------|---------|----------------------------------------|
 * | DNS / connect failure, TLS error         | skip    | no response ever arrived               |
 * | AbortError (our deadline expired)        | skip    | no COMPLETE response arrived           |
 * | HTTP 429                                 | skip    | rate limit — a refusal to answer       |
 * | HTTP 5xx                                 | skip    | producer-side transient                |
 * | HTTP 2xx                                 | check   | a real answer: hold it to the contract |
 * | HTTP 404                                 | fail    | manifest gone from the fetched path    |
 * | HTTP 403 / any other non-2xx             | fail    | a definite answer the installer cannot use |
 *
 * 404 is deliberately NOT a skip. It is the single most likely shape of the
 * drift this test exists to catch: the monorepo moves or renames
 * `.claude-plugin/marketplace.json` and every `npx` install silently loses its
 * plugin list. 403 likewise — the manifest is fetched unauthenticated, exactly
 * as a user's `npx` does, so a 403 means users are already broken.
 *
 * KNOWN RESIDUAL RISK on that last one (raised in Stage-2 review, accepted):
 * raw.githubusercontent.com sits behind a CDN that has been seen answering 403
 * with a rate-limit body under abuse protection, and Actions runners share busy
 * egress ranges. That is the one plausible false RED. If it ever fires, the
 * surgical fix is to sniff the body / `retry-after` for a rate-limit signature
 * before classifying 403 — NOT to widen the whole class into `skip`.
 */
const TRANSIENT_STATUSES = new Set([429]);

/**
 * Classify one fetch outcome. Exactly one of `transportError` / `status` must be
 * supplied — passing neither (or both) is a caller bug and throws, because a
 * silent default here would be a silent skip.
 *
 * @param {{ transportError?: unknown, status?: number | null }} outcome
 * @returns {{ verdict: "skip" | "check" | "fail", reason: string }}
 */
export function classifyFetchOutcome(outcome = {}) {
  const { transportError = null, status = null } = outcome;

  if (transportError != null && status != null) {
    throw new TypeError("classifyFetchOutcome: pass transportError OR status, never both");
  }

  if (transportError != null) {
    const name = transportError?.name ?? "Error";
    const message = transportError?.message ?? String(transportError);
    // undici surfaces DNS/connect failures as `TypeError: fetch failed` with the
    // real errno on `.cause`; surface it so a skipped run says WHY in one line.
    const code = transportError?.cause?.code;
    const cause = code ? ` (${code})` : "";

    // A MALFORMED URL is a coding defect wearing a TypeError, not an outage —
    // undici raises the same class for both. Left as `skip` it would be the one
    // true false-green: refactor MANIFEST_RAW_URL to undefined and the probe
    // skips forever, green forever. (Stage-3 doubt review.)
    if (code === "ERR_INVALID_URL" || /Failed to parse URL/i.test(message)) {
      return {
        verdict: "fail",
        reason: `the URL under test is malformed, which is a defect here, not an outage: ${message}`,
      };
    }

    if (name === "AbortError" || name === "TimeoutError") {
      return { verdict: "skip", reason: `request did not complete before the deadline: ${message}` };
    }
    return { verdict: "skip", reason: `transport failure: ${name}: ${message}${cause}` };
  }

  if (status == null) {
    throw new TypeError("classifyFetchOutcome: pass transportError OR status, got neither");
  }
  if (!Number.isInteger(status)) {
    throw new TypeError(`classifyFetchOutcome: status must be an integer, got ${String(status)}`);
  }

  if (status >= 200 && status <= 299) {
    return { verdict: "check", reason: `HTTP ${status}` };
  }
  if (TRANSIENT_STATUSES.has(status)) {
    return { verdict: "skip", reason: `HTTP ${status} — rate limited, the producer declined to answer` };
  }
  if (status >= 500 && status <= 599) {
    return { verdict: "skip", reason: `HTTP ${status} — producer-side transient` };
  }
  return {
    verdict: "fail",
    reason:
      `HTTP ${status} — a definite response the installer cannot use. ` +
      `This is drift, not an outage: a real user's unauthenticated npx fetch gets the same answer.`,
  };
}

/** Escape a value for a GitHub Actions workflow-command payload. */
function escapeData(value) {
  return String(value).split("%").join("%25").split(CR).join("%0D").split(LF).join("%0A");
}

/** Escape a value for a GitHub Actions workflow-command PROPERTY (stricter). */
function escapeProperty(value) {
  return escapeData(value).split(":").join("%3A").split(",").join("%2C");
}

/**
 * Announce that a contract could NOT be verified, on every channel that anyone
 * actually looks at. The caller still owns the test-runner skip itself (only it
 * holds the vitest context) — this returns the message to pass to `ctx.skip()`.
 *
 * FOUR channels, because each one alone has a blind spot:
 *  - the vitest skip note is invisible in a `-q` log tail;
 *  - `console.warn` is invisible in the Actions run-summary UI;
 *  - the `::warning::` annotation is invisible locally, AND is not guaranteed in
 *    CI: vitest intercepts worker stdout and re-prints it under a
 *    `stdout | <file> > <test>` header, while GitHub only parses a workflow
 *    command that begins its own line. Raised in Stage-2 review — rather than
 *    depend on that re-print being verbatim, the step summary was added;
 *  - `GITHUB_STEP_SUMMARY` is a FILE append, so no stdout capture can swallow
 *    it, and it renders directly on the run page. This is the channel that
 *    actually makes "loud" hold in CI.
 *
 * The summary write is best-effort: it is observability, and a read-only or
 * missing runner file must never convert a skip into an error.
 *
 * @param {{ title: string, reason: string }} notice
 * @param {{
 *   warn?: (msg: string) => void,
 *   isActions?: boolean,
 *   emit?: (line: string) => void,
 *   summary?: (markdown: string) => void,
 * }} io
 * @returns {string} the message to hand to `ctx.skip()`
 */
export function reportUnverified(notice, io = {}) {
  return announce(`${notice.title}: NOT VERIFIED — ${notice.reason}`, notice.title, io);
}

/**
 * Announce that the endpoint answered INCONSISTENTLY — a `fail`-classified
 * status on the first read, a usable document on the retry.
 *
 * This is the one outcome the retry policy creates and it must not be silent.
 * The document itself is then held to the full contract as normal, so real drift
 * (which is persistent) still fails; what this records is that the producer's
 * edge served two different answers, which is worth knowing before someone
 * debugs a "flaky" contract test from scratch.
 *
 * @param {{ title: string, firstReason: string }} notice
 * @returns {string} the message announced
 */
export function reportInconsistentEndpoint(notice, io = {}) {
  const message =
    `${notice.title}: the endpoint answered inconsistently — the first read gave ` +
    `"${notice.firstReason}", the retry returned a usable document. The document ` +
    `below was still checked in full; investigate the producer's edge if this recurs.`;
  return announce(message, notice.title, io);
}

/** The shared four-channel emitter. See reportUnverified for why four. */
function announce(message, title, io = {}) {
  const {
    warn = console.warn,
    isActions = process.env.GITHUB_ACTIONS === "true",
    emit = (line) => process.stdout.write(line + LF),
    summary = defaultSummaryAppend,
  } = io;

  warn(`[contract] ${message}`);
  if (isActions) {
    emit(`::warning title=${escapeProperty(title)}::${escapeData(message)}`);
    try {
      summary(`> [!WARNING]${LF}> ${message}${LF}`);
    } catch {
      // Best-effort only — never let observability fail the run.
    }
  }
  return message;
}

/** Append to the runner's step-summary file, if the runner provided one. */
function defaultSummaryAppend(markdown) {
  const target = process.env.GITHUB_STEP_SUMMARY;
  if (!target) return;
  appendFileSync(target, markdown, "utf-8");
}

/**
 * Is "could not verify" allowed to be a SKIP here, or must it be a FAILURE?
 *
 * WHY THIS ASYMMETRY EXISTS (decided 2026-08-01, after Stage-3 doubt review).
 * On a pull request a skip is right: a GitHub outage must never block a
 * contributor whose change has nothing to do with the manifest. But on the
 * WEEKLY run the same skip is a quiet lie. A skipped test leaves the job green,
 * the run green, and GitHub only emails on a FAILED scheduled run — so fifty-two
 * skipped weeks are indistinguishable from fifty-two verified ones, and the
 * `::warning` + step-summary channels only reach a human who opens a green run,
 * which nobody does for a cron. The scheduled run has no unrelated PR to block
 * and re-running it is one click, so there it fails closed and the operator
 * actually hears about it. That is the only reading under which this module's
 * thesis — "cannot check is not check passed" — is true one level up, at the
 * level of the run rather than the test.
 *
 * `SHIPWRIGHT_REQUIRE_MANIFEST_VERIFICATION` forces either answer (`1` / `0`),
 * for local reproduction and for a maintainer who wants a hard check on demand.
 *
 * @param {NodeJS.ProcessEnv} env
 */
export function verificationIsMandatory(env = process.env) {
  // Trimmed before every comparison: CI env-var quoting can deliver " 0", and an
  // untrimmed compare would read that as "on" — turning an intended opt-OUT into
  // a hard failure. An all-whitespace value is "unset", like the empty string.
  const explicit = (env.SHIPWRIGHT_REQUIRE_MANIFEST_VERIFICATION ?? "").trim();
  if (explicit !== "") {
    return explicit !== "0" && explicit.toLowerCase() !== "false";
  }
  return (env.GITHUB_EVENT_NAME ?? "").trim() === "schedule";
}
