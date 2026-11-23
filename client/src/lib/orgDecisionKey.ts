/*
 * orgDecisionKey.ts (client mirror) — the decisionKey of a proposed entry
 * block (campaign shadow-proposals-webui, W3). Mirror of
 * `server/src/external/org/proposed-decision-key.ts` (CLAUDE.md rule 7); the
 * same cases are asserted in both tests.
 */
import { DAEMON_HEADER_RE, DAEMON_MARKER_RE, stripBom, isBlank } from "./orgProposedGrammar";

const MARKER_KEY_RE = /^<!--[ \t]*decisionKey:[ \t]*(.*?)[ \t]*-->\r?$/;

// A key is an identifier, never prose: anything else (a quote used as a title) is no key.
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

export function decisionKeyOf(block: string): string | null {
  const lines = stripBom(block).split("\n");
  let i = 0;
  while (i < lines.length && isBlank(lines[i])) i++;
  const first = lines[i] ?? "";
  if (DAEMON_MARKER_RE.test(first)) {
    const key = MARKER_KEY_RE.exec(first)?.[1] ?? "";
    return KEY_RE.test(key) ? key : null;
  }
  const d = DAEMON_HEADER_RE.exec(first);
  return d && KEY_RE.test(d[2]) ? d[2] : null;
}
