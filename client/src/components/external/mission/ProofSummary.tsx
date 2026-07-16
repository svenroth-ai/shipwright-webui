/*
 * ProofSummary — the Operation card's `.mc-hero` proof block (FR-01.56, A12).
 *
 * READ THIS TWICE — it is the classic mistake on this card. This is NOT the live
 * terminal. It is a short, curated, READ-ONLY list of proof lines (rendered
 * history from A01/A02 event data). It has:
 *   - NO xterm instance, NO node-pty, NO WebSocket, NO scrollback replay,
 *   - NO input affordance of any kind.
 * The real embedded terminal lives in the Files & Terminal tab (A18) and stays
 * byte-identical there (A00 shipped the terminal byte-path guard so a restyle
 * here can never move it). AC2 asserts this component's subtree contains no
 * xterm element and constructs no WebSocket.
 *
 * Line kinds map to the prototype spans: t (prompt) / p (pass) / r (fail) /
 * d (dim). Monospace, dark surface, scrollable. Honest empty state when there is
 * no run data — never an invented line (AC5).
 *
 * a11y (AC7): a labelled scrollable region, keyboard-reachable (tabIndex 0 → the
 * summary scrolls with the arrow keys, no mouse), on a dark ground whose spans
 * clear 4.5:1.
 */

import type { ProofKind, ProofLine } from "../../../lib/proofLines";

/** The prototype's coloured span classes; `plain` inherits the hero's default
 *  foreground (no class). */
function spanClass(kind: ProofKind): string | undefined {
  return kind === "plain" ? undefined : kind;
}

interface Props {
  lines: ProofLine[];
}

export function ProofSummary({ lines }: Props) {
  const empty = lines.length === 0;
  return (
    <div
      className="mc-hero"
      role="log"
      aria-label="Proof summary"
      tabIndex={0}
      data-testid="proof-summary"
      data-empty={empty || undefined}
    >
      {empty ? (
        <div className="mc-hero-empty">
          No run data yet {String.fromCodePoint(0x2014)} nothing to prove.
        </div>
      ) : (
        lines.map((line) => (
          <div className="mc-hero-line" key={line.id}>
            {line.spans.map((span, i) => (
              <span key={i} className={spanClass(span.kind)}>
                {span.text}
              </span>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
