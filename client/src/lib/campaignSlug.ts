/*
 * campaignSlug.ts — recover a campaign slug from an orchestrator task title
 * (FR-01.67, iterate-2026-07-17-mission-stages-campaign).
 *
 * An autonomous-campaign orchestrator task is created with the title
 * `campaign: <slug>` (`useLaunchCampaign.launchCampaign`, the sole durable webui
 * breadcrumb linking a task back to its campaign). This is the inverse: it parses
 * that title back to the slug so the Mission tab can look the campaign up in the
 * existing `GET /api/campaigns/:projectId` payload.
 *
 * Honesty (AC4): the match is PREFIX-ANCHORED and case-SENSITIVE on the exact
 * producer breadcrumb `campaign: ` — a human-typed "Campaign: Q3 planning" or a
 * title that merely mentions the word never parses. An empty/whitespace slug
 * yields null (never a fabricated slug).
 */

/** The producer breadcrumb → `<slug>`, or null when the title is not a campaign
 *  orchestrator title (or carries no slug). */
export function parseCampaignSlug(title: string | null | undefined): string | null {
  if (typeof title !== "string") return null;
  const match = /^campaign:\s*(\S.*)$/.exec(title.trim());
  if (!match) return null;
  const slug = match[1].trim();
  return slug.length > 0 ? slug : null;
}
