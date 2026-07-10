/*
 * designReviewApi.ts — client wrappers for the single-session design-gate
 * mockup review surface (FR-01.45). Own lib file (externalApi.ts is at its
 * bloat ceiling). Read the gate, host the emitted viewer, write the round
 * feedback file.
 */

import { EXTERNAL_API, httpJson } from "./externalApi";

/** Mirror of the server `DesignGate` shape (core/run-loop-state-reader.ts). The
 *  component gates on `active` only — never on the `phase` string (DO-NOT #11). */
export interface DesignGate {
  active: boolean;
  phaseTaskId: string | null;
  phase: string | null;
}

export interface DesignFeedbackWriteResult {
  written: boolean;
  round: number;
  /** Project-root-relative POSIX path of the written round file. */
  path: string;
}

/**
 * RELATIVE URL for the hosted viewer (plan review R7). Same-origin as the app
 * (dev: Vite proxies /api to Hono; prod: single origin) so the iframe's
 * localStorage + postMessage behave and the `event.origin === location.origin`
 * check on the host holds. Ends in `/index.html` so the viewer's relative
 * `screens/*.html` iframes resolve under `.../designs/`.
 */
export function designsViewerUrl(projectId: string): string {
  return `${EXTERNAL_API}/projects/${encodeURIComponent(projectId)}/designs/index.html`;
}

export async function getDesignGate(projectId: string): Promise<DesignGate> {
  return await httpJson<DesignGate>(
    `${EXTERNAL_API}/projects/${encodeURIComponent(projectId)}/design-gate`,
  );
}

/** POST the viewer's exported markdown; the server computes the round from disk
 *  and writes `.shipwright/designs/design-feedback-round{N}.md`. */
export async function writeDesignFeedback(
  projectId: string,
  markdown: string,
): Promise<DesignFeedbackWriteResult> {
  return await httpJson<DesignFeedbackWriteResult>(
    `${EXTERNAL_API}/projects/${encodeURIComponent(projectId)}/design-feedback`,
    {
      method: "POST",
      headers: { "Content-Type": "text/markdown" },
      body: markdown,
    },
  );
}

/** The postMessage envelope the injected viewer bridge posts to the host. */
export const DESIGN_FEEDBACK_MESSAGE_TYPE = "shipwright:design-feedback" as const;

export interface DesignFeedbackMessage {
  type: typeof DESIGN_FEEDBACK_MESSAGE_TYPE;
  markdown: string;
}

/** True when `data` is a well-formed design-feedback postMessage payload. */
export function isDesignFeedbackMessage(data: unknown): data is DesignFeedbackMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === DESIGN_FEEDBACK_MESSAGE_TYPE &&
    typeof (data as { markdown?: unknown }).markdown === "string"
  );
}
