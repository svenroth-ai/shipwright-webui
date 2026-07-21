/*
 * OperationLive — the MIDDLE card, told as PROSE (FR-01.68, replacing the
 * FR-01.66 rolling activity list).
 *
 * READ THIS TWICE (the classic mistake on this card, shared with ProofSummary):
 * this is NOT the terminal. It is rendered history from the read-only transcript
 * observer — NO xterm, NO node-pty, NO WebSocket, NO input affordance (rule 1;
 * the real embedded terminal lives in Files & Terminal and is untouched).
 *
 * WHAT CHANGED AND WHY. It used to render the last six mechanical tool lines.
 * Measured on the session that produced PR #307: 152 narratable steps existed,
 * 146 were discarded, and what survived was a truncated shell command, two
 * notes-file edits and the same pull request twice. That cap also meant
 * `.mc-hero` — a correct scroll container all along — never had anything to
 * scroll TO. Now it renders sentences, and the card scrolls.
 *
 * The `mission-narration-summary` line is RETIRED with it: in prose there is no
 * "current line", and it only ever repeated the last activity entry.
 *
 * Links live INSIDE the sentences, on the nouns they belong to, and drive the
 * SAME `activeNode` selection the left rail drives — one artifact panel, no
 * parallel link column (AC5). A span becomes a button only when the rail
 * actually offers that node, so there are no dead buttons.
 *
 * HONESTY (AC7): the paragraphs are exactly what `narrator-prose` produced.
 * When the JSONL evidences nothing it says so, and never fabricates. A20: the
 * text RESTS visible (staggerStyle only delays the entrance), so reduced motion
 * shows every paragraph, final and complete, immediately.
 */

import { staggerStyle } from "../../../lib/motion";
import type { Paragraph } from "../../../lib/narrator-prose";

interface Props {
  paragraphs: readonly Paragraph[];
  /** Selects an artifact — the same handler the left rail's links use. */
  onArtifactClick?: (artifact: string) => void;
}

export function OperationLive({ paragraphs, onArtifactClick }: Props) {
  const empty = paragraphs.length === 0;
  return (
    <section className="mc-op" data-testid="operation-card" data-live="true">
      <div
        className="mc-hero mc-story"
        role="log"
        aria-label="What is happening"
        tabIndex={0}
        data-testid="mission-narration"
        data-empty={empty || undefined}
      >
        {empty ? (
          <div className="mc-hero-empty">Waiting — nothing in the session log yet.</div>
        ) : (
          paragraphs.map((spans, i) => (
            <p
              className="mc-story-p motion-stagger-item"
              style={staggerStyle(i)}
              key={`p${i}`}
              data-testid="mission-narration-paragraph"
            >
              {spans.map((span, j) =>
                span.kind === "link" && onArtifactClick ? (
                  <button
                    type="button"
                    className="mc-story-link"
                    key={`s${j}`}
                    onClick={() => onArtifactClick(span.artifact)}
                  >
                    {span.text}
                  </button>
                ) : (
                  <span key={`s${j}`}>{span.text}</span>
                ),
              )}
            </p>
          ))
        )}
      </div>
    </section>
  );
}
