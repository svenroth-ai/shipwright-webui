/*
 * RecordNode — one node of "The Record" spine (FR-01.55, A11).
 *
 * A controlled, presentational button: it owns NO state. The dot conveys
 * state visually; the label + an sr-only state word convey it NON-visually
 * (a11y AC7 — state is dot + label, never colour alone). Wording (label +
 * receipt) is pre-derived by recordNodes.ts from A10's narrator — this
 * component invents no copy.
 */

import type { RecordNodeView } from "../../../lib/recordNodes";

const STATE_WORD: Record<RecordNodeView["state"], string> = {
  done: "done",
  now: "in progress",
  pending: "pending",
};

interface Props {
  node: RecordNodeView;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
}

export function RecordNode({ node, active, collapsed, onClick }: Props) {
  const stateWord = STATE_WORD[node.state];
  return (
    <button
      type="button"
      id={`record-node-${node.key}`}
      className={`rec-node ${node.state}${active ? " active" : ""}`}
      onClick={onClick}
      aria-current={node.state === "now" ? "step" : undefined}
      aria-label={`${node.label}, ${stateWord}${node.receipt ? ` — ${node.receipt}` : ""}`}
      title={collapsed ? `${node.label} — ${stateWord}` : undefined}
      data-testid={`record-node-${node.key}`}
      data-state={node.state}
    >
      <span className="rn-dot" aria-hidden="true" />
      <span className="rn-body">
        <span className="rn-k">{node.label}</span>
        {/* The visible receipt is honest-or-absent; the state word is always
            present for screen readers so state never rides colour alone. */}
        <span className="sr-only"> — {stateWord}</span>
        {node.receipt ? <span className="rn-r">{node.receipt}</span> : null}
      </span>
      <span className="rn-go" aria-hidden="true">
        ›
      </span>
    </button>
  );
}
