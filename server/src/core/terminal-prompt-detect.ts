/*
 * terminal-prompt-detect.ts — iterate-2026-05-18-inbox-terminal-prompts
 *
 * Pure detector for a *waiting* `AskUserQuestion` picker in the visible
 * text of an embedded-terminal session.
 *
 * Why this exists: Claude Code journals a tool-call turn only after the
 * tool returns. For `AskUserQuestion` "returns" = "the user answered", so
 * the tool_use + tool_result land in the JSONL together, after the
 * answer. A *waiting* picker is therefore never visible in the JSONL —
 * neither `deriveInbox` (path A) nor `detectAwaitingUserQuestion` (path B)
 * can see it. The only data source that reflects a live picker is the
 * terminal output itself (the per-task `@xterm/headless` mirror).
 *
 * `extractTerminalPrompt` takes the decoded visible-viewport text (from
 * `HeadlessMirror.getVisibleText()` via `PtyManager.peekTerminalText()`)
 * and returns the picker block, or `null`.
 *
 * Hardening folded in from the iterate plan's external review:
 *   - gemini-2 (zombie prompt): the footer MUST be the bottom-most
 *     non-blank content. Once Claude exits and the shell prints a fresh
 *     prompt below the (lingering) footer, the picker is stale → null.
 *   - openai-10 (security): the captured block is bounded above by a
 *     horizontal rule, a 2-blank-line gap, or a hard line cap, then
 *     length-capped — so arbitrary scrollback above the picker cannot
 *     leak into the inbox response.
 *   - openai-5: footer matching is separator-agnostic + case-insensitive.
 */

import { MAX_QUESTION_TEXT_LEN } from "./inbox-derive.js";

/** "Enter to select" cue — half of the strong footer signature. */
const FOOTER_SELECT = /enter to select/i;
/** "Esc to cancel" cue — the other half. Both required. */
const FOOTER_CANCEL = /esc to cancel/i;
/** Any footer-ish cue — used to recognise the (possibly wrapped) footer
 *  line(s) at the bottom of the viewport. */
const FOOTER_CUE = /tab\/arrow|to navigate|to cancel|to select/i;

/** Hard cap on collected block lines — a real picker is well under this;
 *  the cap bounds a pathological viewport. */
const MAX_BLOCK_LINES = 24;

/** Box-drawing (U+2500–U+257F) + ascii rule characters. */
const RULE_CHAR = /[─-╿\-_=]/u;

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

/** A horizontal-rule line — Claude Code renders one above the picker.
 *  Used as the block's top boundary so preamble text never leaks in. */
function isRuleLine(line: string): boolean {
  const t = line.trim();
  if (t.length < 3) return false;
  let ruleCount = 0;
  for (const ch of t) {
    if (RULE_CHAR.test(ch)) ruleCount++;
  }
  return ruleCount / t.length >= 0.8;
}

/**
 * Extract the waiting-picker block from decoded terminal viewport text.
 * Returns the trimmed block (capped at `MAX_QUESTION_TEXT_LEN`) when a
 * live `AskUserQuestion` picker is the bottom-most content, else `null`.
 */
export function extractTerminalPrompt(visibleText: string): string | null {
  if (!visibleText) return null;
  const lines = visibleText.split("\n");

  // The footer MUST be the bottom-most non-blank line. A picker whose
  // footer is no longer at the bottom (shell prompt printed below it,
  // Claude exited) is stale — do not surface it (gemini-2).
  let lastNonBlank = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!isBlank(lines[i])) {
      lastNonBlank = i;
      break;
    }
  }
  if (lastNonBlank === -1) return null;
  if (!FOOTER_CUE.test(lines[lastNonBlank])) return null;

  // Footer region = the contiguous footer-ish run ending at lastNonBlank
  // (covers a footer wrapped across 2 lines on a narrow terminal). It
  // must carry BOTH the "Enter to select" and "Esc to cancel" cues — a
  // strong, separator-agnostic signature (openai-5).
  let footerTop = lastNonBlank;
  while (
    footerTop > 0 &&
    !isBlank(lines[footerTop - 1]) &&
    FOOTER_CUE.test(lines[footerTop - 1])
  ) {
    footerTop--;
  }
  const footerRegion = lines.slice(footerTop, lastNonBlank + 1).join(" ");
  if (!FOOTER_SELECT.test(footerRegion) || !FOOTER_CANCEL.test(footerRegion)) {
    return null;
  }

  // Collect the picker block upward from the footer. Bounded by a
  // horizontal-rule line, a 2-blank-line gap, or the hard line cap so
  // unrelated scrollback above the picker cannot leak in (openai-10).
  const block: string[] = [];
  let blankRun = 0;
  for (let i = lastNonBlank; i >= 0 && block.length < MAX_BLOCK_LINES; i--) {
    const line = lines[i];
    if (isRuleLine(line)) break;
    if (isBlank(line)) {
      blankRun++;
      if (blankRun >= 2) break;
    } else {
      blankRun = 0;
    }
    block.push(line);
  }
  block.reverse();
  while (block.length > 0 && isBlank(block[0])) block.shift();
  while (block.length > 0 && isBlank(block[block.length - 1])) block.pop();
  if (block.length === 0) return null;

  const text = block.join("\n");
  // Keep the head (question + options sit at the top of a picker block);
  // a pathological over-long block loses only its trailing lines.
  return text.length > MAX_QUESTION_TEXT_LEN
    ? text.slice(0, MAX_QUESTION_TEXT_LEN)
    : text;
}
