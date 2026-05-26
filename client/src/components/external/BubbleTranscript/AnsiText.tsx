/*
 * AnsiText — Campaign-C C3 BubbleTranscript split (2026-05-26).
 *
 * Thin wrapper around the legacy strip-ansi `ToolOutputBlock` (the lower-
 * level ANSI-stripping primitive — `client/src/components/external/
 * ToolOutputBlock.tsx`). We deliberately import it aliased here as
 * `LegacyAnsiBlock` so the file-local symbol disambiguates from the
 * newer-and-different-purpose `BubbleTranscript/ToolOutputBlock.tsx`
 * (which renders tool-use + tool-result pairs).
 *
 * Behaviour:
 *   - `text` → strip-ansi → strip C0 controls → render inside a <pre>.
 *   - `isError` toggles the error styling + `data-is-error` data attribute.
 *   - convertEol:false semantics preserved (memory
 *     `project_bug_b_remount_smear_writerace`) — the underlying <pre>
 *     renders raw `\n` line breaks without CR rewriting.
 */

import { ToolOutputBlock as LegacyAnsiBlock } from "../ToolOutputBlock";

interface Props {
  text: string;
  isError?: boolean;
}

export function AnsiText({ text, isError }: Props) {
  return <LegacyAnsiBlock text={text} isError={isError} />;
}
