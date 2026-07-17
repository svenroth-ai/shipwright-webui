/*
 * OperationLive — the MIDDLE card when a session is LIVE / ad-hoc / empty
 * (FR-01.66). A plain-language, live summary of what is currently in the JSONL:
 * a rolling "what's happening now" line + a short recent-activity list.
 *
 * READ THIS TWICE (the classic mistake on this card, shared with ProofSummary):
 * this is NOT the terminal. It is rendered history from the read-only transcript
 * observer — NO xterm, NO node-pty, NO WebSocket, NO input affordance (rule 1;
 * the real embedded terminal lives in Files & Terminal and is untouched).
 *
 * HONESTY (AC3): the summary/activity are exactly what `summarizeTranscript`
 * produced. When the JSONL has nothing yet, it says so ("waiting"), never
 * fabricates activity. A20: the activity lines REST visible (staggerStyle only
 * delays the entrance), so reduced motion shows every line, final, immediately.
 */

import { staggerStyle } from "../../../lib/motion";
import type { TranscriptActivity } from "../../../lib/narrator-transcript";

interface Props {
  narration: { summary: string | null; activity: TranscriptActivity[] };
}

export function OperationLive({ narration }: Props) {
  const { summary, activity } = narration;
  const empty = activity.length === 0;
  return (
    <section className="mc-op" data-testid="operation-card" data-live="true">
      <p className="mc-missionline" data-testid="mission-narration-summary">
        {summary ?? "Waiting — nothing in the session log yet."}
      </p>
      <div
        className="mc-hero"
        role="log"
        aria-label="Live activity"
        tabIndex={0}
        data-testid="mission-narration"
        data-empty={empty || undefined}
      >
        {empty ? (
          <div className="mc-hero-empty">No activity in the session log yet.</div>
        ) : (
          activity.map((item, i) => (
            <div
              className="mc-hero-line motion-stagger-item"
              style={staggerStyle(i)}
              key={item.id}
            >
              {item.text}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
