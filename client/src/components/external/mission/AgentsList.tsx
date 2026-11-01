/*
 * AgentsList - the Agents window's tree (M4): sections Active and Finished,
 * each a "who started whom" forest (indent = depth). A root whose parent sits
 * in the other section says who started it.
 */

import type { AgentNode, AgentSections } from "../../../lib/agentsTree";
import { agentStatusLabel, agentTitle, agentTone } from "../../../lib/agentsTree";

interface Props {
  sections: AgentSections;
  selectedId: string | null;
  onSelect: (agentId: string) => void;
}

function Row({ node, selected, onSelect }: { node: AgentNode; selected: boolean; onSelect: (id: string) => void }) {
  const a = node.agent;
  return (
    <li>
      <button
        type="button"
        className="ag-row"
        style={{ paddingLeft: 10 + node.depth * 18 }}
        aria-current={selected ? "true" : undefined}
        data-selected={selected ? "true" : undefined}
        data-depth={node.depth}
        data-testid={`agent-row-${a.agentId}`}
        onClick={() => onSelect(a.agentId)}
      >
        {a.state === "running" && <span className="ag-dot" data-tone="run" aria-hidden="true" />}
        <span className="ag-row-main">
          <span className="ag-row-title"><span className="sr-only">Level {node.depth + 1}: </span>{agentTitle(a)}</span>
          <span className="ag-row-sub">
            {a.agentType ?? "agent"}
            {node.parentLabel ? ` · started by ${node.parentLabel}` : ""}
          </span>
        </span>
        <span className="ag-pill" data-tone={agentTone(a)}>{agentStatusLabel(a)}</span>
      </button>
    </li>
  );
}

interface SectionProps {
  label: string;
  id: string;
  nodes: AgentNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function Section({ label, id, nodes, selectedId, onSelect }: SectionProps) {
  return (
    <section aria-labelledby={`ag-sec-${id}`} data-testid={`agents-section-${id}`}>
      <h3 className="ag-sec-h" id={`ag-sec-${id}`}>{label} <span className="ag-count">{nodes.length}</span></h3>
      {nodes.length === 0 ? (
        <p className="ag-empty">None.</p>
      ) : (
        <ul className="ag-tree">
          {nodes.map((n) => <Row key={n.agent.agentId} node={n} selected={n.agent.agentId === selectedId} onSelect={onSelect} />)}
        </ul>
      )}
    </section>
  );
}

export function AgentsList({ sections, selectedId, onSelect }: Props) {
  return (
    <nav className="ag-list" aria-label="Agents" data-testid="agents-list">
      <Section label="Active" id="active" nodes={sections.active} selectedId={selectedId} onSelect={onSelect} />
      <Section label="Finished" id="finished" nodes={sections.finished} selectedId={selectedId} onSelect={onSelect} />
    </nav>
  );
}
