/*
 * narrator-prose.ts — the Mission middle card, told as prose (FR-01.68).
 *
 * Sven, 2026-07-21: "Ich würde Sätze machen, nicht eine aufklappbare Tabelle.
 * Die Geschichte lebt von der Erzählung. Klickbar ist alles rundherum. Ist
 * cool, im Text einen Link zu haben, aber nicht in einer verkappten
 * Darstellung." So: paragraphs of real sentences, with links INLINE on the
 * nouns they belong to, and no chapter furniture whatsoever.
 *
 * An accordion of stages was built first and REJECTED — it was a list wearing
 * a disclosure triangle, and it forced a chapter-segmentation problem that has
 * no good answer (a monotone latch produced one 7-hour "Merge" block on a real
 * session; per-event classification produced 18 chapters of Build/Test
 * ping-pong on the same one). Prose has no chapter boundaries to get wrong.
 *
 * NO LANGUAGE MODEL. Cost and latency aside, a card that may fabricate would
 * forfeit the honesty contract the whole derivation exists to keep. Every
 * sentence is earned by a fact from `narrator-facts.ts`; an absent fact
 * produces NO sentence rather than a placeholder.
 *
 * NO DURATIONS (Sven, 2026-07-21): elapsed wall-clock across a session that is
 * mostly thinking, paused or resumed measures something other than what it
 * would claim. "The information stands without it."
 *
 * Pure + deterministic.
 */

import type { NarrativeFacts, TestOutcome } from "./narrator-facts";

/** An inline link points at an artifact the rail ALREADY offers — the same
 *  `activeNode` identity the left panel drives (AC5). It is never built from a
 *  transcript value, and never emitted for a node that is not available. */
export type Span =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; artifact: string };

export type Paragraph = readonly Span[];

const t = (text: string): Span => ({ kind: "text", text });

/** Numbers read as words up to twelve; past that a digit is clearer than
 *  "seventeen". Prose, not a log line — "6 failed" is a log line. */
const WORDS = [
  "zero", "one", "two", "three", "four", "five", "six",
  "seven", "eight", "nine", "ten", "eleven", "twelve",
];
const word = (n: number) => (n < WORDS.length ? WORDS[n] : String(n));
const plural = (n: number, one: string, many = `${one}s`) =>
  `${word(n)} ${n === 1 ? one : many}`;
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A sentence builder that resolves links against what the rail actually has.
 * When an artifact is absent the SAME words render as ordinary text, so the
 * prose never changes shape — there is simply nothing to click.
 */
class Sentence {
  private spans: Span[] = [];

  constructor(private readonly available: ReadonlySet<string>) {}

  add(text: string): this {
    this.spans.push(t(text));
    return this;
  }

  link(text: string, artifact: string): this {
    this.spans.push(
      this.available.has(artifact) ? { kind: "link", text, artifact } : t(text),
    );
    return this;
  }

  get value(): Span[] {
    return this.spans;
  }
}

/** Merge adjacent text spans so the DOM carries one node per run of prose. */
function flatten(parts: Span[][]): Paragraph {
  const out: Span[] = [];
  for (const span of parts.flat()) {
    const last = out[out.length - 1];
    if (span.kind === "text" && last?.kind === "text") last.text += span.text;
    else out.push({ ...span });
  }
  return out;
}

function orientation(f: NarrativeFacts): string | null {
  const bits: string[] = [];
  if (f.read) bits.push(`${plural(f.read, "file")} read`);
  if (f.searched) bits.push(`${plural(f.searched, "search", "searches")} through the code`);
  if (bits.length === 0) return null;
  return `The work began by getting its bearings — ${bits.join(" and ")}.`;
}

/**
 * The plot. Graded strictly by `TestOutcome`, which is graded by evidence:
 * recovery is narrated ONLY when a later run carries positive success
 * evidence, never inferred from the absence of an error (AC3).
 */
function verification(tests: readonly TestOutcome[], s: () => Sentence): Span[] | null {
  if (tests.length === 0) return null;
  const last = tests[tests.length - 1];
  const failures = tests.filter((x) => x.status === "failed");

  if (last.status === "pending") {
    return s().add("The ").link("tests", "tests").add(" are running now.").value;
  }

  if (last.status === "failed") {
    const sentence = s().add("The ").link("tests", "tests");
    if (last.failed == null) return sentence.add(" were run and did not pass.").value;
    const verb = last.failed === 1 ? "is" : "are";
    return sentence.add(` were run, and ${word(last.failed)} of them ${verb} still failing.`).value;
  }

  // last.status === "passed"
  const green = last.counted
    ? " until the whole suite came back green."
    : " until a later run completed without errors.";

  if (failures.length > 0) {
    const first = failures[0] as { status: "failed"; failed: number | null };
    const opening =
      first.failed == null
        ? " were run and did not pass."
        : ` were run, and ${word(first.failed)} of them failed.`;
    return s()
      .add("The ")
      .link("tests", "tests")
      .add(`${opening} Work continued${green}`)
      .value;
  }

  const runs = tests.length > 1 ? `, ${plural(tests.length, "time")} over,` : "";
  const closing = last.counted
    ? " and the whole suite passed."
    : " and completed without errors.";
  return s().add("The ").link("tests", "tests").add(` were run${runs}${closing}`).value;
}

function closing(f: NarrativeFacts, s: () => Sentence): Span[] | null {
  if (f.commits && f.pr != null) {
    return s()
      .add("The change was ")
      .link("recorded", "commit")
      .add(` and is now waiting for review as pull request #${f.pr}.`)
      .value;
  }
  if (f.pr != null) return s().add(`It is now waiting for review as pull request #${f.pr}.`).value;
  if (f.commits) return s().add("The change was ").link("recorded", "commit").add(".").value;
  if (f.pushed) return s().add("It has been pushed for review.").value;
  return null;
}

/**
 * Compose the narrative. `availableArtifacts` are the rail node identities this
 * card may link to; anything else stays plain text (AC5).
 *
 * Returns an EMPTY array when the transcript evidences nothing — the caller
 * renders its existing honest waiting line rather than a fabricated sentence.
 */
export function narrate(
  facts: NarrativeFacts,
  availableArtifacts: readonly string[] = [],
): Paragraph[] {
  const available = new Set(availableArtifacts);
  const s = () => new Sentence(available);
  const paragraphs: Paragraph[] = [];

  if (facts.ask) {
    paragraphs.push(flatten([s().add(`You asked: “${facts.ask}”`).value]));
  }

  const opening: Span[][] = [];
  const orient = orientation(facts);
  if (orient) opening.push(s().add(orient).value);
  if (facts.specWritten) {
    opening.push(
      s().add(" The ").link("plan", "spec").add(" was written down before any code was touched.")
        .value,
    );
  }
  if (opening.length) paragraphs.push(flatten(opening));

  const plot: Span[][] = [];
  if (facts.changed) {
    // PASSIVE, deliberately: "twelve files changed" reads as though the files
    // changed themselves. Somebody changed them.
    const verb = facts.changed === 1 ? "was" : "were";
    plot.push(
      s().add(`${capitalize(plural(facts.changed, "file"))} ${verb} then changed.`).value,
    );
  }
  const checks = verification(facts.tests, s);
  if (checks) plot.push(plot.length ? [t(" "), ...checks] : checks);
  if (plot.length) paragraphs.push(flatten(plot));

  const close = closing(facts, s);
  if (close) paragraphs.push(flatten([close]));

  return paragraphs;
}
