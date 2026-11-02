/*
 * MissionDetailView - resolves and renders the DOCUMENT behind a Mission link (an artifact-rail entry, a
 * Run-result button, an inline narrative link, a sub-agent row). It no longer owns a panel of its own:
 * the result is hosted as a TAB of the Info sidebar's Viewer (MissionInfoSidebar `docs`), so every
 * link in the Mission tab opens in the one and only viewer surface.
 *
 *   artifact  - a context-resolved artifact (CONTRACT section 7)          -> MissionArtifactPanel
 *   record    - a legacy rail node (scenarios without a context rail)      -> ArtifactPanel
 *   subrunner - a delegated agent's real answer (`subrunner:<id>` key)     -> SubrunnerPanelHost
 */

import type { ReactNode } from "react";

import type { MissionAgents } from "../../../hooks/useMissionAgents";
import type { ActivityCard } from "../../../lib/missionActivityFeedTypes";
import type { ArtifactDescriptor, CommitArtifact } from "../../../lib/missionContextApi";
import type { RecordNodeView } from "../../../lib/recordNodes";
import { ArtifactPanel } from "./ArtifactPanel";
import { MissionArtifactPanel } from "./MissionArtifactPanel";
import { SubrunnerPanelHost } from "./SubrunnerPanelHost";

export interface DetailSources {
  /** The context rail's visible artifacts (null = legacy rail). */
  artifacts: ArtifactDescriptor[] | null;
  /** A work-completed run can be terminal before its commit is recorded: the final card still opens that detail. */
  commitArtifact: CommitArtifact | null;
  /** Legacy rail nodes (used only when `artifacts` is null). */
  nodes: RecordNodeView[];
  cards: ActivityCard[];
}

export type MissionDetail =
  | { kind: "artifact"; artifact: ArtifactDescriptor }
  | { kind: "record"; node: RecordNodeView }
  | { kind: "subrunner"; card: ActivityCard };

export function resolveDetail(key: string, src: DetailSources): MissionDetail | null {
  const artifact = src.artifacts?.find((a) => a.kind === key) ?? (key === "commit" ? src.commitArtifact : null);
  if (artifact) return { kind: "artifact", artifact };
  if (!src.artifacts) {
    const node = src.nodes.find((n) => n.key === key);
    if (node) return { kind: "record", node };
  }
  if (key.startsWith("subrunner:")) {
    const card = src.cards.find((c) => c.kind === "subrunner" && `subrunner:${c.subrunnerId}` === key);
    if (card) return { kind: "subrunner", card };
  }
  return null;
}

/** The viewer-tab title of a document. */
export function detailLabel(d: MissionDetail): string {
  if (d.kind === "artifact") return d.artifact.label;
  if (d.kind === "record") return d.node.label;
  return d.card.text?.trim() || "Agent";
}

interface Props {
  detail: MissionDetail;
  taskId: string;
  cards: ActivityCard[];
  agents: MissionAgents;
  onClose: () => void;
  onOpenDocument: () => void;
}

export function MissionDetailView({ detail, taskId, cards, agents, onClose, onOpenDocument }: Props): ReactNode {
  if (detail.kind === "artifact") return <MissionArtifactPanel taskId={taskId} artifact={detail.artifact} onClose={onClose} />;
  if (detail.kind === "record") return <ArtifactPanel node={detail.node} onClose={onClose} onOpenDocument={onOpenDocument} />;
  return <SubrunnerPanelHost taskId={taskId} card={detail.card} cards={cards} agents={agents} onClose={onClose} />;
}
