/*
 * InboxProjectSection — collapsible project-group section (C7 — 2026-05-26).
 *
 * Extracted from InboxPage.tsx lines 289-393 (lifted verbatim).
 *
 * `<details open>` so the user sees everything by default but can collapse
 * noisy projects. Summary row mirrors the header-style "UNASSIGNED · count"
 * pattern from elsewhere in the app and adds a chevron-color chip
 * (iterate 3.7e-b4: project color matches TaskBoard / Projects table).
 */
import { UNASSIGNED_PROJECT_ID } from "../../lib/projectIds";
import { getProjectColor } from "../../lib/projectColor";
import type { ExternalTask } from "../../lib/externalApi";
import type { ProjectGroup } from "./types";
import { InboxCard } from "./InboxCard";
import { inboxItemKey } from "./InboxCard";

export function InboxProjectSection({
  group,
  tasksById,
}: {
  group: ProjectGroup;
  tasksById: Map<string, ExternalTask>;
}) {
  // 3.7e-b4: project color chip. Unassigned bucket uses the muted token
  // (no project → no deterministic color). Real projects use the shared
  // `getProjectColor()` helper so the dot matches TaskBoard / Projects
  // table. `customColor` comes from `project.settings.color` when set by
  // the user via the Project-Settings dialog (iterate 14.8.2).
  const isUnassigned = group.projectId === UNASSIGNED_PROJECT_ID;
  const chipColor = isUnassigned
    ? "var(--color-muted)"
    : getProjectColor(group.projectId, group.project?.settings?.color).hsl;

  return (
    <details
      open
      data-testid={`inbox-project-group-${group.projectId}`}
      style={{
        background: "transparent",
        borderRadius: "var(--radius-card)",
      }}
    >
      {/* on-photo-legibility fix: this project group header + its "(N open)"
          subtitle ride bare on the deck-golden photo (below the 300px scrim
          band). They must use the Weather-Deck ink tokens that flip WHITE under
          `.on-photo` (`--ink` / `--muted`), NOT the legacy `--color-text` /
          `--color-muted` aliases (computed at :root, stay dark → invisible on
          the rigging, low-contrast on the sky). If this same label ever mounts
          inside a card, on-photo.css rule 2 resets these tokens to dark-on-white. */}
      <summary
        data-testid={`inbox-project-group-toggle-${group.projectId}`}
        className="flex cursor-pointer select-none items-center gap-2 outline-none"
        style={{
          listStyle: "none",
          padding: "2px 4px 10px",
          color: "var(--muted)",
        }}
      >
        <span
          aria-hidden="true"
          data-testid={`inbox-group-color-${group.projectId}`}
          className="inline-block shrink-0"
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "9999px",
            background: chipColor,
          }}
        />
        <span
          className="font-semibold uppercase"
          style={{
            fontSize: "12px",
            letterSpacing: "0.6px",
            color: "var(--ink)",
          }}
        >
          {group.projectName}
        </span>
        <span
          style={{
            fontSize: "11px",
            color: "var(--muted)",
            fontWeight: 500,
          }}
        >
          ({group.totalItems} open)
        </span>
      </summary>

      <div className="flex flex-col" style={{ gap: "16px", paddingLeft: "4px" }}>
        {group.sessions.map((sg) => {
          const task = tasksById.get(sg.taskId);
          return (
            <section
              key={sg.sessionUuid}
              data-testid={`inbox-session-${sg.sessionUuid}`}
            >
              {/* Session sub-header — mono UUID chip */}
              <div
                className="mb-2 flex items-center gap-2"
                style={{ paddingLeft: "4px" }}
              >
                <span
                  className="font-mono"
                  style={{
                    fontSize: "10px",
                    color: "var(--muted)",
                    opacity: 0.7,
                  }}
                  data-testid={`inbox-group-project-label-${sg.sessionUuid}`}
                >
                  session {sg.sessionUuid.slice(0, 8)}
                </span>
              </div>

              <div className="flex flex-col" style={{ gap: "12px" }}>
                {sg.items.map((item) => (
                  <InboxCard key={inboxItemKey(item)} item={item} task={task} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </details>
  );
}
