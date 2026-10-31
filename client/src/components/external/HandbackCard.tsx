/**
 * HandbackCard — a subagent's report (or a message from another session) that
 * the CLI delivered as a user-role record. Rendered as a LEFT card, never as
 * the human's own bubble (campaign mission-desktop-style-v2 V2). The English
 * harness framing is hidden by the parser (`parsers/handback.ts`); the fixed
 * notice below replaces it. Shared by the Mission feed and BubbleTranscript.
 */
import type { ReactNode } from "react";
import type { HandbackOrigin } from "../../external/parsers/handback";
import { explanationExcerpt } from "../../lib/missionActivityFeedText";
import { MarkdownChunk } from "./BubbleTranscript/MarkdownChunk";

export const HANDBACK_NOTICE = "Reply from a subagent, not a message from you.";
export const SESSION_NOTICE = "Message from another session, not from you.";

export function handbackTagLabel(origin: HandbackOrigin): string {
  return origin === "subagent" ? "Subagent report" : "Other session";
}

interface Props {
  origin: HandbackOrigin;
  sender: string;
  text: string;
  /** Description of the delegated work, when the dispatching card is known. */
  title?: string;
  /** When set, the sender chip becomes a button (opens that agent). */
  onSenderClick?: (sender: string) => void;
  className?: string;
  tableWrap?: boolean;
  footer?: ReactNode;
}

export function HandbackCard({ origin, sender, text, title, onSenderClick, className, tableWrap, footer }: Props) {
  const hash = sender.slice(0, 8);
  // The title can be peer-supplied (cross-session from-name): strip control/bidi characters and cap it.
  const safeTitle = title ? explanationExcerpt(title, 1, 120) : "";
  return (
    <article className={`${className ? `${className} ` : ""}mc-handback`} data-testid="handback-card" data-origin={origin}>
      <div className="mc-handback-h">
        <span className="mc-handback-tag">{handbackTagLabel(origin)}</span>
        {safeTitle && <b title={safeTitle}>{safeTitle}</b>}
        {hash && (onSenderClick ? (
          <button type="button" className="mc-handback-chip" onClick={() => onSenderClick(sender)} aria-label={`Open agent ${hash}`}>{hash}</button>
        ) : (
          <span className="mc-handback-chip" data-static="true">{hash}</span>
        ))}
      </div>
      {text && <div className="mc-handback-body"><MarkdownChunk tableWrap={tableWrap} content={text} /></div>}
      <p className="mc-handback-notice">{origin === "subagent" ? HANDBACK_NOTICE : SESSION_NOTICE}</p>
      {footer}
    </article>
  );
}
