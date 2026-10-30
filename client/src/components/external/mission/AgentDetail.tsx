/*
 * AgentDetail - one agent in the Agents window (M4): a Details tab (who started
 * it, the prompt the parent sent, the answer returned to the parent) and a
 * read-only Transcript tab that reuses the main chat's BubbleTranscript. The
 * transcript is fetched only while that tab is open. Same view whether opened
 * from the tree or from a chat subrunner card.
 */

import { useState, type ReactNode } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { RefreshCw } from "lucide-react";

import type { SessionSubagent } from "../../../lib/sessionInfoApi";
import { agentStatusLabel, agentTitle, agentTone } from "../../../lib/agentsTree";
import { formatTokens, shortModel } from "../../../lib/sessionInfoFormat";
import { useSubagentTranscript } from "../../../hooks/useSubagentTranscript";
import { BubbleTranscript } from "../BubbleTranscript";
import { MarkdownChunk } from "../BubbleTranscript/MarkdownChunk";

function duration(ms: number | null): string | null {
  if (ms === null) return null;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function Block({ label, text, testId, empty }: { label: string; text: string | null; testId: string; empty: string }) {
  return (
    <section className="ag-block" data-testid={testId}>
      <h4 className="ag-block-h">{label}</h4>
      {text ? <div className="ag-text"><MarkdownChunk content={text} /></div> : <p className="ag-empty">{empty}</p>}
    </section>
  );
}

function TranscriptTab({ taskId, agent }: { taskId: string; agent: SessionSubagent }) {
  const q = useSubagentTranscript(taskId, agent.agentId, true, agent.state === "running");
  let body: ReactNode;
  if (q.isLoading) body = <p className="ag-empty">Loading transcript...</p>;
  else if (q.isError) body = <p className="ag-empty" role="alert">Could not load the transcript.</p>;
  else if (q.data?.status !== "ok") body = <p className="ag-empty">No transcript file exists for this agent.</p>;
  else if (q.data.content === "") body = <p className="ag-empty">The latest entry is too large to show here.</p>;
  else body = <BubbleTranscript content={q.data.content} />;
  return (
    <div className="ag-transcript" data-testid="agent-transcript">
      <div className="ag-transcript-bar">
        {q.data?.status === "ok" && q.data.truncated && <span className="ag-note">Showing the latest part of a long transcript.</span>}
        <button type="button" className="ag-icon-btn" onClick={() => void q.refetch()} aria-label="Refresh transcript" data-testid="agent-transcript-refresh">
          <RefreshCw size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="ag-transcript-body">{body}</div>
    </div>
  );
}

export function AgentDetail({ taskId, agent, parent }: { taskId: string; agent: SessionSubagent; parent: SessionSubagent | null }) {
  const [tab, setTab] = useState("details");
  const meta = [
    agent.model ? shortModel(agent.model) : null,
    duration(agent.durationMs),
    agent.tokens !== null ? `${formatTokens(agent.tokens)} tokens` : null,
    agent.toolUses !== null ? `${agent.toolUses} tool calls` : null,
  ].filter(Boolean);
  const running = agent.state === "running";
  return (
    <Tabs.Root value={tab} onValueChange={setTab} className="ag-detail" data-testid="agent-detail" data-agent-id={agent.agentId}>
      <header className="ag-detail-head">
        <h3 className="ag-detail-title">{agentTitle(agent)}</h3>
        <span className="ag-pill" data-tone={agentTone(agent)} data-testid="agent-status">{agentStatusLabel(agent)}</span>
        <p className="ag-detail-sub">
          {agent.agentType ?? "agent"} {"·"} started by {parent ? agentTitle(parent) : "the session"}
          {meta.length ? ` · ${meta.join(" · ")}` : ""}
        </p>
      </header>
      <Tabs.List className="ag-tabs" aria-label="Agent views">
        <Tabs.Trigger className="ag-tab" value="details" data-testid="agent-tab-details">Details</Tabs.Trigger>
        <Tabs.Trigger className="ag-tab" value="transcript" data-testid="agent-tab-transcript">Transcript</Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="details" className="ag-pane">
        <Block label="Prompt from the parent" text={agent.prompt} testId="agent-prompt" empty="The prompt was not recorded." />
        <Block
          label="Answer returned to the parent"
          text={running ? null : agent.answer}
          testId="agent-answer"
          empty={running ? "Still running - no answer yet." : "No answer was recorded."}
        />
      </Tabs.Content>
      <Tabs.Content value="transcript" className="ag-pane ag-pane-fill">
        <TranscriptTab taskId={taskId} agent={agent} />
      </Tabs.Content>
    </Tabs.Root>
  );
}
