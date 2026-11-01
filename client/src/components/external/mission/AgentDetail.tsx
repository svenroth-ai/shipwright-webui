/*
 * AgentDetail - one agent in the Agents window (M4): a Details tab (who started
 * it, the prompt the parent sent, the answer returned to the parent) and a
 * read-only Transcript tab that renders with the main chat's own feed components
 * (V3, AgentTranscriptFeed). The transcript is fetched only while that tab is
 * open. Same view whether opened from the tree or from a chat subrunner card.
 */

import { useMemo, useState, type ReactNode } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { RefreshCw } from "lucide-react";

import type { SessionSubagent } from "../../../lib/sessionInfoApi";
import type { ExternalTask } from "../../../lib/externalApi";
import type { MissionAgents } from "../../../hooks/useMissionAgents";
import { agentStatusLabel, agentTitle, agentTone } from "../../../lib/agentsTree";
import { AGENT_FEED_PAGE, buildAgentFeed } from "../../../lib/agentTranscriptFeed";
import { formatTokens, shortModel } from "../../../lib/sessionInfoFormat";
import { useSubagentTranscript } from "../../../hooks/useSubagentTranscript";
import { MarkdownChunk } from "../BubbleTranscript/MarkdownChunk";
import { AgentTranscriptFeed } from "./AgentTranscriptFeed";

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

function TranscriptTab({ task, agent, controller }: { task: ExternalTask; agent: SessionSubagent; controller: MissionAgents }) {
  const q = useSubagentTranscript(task.taskId, agent.agentId, true, agent.state === "running");
  const [limit, setLimit] = useState(AGENT_FEED_PAGE);
  const ok = q.data?.status === "ok" ? q.data : null;
  const feed = useMemo(
    () => (ok && ok.content !== "" ? buildAgentFeed(ok.content, { limit, truncated: ok.truncated }) : null),
    [ok, limit],
  );
  let body: ReactNode;
  if (q.isLoading) body = <p className="ag-empty">Loading transcript...</p>;
  else if (q.isError) body = <p className="ag-empty" role="alert">Could not load the transcript.</p>;
  else if (!ok) body = <p className="ag-empty">No transcript file exists for this agent.</p>;
  else if (!feed) body = <p className="ag-empty">The latest entry is too large to show here.</p>;
  else body = <AgentTranscriptFeed feed={feed} task={task} onOpenAgent={controller.select} canOpenAgent={controller.canOpen} />;
  const older = feed !== null && feed.total > feed.shown;
  return (
    <div className="ag-transcript" data-testid="agent-transcript">
      <div className="tr-bar">
        <span className="tr-bar-count" data-testid="agent-transcript-count">
          {feed ? (older ? `Showing the latest ${feed.shown} of ${feed.total} events` : `${feed.total} events`) : ""}
          {ok?.truncated ? " (start of a long transcript not shown)" : ""}
        </span>
        {older && (
          <button type="button" className="tr-btn" onClick={() => setLimit((n) => n + AGENT_FEED_PAGE)} data-testid="agent-transcript-older">
            Load older
          </button>
        )}
        <button type="button" className="ag-icon-btn" onClick={() => void q.refetch()} aria-label="Refresh transcript" data-testid="agent-transcript-refresh">
          <RefreshCw size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="ag-transcript-body">{body}</div>
    </div>
  );
}

export function AgentDetail({ task, agent, parent, controller, report = null }: {
  task: ExternalTask;
  agent: SessionSubagent;
  parent: SessionSubagent | null;
  controller: MissionAgents;
  report?: string | null;
}) {
  const [tab, setTab] = useState("details");
  const meta = [
    agent.model ? shortModel(agent.model) : null,
    duration(agent.durationMs),
    agent.tokens !== null ? `${formatTokens(agent.tokens)} tokens` : null,
    agent.toolUses !== null ? `${agent.toolUses} tool calls` : null,
  ].filter(Boolean);
  const running = agent.state === "running";
  // Only a completed agent's last message IS its answer; for killed/failed/stopped it is mid-work prose.
  const completed = agent.status === "completed";
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
        <Block label="Prompt from the session" text={agent.prompt} testId="agent-prompt" empty="The prompt was not recorded." />
        {report && !running && <Block label="Report returned to the session" text={report} testId="agent-report" empty="" />}
        <Block
          label={running || completed ? "Answer returned to the session" : "Last message from the agent"}
          text={running ? null : agent.answer}
          testId="agent-answer"
          empty={running ? "Still running - no answer yet." : "No answer was recorded."}
        />
      </Tabs.Content>
      <Tabs.Content value="transcript" className="ag-pane ag-pane-fill">
        <TranscriptTab task={task} agent={agent} controller={controller} />
      </Tabs.Content>
    </Tabs.Root>
  );
}
