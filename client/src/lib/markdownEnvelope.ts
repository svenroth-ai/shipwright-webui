/*
 * markdownEnvelope.ts — file envelope: keep non-prose structure OUT of the
 * markdown editor's round-trip (split out of markdownTiptap.ts,
 * iterate-2026-08-31-markdown-raw-html-passthrough, to stay under the repo's
 * 300-line file convention; no behavior change).
 *
 * The Markdown -> ProseMirror -> Markdown round-trip is lossy: a leading YAML
 * frontmatter block gets mangled (the closing `---` parses as a setext H2
 * underline, collapsing every key:value line into one heading), line endings
 * normalise to LF, and the trailing newline is dropped. So even a one-character
 * body edit used to surface as a whole-file diff — and a Save would CORRUPT the
 * frontmatter on disk. The envelope splits the file so the editor owns ONLY the
 * prose `core`; `frontmatter`, surrounding blank lines, the line-ending style,
 * and the trailing newline are preserved VERBATIM.
 *
 * Line endings are derived via char codes (String.fromCharCode), never "\n" /
 * "\r" escape literals: such escapes in editor-written source have been written
 * as real control bytes and corrupted files in this repo before (project memory).
 */

const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);

export interface MarkdownEnvelope {
  /** Verbatim leading `---...---` fence block (incl. its trailing newline), or "". */
  frontmatter: string;
  /** `frontmatter` + any leading blank lines — preserved verbatim, never edited. */
  prefix: string;
  /** The prose body the editor owns (surrounding whitespace stripped). */
  core: string;
  /** Trailing whitespace / newline run of the original — preserved verbatim. */
  suffix: string;
  /** Original line-ending style: CRLF if the file contains any, else LF. */
  eol: string;
}

function isWs(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13;
}

/** True if a line (ignoring a trailing CR + trailing spaces/tabs) is exactly `---`. */
function isFenceLine(line: string): boolean {
  let end = line.length;
  if (end > 0 && line.charCodeAt(end - 1) === 13) end -= 1; // strip CR of a CRLF line
  while (end > 0 && (line.charCodeAt(end - 1) === 32 || line.charCodeAt(end - 1) === 9)) end -= 1;
  return line.slice(0, end) === "---";
}

/** Length (chars from index 0) of a leading YAML frontmatter block incl. its
 *  trailing newline, or 0 if the text does not open with a CLOSED `---` fence.
 *
 *  Heuristic (intentionally matching gray-matter / the prior detectLossyConstructs
 *  regex): first line is exactly `---`, the next `---` line closes it. A document
 *  that opens with a thematic-break `---` and has another `---` later would be
 *  read as frontmatter — accepted, since starting a doc with a horizontal rule is
 *  vanishingly rare and there is no syntactic frontmatter/HR distinction without a
 *  YAML parse. Either way the block is preserved verbatim, never corrupted. */
function frontmatterLength(text: string): number {
  if (!text.startsWith("---")) return 0;
  const starts: number[] = [];
  const ends: number[] = [];
  let pos = 0;
  for (;;) {
    let nl = text.indexOf(LF, pos);
    if (nl === -1) nl = text.length;
    starts.push(pos);
    ends.push(nl);
    if (nl === text.length) break;
    pos = nl + 1;
  }
  if (!isFenceLine(text.slice(starts[0], ends[0]))) return 0;
  for (let i = 1; i < starts.length; i += 1) {
    if (isFenceLine(text.slice(starts[i], ends[i]))) {
      let cut = ends[i];
      if (cut < text.length && text.charCodeAt(cut) === 10) cut += 1; // include the newline
      return cut;
    }
  }
  return 0; // unterminated fence -> not frontmatter, leave it in the body
}

/**
 * Decompose a markdown file into the prose `core` the editor owns plus the
 * verbatim `prefix` / `suffix` / `eol` it must NOT touch. See the section
 * header above for why this exists.
 */
export function splitMarkdownEnvelope(text: string): MarkdownEnvelope {
  const eol = text.indexOf(CR + LF) !== -1 ? CR + LF : LF;
  const fmLen = frontmatterLength(text);
  const frontmatter = text.slice(0, fmLen);
  const rest = text.slice(fmLen);

  // Consume only fully-BLANK leading lines (the separator after frontmatter, or
  // blank lines at the top of a frontmatter-less file). The first content line —
  // INCLUDING its own indentation — belongs to `core`, so an indented first line
  // (e.g. an indented code block) is not silently moved out of the editor.
  let i = 0;
  for (;;) {
    const lineEnd = rest.indexOf(LF, i);
    if (lineEnd === -1) break; // no newline left → the remainder is content/trailing
    let blank = true;
    for (let k = i; k < lineEnd; k += 1) {
      const c = rest.charCodeAt(k);
      if (c !== 32 && c !== 9 && c !== 13) {
        blank = false;
        break;
      }
    }
    if (!blank) break;
    i = lineEnd + 1;
  }
  const leading = rest.slice(0, i);
  const afterLeading = rest.slice(i);

  let j = afterLeading.length;
  while (j > 0 && isWs(afterLeading.charCodeAt(j - 1))) j -= 1;
  const core = afterLeading.slice(0, j);
  const suffix = afterLeading.slice(j);

  return { frontmatter, prefix: frontmatter + leading, core, suffix, eol };
}

/**
 * Re-assemble a file from its envelope and the editor's freshly serialized
 * `core`. The serializer emits LF only; the body is re-mapped to the file's
 * original line ending so a CRLF file is not rewritten line-by-line on save.
 */
export function composeMarkdownEnvelope(
  env: MarkdownEnvelope,
  serializedCore: string,
): string {
  const lfBody = serializedCore.split(CR).join(""); // defensive: drop stray CR
  const body = env.eol === LF ? lfBody : lfBody.split(LF).join(env.eol);
  return env.prefix + body + env.suffix;
}
