/**
 * Kickoff-flag stripping for the narrator's "ask" line, split out of
 * `narrator-facts.ts` so that file stays under the size ceiling.
 */

/** Kickoff flags that CONSUME the next token. Whether a flag takes a value is
 *  not decidable in general, so this is the known set for this command family
 *  (see the iterate skill's usage banner) rather than a guess: an UNKNOWN flag
 *  drops only itself, because eating a real word out of the request is the
 *  worse failure. `--flag=value` needs no entry. */
const VALUE_FLAGS = new Set(["--type", "--complexity", "--campaign", "--sub-iterate-id"]);

/** Leading CLI flags are how a request was made, not what it said. Stops at
 *  `--`, so a request that legitimately begins with a dash survives intact. */
export function stripFlags(raw: string): string {
  const tokens = raw.trim().split(/\s+/);
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === "--") {
      i += 1;
      break; // everything after is the request, verbatim
    }
    if (!t.startsWith("-") || t.length < 2) break;
    i += VALUE_FLAGS.has(t) ? 2 : 1;
  }
  return tokens.slice(i).join(" ").trim();
}
