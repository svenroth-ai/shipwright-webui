/*
 * orgProposedEvidencePointer.ts (client mirror) — the evidence pointer of a proposal in `decisions-proposed.md`:
 * session excerpt, file line or journal event. Contract: `docs/org-proposed-entry-contract.md`.
 *
 * Mirrored VERBATIM below the marker in `server/src/external/org/proposed-evidence-pointer.ts` (CLAUDE.md rule 7);
 * `orgDecisionsApi.daemon-header.test.ts` fails when the two bodies differ. The view renders every field as plain
 * text, never as a link.
 */

// ---- EVIDENCE POINTER (verbatim mirror below this line) ----

/** A parsed evidence pointer. `known` is the session excerpt (`<session>:<ISO time>:<n>`, the name predates the other
 *  forms); `file` a line of a file in one of the lead's projects; `event` a journal event of the lead's run. All three
 *  are KNOWN sources (`isKnownSource`). Every field is decoded text for display and audit only: never a link, never a
 *  path the WebUI opens or reads. */
export type SourceRef =
  | { kind: "known"; session: string; time: string; message: string }
  | { kind: "file"; project: string; path: string[]; line: number }
  | { kind: "event"; id: string }
  | { kind: "unknown"; raw: string | null };

export const isKnownSource = (s: SourceRef): boolean => s.kind !== "unknown";

const POINTER_ISO = String.raw`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z`;
const SHORT_POINTER_RE = new RegExp(String.raw`^([A-Za-z0-9_-]{1,64}):(${POINTER_ISO}):(\d{1,9})$`);
const LONG_POINTER_RE = new RegExp(String.raw`^session ([A-Za-z0-9_-]{1,64}) at (${POINTER_ISO}), message (\d{1,9})$`);

/** A pointer (as written, before decoding) longer than this is unknown (leadwright `MAX_POINTER_CHARS`). */
export const MAX_POINTER_CHARS = 1024;
// One percent-encoded component: unreserved bytes or `%XX`. The daemon writes uppercase hex; lowercase is accepted.
const COMPONENT = String.raw`(?:[A-Za-z0-9._~-]|%[0-9A-Fa-f]{2})+`;
const FILE_POINTER_RE = new RegExp(String.raw`^file:(${COMPONENT}(?:/${COMPONENT})+)#L([1-9][0-9]{0,8})$`);
const EVENT_POINTER_RE = new RegExp(String.raw`^event:(${COMPONENT})$`);
// A decoded file component is refused (unknown) as leadwright refuses it: a separator, a C0 control or DEL, a Windows
// special character, a trailing dot or space, `.`/`..`, a device name. Stricter than the producer, for display: the
// label separator `·` (U+00B7) in a file component (it could fake a `· line N` part of the label), and in any
// component a character that renders as nothing or moves text: Unicode controls, format characters (bidi override,
// zero width), default-ignorables (Hangul filler, variation selectors), private use, line/paragraph separators.
// eslint-disable-next-line no-control-regex -- control characters are exactly what is refused here
const BAD_SEGMENT_RE = /[\u0000-\u001f\u007f·/\\:?*<>|"]|[. ]$/;
const DEVICE_NAME_RE = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?$/i;
const UNSHOWABLE_RE = /[\p{Cc}\p{Cf}\p{Co}\p{Default_Ignorable_Code_Point}\p{Zl}\p{Zp}]/u;

/** The decoded component, or `null` when it is broken UTF-8 (`%C3%28`), blank or holds an unshowable character. */
function decodeComponent(raw: string): string | null {
  let text: string;
  try {
    text = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return text.trim() === "" || UNSHOWABLE_RE.test(text) ? null : text;
}

function parseFilePointer(t: string): SourceRef | null {
  const m = FILE_POINTER_RE.exec(t);
  if (!m) return null;
  const parts = m[1].split("/").map(decodeComponent);
  if (parts.some((p) => p === null || p === "." || p === ".." || BAD_SEGMENT_RE.test(p) || DEVICE_NAME_RE.test(p))) return null;
  const [project, ...path] = parts as string[];
  return { kind: "file", project, path, line: Number(m[2]) };
}

function parseEventPointer(t: string): SourceRef | null {
  const m = EVENT_POINTER_RE.exec(t);
  const id = m ? decodeComponent(m[1]) : null;
  return id === null ? null : { kind: "event", id };
}

/** `session:time:number`, `session <id> at <time>, message <n>`, `file:<project>/<path>#L<n>` or `event:<id>`; the
 *  excerpt forms are tried FIRST (a session id may itself be `file` or `event`). Anything else is unknown. */
export function parseSourceRef(raw: string | null): SourceRef {
  const t = raw?.trim() ?? "";
  if (t === "") return { kind: "unknown", raw: null };
  const m = SHORT_POINTER_RE.exec(t) ?? LONG_POINTER_RE.exec(t);
  if (m) return { kind: "known", session: m[1], time: m[2], message: m[3] };
  if (t.length > MAX_POINTER_CHARS) return { kind: "unknown", raw: t };
  return parseFilePointer(t) ?? parseEventPointer(t) ?? { kind: "unknown", raw: t };
}
