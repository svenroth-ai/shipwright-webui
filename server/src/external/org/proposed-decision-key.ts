/*
 * external/org/proposed-decision-key.ts — the decisionKey of a proposed
 * entry block (campaign shadow-proposals-webui, W3). Mirrored by
 * `client/src/lib/orgDecisionKey.ts`; both are held in step by the same
 * cases in their tests.
 *
 * A marker-owned entry (daemon form, or a WebUI-form header with a marker
 * above) carries the key on its `<!-- decisionKey: <key> -->` line; a bare
 * daemon header carries it after the em dash. A plain WebUI-form entry has
 * none (`null`) — such an entry can be rejected but never shows as a repeat.
 */

import { DAEMON_HEADER_RE, DAEMON_MARKER_RE, stripBom, isBlank } from "./proposed-grammar.js";

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
