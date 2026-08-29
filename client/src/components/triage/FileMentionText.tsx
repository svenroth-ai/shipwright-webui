import type { ReactNode } from "react";
import { extractFileMentions } from "../../lib/extractFileMentions";
import { FileLink } from "./FileLink";

interface Props {
  // `TriageItem.detail` is typed `string`, but a producer's append event is
  // not runtime-validated (server/src/core/triage-store.ts copies fields
  // verbatim) — extractFileMentions tolerates null/undefined, so this stays
  // honest about what actually reaches this component.
  text: string | null | undefined;
  onOpen: (path: string) => void;
}

/**
 * Renders `text` as plain text with every detected file-path mention
 * (`extractFileMentions`) swapped for a clickable `FileLink` — used for the
 * triage `detail` body, where compliance findings cite files inline
 * (e.g. "see architecture.md").
 */
export function FileMentionText({ text, onOpen }: Props) {
  const mentions = extractFileMentions(text);
  if (mentions.length === 0) return <>{text}</>;

  const nodes: ReactNode[] = [];
  let cursor = 0;
  mentions.forEach((mention, i) => {
    if (mention.start > cursor) {
      nodes.push(text!.slice(cursor, mention.start));
    }
    nodes.push(<FileLink key={`m${i}`} path={mention.path} onOpen={onOpen} />);
    cursor = mention.end;
  });
  if (cursor < text!.length) {
    nodes.push(text!.slice(cursor));
  }
  return <>{nodes}</>;
}
