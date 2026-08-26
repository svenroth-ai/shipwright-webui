/*
 * external/org/role-extract.ts — extracts the one-sentence role summary
 * shown in a lead card's Role block from a lead's `charter.md`.
 *
 * Precise rule (iterate spec Design Notes, "Role extraction"): skip YAML
 * front matter and heading lines, select the first paragraph of plain prose
 * (skipping code fences and blockquote-only content), strip markdown
 * link/image syntax from the extracted text, take the first sentence up to
 * a bounded character cap. Returns `{ measured: false }` — never a dumped
 * first paragraph — when no usable prose sentence exists.
 *
 * Text-processing only, not a full markdown AST parse — the rule above is
 * expressed entirely as line-shape skips + a regex strip, which a real
 * parser would not make simpler for a single-sentence extraction.
 */

export type RoleExtraction = { measured: false } | { measured: true; text: string };

const ROLE_SENTENCE_MAX_CHARS = 240;

function stripMarkdownLinksAndImages(text: string): string {
  // ![alt](url) -> alt ; [text](url) -> text
  return text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1");
}

function firstSentence(text: string): string {
  const m = /^(.*?[.!?])(\s|$)/.exec(text);
  const sentence = m ? m[1] : text;
  return sentence.length > ROLE_SENTENCE_MAX_CHARS
    ? sentence.slice(0, ROLE_SENTENCE_MAX_CHARS).trimEnd()
    : sentence;
}

export function extractRoleSentence(charterMarkdown: string): RoleExtraction {
  let lines = charterMarkdown.split(/\r?\n/);

  // Skip a leading YAML front-matter block (--- ... ---).
  if (lines[0]?.trim() === "---") {
    const closeIdx = lines.slice(1).findIndex((l) => l.trim() === "---");
    if (closeIdx !== -1) {
      lines = lines.slice(closeIdx + 2);
    }
  }

  const paragraphLines: string[] = [];
  let inCodeFence = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;
    if (trimmed.length === 0) {
      if (paragraphLines.length > 0) break; // paragraph ended
      continue; // skip leading blank lines
    }
    if (/^#{1,6}\s/.test(trimmed)) continue; // heading line
    if (trimmed.startsWith(">")) continue; // blockquote-only content
    paragraphLines.push(trimmed);
  }

  const paragraph = paragraphLines.join(" ").trim();
  if (paragraph.length === 0) {
    return { measured: false };
  }

  const stripped = stripMarkdownLinksAndImages(paragraph).trim();
  if (stripped.length === 0) {
    return { measured: false };
  }

  const sentence = firstSentence(stripped).trim();
  if (sentence.length === 0) {
    return { measured: false };
  }

  return { measured: true, text: sentence };
}
