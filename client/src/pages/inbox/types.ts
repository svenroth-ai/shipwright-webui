/*
 * Shared types for the Inbox page split (C7 — 2026-05-26).
 *
 * These types were file-local in `InboxPage.tsx` before the split. They are
 * composed from existing domain types (`InboxItem`, `Project`) — no parallel
 * hand-rolled DTOs (per external-plan-review medium finding #6).
 */
import type { InboxItem } from "../../lib/externalApi";
import type { Project } from "../../types";

export interface SessionGroup {
  sessionUuid: string;
  taskId: string;
  taskTitle: string;
  items: InboxItem[];
}

export interface ProjectGroup {
  projectId: string;
  projectName: string;
  /**
   * Resolved Project object, so the group header can read
   * `settings.color` for the color-chip override. Absent for the
   * synthesized "Unassigned" bucket.
   */
  project?: Project;
  sessions: SessionGroup[];
  totalItems: number;
}
