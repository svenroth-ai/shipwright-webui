/*
 * external/org/proposed-confusables.ts — the look-alike letter map of the quote guard.
 *
 * Used ONLY to build the comparison form of a text (`foldForCompare` in the mirrored grammar): a line that copies a
 * quote but swaps some Latin letters for Cyrillic or Greek letters that render the same must still be recognised as a
 * copy. The map never touches what is shown or logged - the log gets the operator's line as typed.
 *
 * Mirrored VERBATIM below the marker in `client/src/lib/orgProposedConfusables.ts` (CLAUDE.md rule 7);
 * `orgDecisionsApi.daemon-header.test.ts` fails when the two bodies differ.
 *
 * Limit (accepted, documented in docs/org-proposed-entry-contract.md): this is a SMALL, EXPLICIT, BOUNDED list of the
 * Cyrillic and Greek letters that are visually near-identical to a Latin letter in common fonts. It is not the full
 * Unicode UTS #39 confusables table: other scripts, rarer look-alikes, paraphrase and translation are not detected.
 * Fullwidth and other compatibility forms are handled by NFKC before this map runs.
 */

// ---- CONFUSABLES (verbatim mirror below this line) ----

/** Pairs "<look-alike><latin>", both cases of the look-alike map to the lower-case Latin letter. */
const PAIRS: readonly string[] = [
  // Cyrillic, lower case
  "аa", "вb", "еe", "кk", "мm", "нh", "оo", "рp", "сc", "тt", "уy", "хx", "іi", "јj", "ѕs", "ԁd", "ԛq", "ԝw", "һh", "ӏl", "ѵv",
  // Cyrillic, upper case
  "Аa", "Вb", "Еe", "Кk", "Мm", "Нh", "Оo", "Рp", "Сc", "Тt", "Уy", "Хx", "Іi", "Јj", "Ѕs", "Ԛq", "Ԝw", "Ӏl",
  // Greek, lower case
  "αa", "ιi", "κk", "νv", "οo", "ρp", "υu", "χx", "γy",
  // Greek, upper case
  "Αa", "Βb", "Εe", "Ζz", "Ηh", "Ιi", "Κk", "Μm", "Νn", "Οo", "Ρp", "Τt", "Υy", "Χx",
  // Latin letters without a dot or with a variant shape
  "ıi", "ɡg", "ſs",
];

const CONFUSABLE_MAP: ReadonlyMap<string, string> = new Map(PAIRS.filter((p) => p.length === 2).map((p) => [p[0], p[1]]));

/** Replace every look-alike letter of the bounded map by its Latin twin. Comparison only, never written anywhere. */
export function foldConfusables(text: string): string {
  let out = "";
  for (const ch of text) out += CONFUSABLE_MAP.get(ch) ?? ch;
  return out;
}
