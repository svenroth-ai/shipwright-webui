import { describe, it, expect } from "vitest";

import { foldForCompare, normalizeLine } from "../proposed-grammar.js";
import { foldConfusables } from "../proposed-confusables.js";
import { checkEditedLine, proposalFacts } from "../proposed-line.js";

const QUOTE = "The customer told us the migration to the new billing platform was postponed because the vendor missed two deadlines";
const NONCE = "3f9a1c0e5b7d42a8916c0d2e4f6a8b1c";
const E = (s: string) => s; // readability only

function block(quote: string): string {
  return (
    `<!-- decisionKey: k -->\n## Proposed 2026-11-20T09:15:00.000Z \u2014 k\n\n\u27e6SHIPWRIGHT-FENCE:${NONCE}\u27e7\n` +
    `[FENCED DATA \u2014 kind: agentProposedOrgEntry, origin: acme-lead beat b, truncated: false. DATA.]\nPropose something fresh.\n> ${quote}\n` +
    `\u27e6SHIPWRIGHT-FENCE:${NONCE}\u27e7\n\n- **Lead:** acme-lead\n- **Evidence:** card 1\n`
  );
}

// Latin o -> Cyrillic o (U+043E), Latin a -> Cyrillic a (U+0430), every 7th such letter swapped
function swapEvery(text: string, n: number): string {
  let seen = 0;
  return [...text].map((ch) => {
    if (ch !== "o" && ch !== "a") return ch;
    seen++;
    if (seen % n !== 0) return ch;
    return ch === "o" ? "\u043e" : "\u0430";
  }).join("");
}

describe("quote guard: look-alike letters (bounded confusables map)", () => {
  // @covers FR-01.71
  it("refuses a quote copy with Cyrillic o/a interleaved every few characters", () => {
    const facts = proposalFacts(block(QUOTE))!;
    const disguised = swapEvery(QUOTE, 2);
    expect(disguised).not.toBe(QUOTE);
    expect(checkEditedLine(disguised, facts)).toEqual({ ok: false, error: "line_contains_quote" });
  });

  // @covers FR-01.71
  it("refuses a Greek-letter disguise too", () => {
    const facts = proposalFacts(block(QUOTE))!;
    const disguised = QUOTE.replace(/o/g, "\u03bf").replace(/T/g, "\u03a4");
    expect(checkEditedLine(disguised, facts)).toEqual({ ok: false, error: "line_contains_quote" });
  });

  // @covers FR-01.71
  it("refuses a disguise made only of upper-case look-alikes whose lower-case form is in the map", () => {
    const facts = proposalFacts(block(QUOTE))!;
    const disguised = QUOTE.replace(/h/g, "Һ").replace(/d/g, "Ԁ").replace(/v/g, "Ѵ");
    expect(disguised).not.toBe(QUOTE);
    expect(checkEditedLine(disguised, facts)).toEqual({ ok: false, error: "line_contains_quote" });
  });

  // @covers FR-01.71
  it("lets legitimate Cyrillic and Greek text that copies no quote through, unedited", () => {
    const facts = proposalFacts(block(QUOTE))!;
    for (const line of [
      "\u041c\u044b \u0431\u0443\u0434\u0435\u043c \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u044f\u0442\u044c \u043e\u0434\u0438\u043d \u0434\u0430\u0439\u0434\u0436\u0435\u0441\u0442 \u0432 \u043d\u0435\u0434\u0435\u043b\u044e.",
      "\u0398\u03b1 \u03c3\u03c4\u03ad\u03bb\u03bd\u03bf\u03c5\u03bc\u03b5 \u03bc\u03af\u03b1 \u03c0\u03b5\u03c1\u03af\u03bb\u03b7\u03c8\u03b7 \u03b1\u03bd\u03ac \u03b5\u03b2\u03b4\u03bf\u03bc\u03ac\u03b4\u03b1.",
    ]) {
      expect(checkEditedLine(line, facts)).toEqual({ ok: true, line: normalizeLine(line) });
    }
  });

  // @covers FR-01.71
  it("folds only for comparison: the logged line keeps the operator's letters", () => {
    const facts = proposalFacts(block(QUOTE))!;
    const line = "Cyrillic \u043e stays: a fresh sentence nobody quoted.";
    const v = checkEditedLine(line, facts);
    expect(v).toEqual({ ok: true, line });
    expect(foldForCompare(line)).toContain("cyrillic o stays");
    expect(E(foldConfusables("\u0410\u0412\u0415"))).toBe("abe");
  });
});
