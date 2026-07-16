/*
 * TaskDetailHeader — composition root for the header bar (FR-03.30).
 *
 * A13 (FR-01.57) restyled the top row into Mission Control's `.mc-top` and moved
 * the implementation into `mission/MissionTopRow.tsx`. This module now DELEGATES
 * to it, keeping the stable `TaskDetailHeader` import + `data-testid` surface that
 * the page and the test corpus target. All behaviour (CTA state machine, the `⋯`
 * HeaderMenu, StateBadge, TitleEdit, breadcrumb, sub-line, session-metadata
 * disclosure) lives in MissionTopRow unchanged.
 *
 * Regression guards: NO chat composer (DO-NOT #3); Resume auto-executes via
 * LaunchCoordinator (DO-NOT #5).
 */

import type { ExternalTask } from "../../lib/externalApi";
import { MissionTopRow } from "./mission/MissionTopRow";

interface Props {
  task: ExternalTask;
  /** Model label sourced from TaskDetailPage's single transcript poller. */
  modelName?: string | null;
}

export function TaskDetailHeader({ task, modelName }: Props) {
  return <MissionTopRow task={task} modelName={modelName} />;
}
