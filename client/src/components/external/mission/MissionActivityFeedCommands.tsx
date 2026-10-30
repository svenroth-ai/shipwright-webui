/**
 * The command-chip row for one `MissionActivityFeedCard.tsx` `FeedCard` —
 * split out to keep that file under the project's 300-line convention.
 *
 * Collapsed by default behind a single summary line ("N commands"): a card
 * with several tool calls used to render every command as its own
 * always-visible box (reported: "Implement mit einem Befehl bringt nichts",
 * iterate-2026-09-16-mission-feed-render-fidelity). Expanding reveals the
 * existing chip row, where each chip with real untruncated content behind
 * it is independently click-to-expand (iterate-2026-09-05-mission-feed-ux-
 * gaps) — unchanged by this split.
 */
import { useState } from "react";
import { FileChipIcon } from "./MissionFeedIcons";

interface Props {
  commands: string[];
  /** The true tool-call count — falls back to `commands.length` only for a
   *  caller that never set it (24th-round external review catch, openai,
   *  medium: `commands.length` alone under-counts once dedup collapses two
   *  distinct calls sharing one label). See `ActivityCard.commandCount`. */
  commandCount?: number;
  commandFullText?: Record<string, string>;
}

export function FeedCommands({ commands, commandCount, commandFullText }: Props) {
  const [commandsExpanded, setCommandsExpanded] = useState(false);
  const [expandedChip, setExpandedChip] = useState<string | null>(null);

  if (commands.length === 0) return null;
  const count = commandCount ?? commands.length;

  return (
    // No dedicated `.mc-feed-commands` rule (31st-round external review
    // catch, glm, low, declined) — plain block wrapper, no layout of its own;
    // `.mc-feed-expand-btn`/`.mc-feed-chip-row` already carry their own
    // spacing (`mission-operation.css`), so an empty rule here would add
    // nothing.
    <div className="mc-feed-commands">
      <button
        type="button"
        className="mc-feed-expand-btn"
        aria-expanded={commandsExpanded}
        onClick={() => setCommandsExpanded((v) => !v)}
      >
        {commandsExpanded ? "Hide commands" : `${count} command${count === 1 ? "" : "s"}`}
      </button>
      {commandsExpanded && (
        <div className="mc-feed-chip-row">
          {commands.map((command) => {
            // A chip is clickable only when there is real, longer content
            // behind it — reported: "die Befehle kann ich gar nicht
            // anschauen" (a long Bash command could not be inspected past
            // its truncated preview), iterate-2026-09-05-mission-feed-ux-gaps.
            const full = commandFullText?.[command];
            if (!full) return <span className="mc-feed-chip" key={command}><FileChipIcon />{command}</span>;
            const open = expandedChip === command;
            return (
              <span className="mc-feed-chip-wrap" key={command}>
                <button
                  type="button"
                  className="mc-feed-chip mc-feed-chip-clickable"
                  aria-expanded={open}
                  onClick={() => setExpandedChip(open ? null : command)}
                >
                  <FileChipIcon />{command}
                </button>
                {open && (
                  <div className="mc-feed-chip-detail">
                    <pre>{full}</pre>
                  </div>
                )}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
