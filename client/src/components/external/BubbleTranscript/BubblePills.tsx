/*
 * BubblePills — Campaign-C C3 BubbleTranscript split (2026-05-26).
 *
 * Small, kind-specific bubble renderers that share the same shape: a
 * one-line muted/colored chip with optional payload text. Extracted from
 * `BubbleTranscript.tsx` `renderBubble` together with the shared
 * `BubbleHeader` + timestamp helper. Keeps `TranscriptRow.tsx` under the
 * 300-LOC cleanup-invariant cap.
 */

import type { ReactNode } from "react";

import type {
  AgentNameEvent,
  CustomTitleEvent,
  ModeChangeEvent,
  ParsedEvent,
  PermissionModeEvent,
  SystemEvent,
  UnknownEvent,
} from "../../../external/session-parser";
import { AttachmentCard } from "../AttachmentCard";

export function BubbleHeader({ role, timestamp }: { role: string; timestamp?: string }) {
  const fmt = formatTimestamp(timestamp);
  return (
    <div
      className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide"
      style={{ color: "var(--color-muted, #6b7280)" }}
    >
      <span>{role}</span>
      {fmt && (
        <span
          className="text-[10px] font-normal normal-case"
          style={{ color: "var(--color-muted, #6b7280)", opacity: 0.75 }}
          title={fmt.iso}
          data-testid="bubble-timestamp"
        >
          {fmt.short}
        </span>
      )}
    </div>
  );
}

export function SystemPill({ event }: { event: SystemEvent }) {
  return (
    <div className="flex justify-start" data-testid="bubble-system">
      <span
        className="inline-flex max-w-[95%] items-center gap-1.5 truncate px-2.5 py-1 text-[11px]"
        style={{
          fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
          color: "var(--color-muted, #6b7280)",
          background: "rgba(107,114,128,0.10)",
          borderRadius: "10px",
        }}
        title={event.text}
      >
        system · <strong style={{ color: "var(--color-text, #1a1a1a)", fontWeight: 500 }}>
          {event.subtype ?? "meta"}
        </strong>
        {event.text && <span className="ml-1 truncate opacity-80">{event.text}</span>}
      </span>
    </div>
  );
}

export function CustomTitlePill({ event }: { event: CustomTitleEvent }) {
  return (
    <div className="flex justify-start" data-testid="bubble-custom-title">
      <span
        className="inline-flex max-w-full items-center gap-1 truncate px-2.5 py-1 text-[11px]"
        style={{
          fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
          color: "var(--info)",
          background: "rgba(59,130,246,0.08)",
          borderRadius: "10px",
          opacity: 0.9,
        }}
      >
        Title set: <strong style={{ color: "var(--info)", fontWeight: 500 }}>{event.title}</strong>
      </span>
    </div>
  );
}

export function AgentNamePill({ event }: { event: AgentNameEvent }) {
  return (
    <div className="flex justify-start" data-testid="bubble-agent-name">
      <span
        className="inline-flex max-w-full items-center gap-1 truncate px-2.5 py-1 text-[11px]"
        style={{
          fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
          color: "var(--color-accent, #857568)",
          background: "rgba(133,117,104,0.10)",
          borderRadius: "10px",
          opacity: 0.9,
        }}
      >
        Agent:{" "}
        <strong style={{ color: "var(--color-primary, #6b5e56)", fontWeight: 500 }}>
          {event.name}
        </strong>
      </span>
    </div>
  );
}

export function PermissionModePill({ event }: { event: PermissionModeEvent }) {
  return (
    <div className="flex justify-start" data-testid="bubble-permission-mode">
      <span
        className="inline-flex max-w-full items-center gap-1 truncate px-2.5 py-1 text-[11px]"
        style={{
          fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
          color: "var(--info)",
          background: "rgba(168,85,247,0.10)",
          borderRadius: "10px",
          opacity: 0.9,
        }}
      >
        Permission mode:{" "}
        <strong style={{ color: "var(--info)", fontWeight: 500 }}>{event.mode}</strong>
      </span>
    </div>
  );
}

/**
 * 2026-05-27 — iterate-2026-05-27-transcript-renderer-scroll AC1.
 * Mirrors `PermissionModePill` (lavender) — both surfaces are session-
 * metadata pills hidden by default under the system toggle.
 */
export function ModeChangePill({ event }: { event: ModeChangeEvent }) {
  return (
    <div className="flex justify-start" data-testid="bubble-mode-change">
      <span
        className="inline-flex max-w-full items-center gap-1 truncate px-2.5 py-1 text-[11px]"
        style={{
          fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
          color: "var(--info)",
          background: "rgba(168,85,247,0.10)",
          borderRadius: "10px",
          opacity: 0.9,
        }}
      >
        Mode:{" "}
        <strong style={{ color: "var(--info)", fontWeight: 500 }}>{event.mode}</strong>
      </span>
    </div>
  );
}

export function UnknownDetails({ event }: { event: UnknownEvent }) {
  return (
    <div className="flex justify-start" data-testid="bubble-unknown">
      <details
        className="max-w-[80%] p-2 text-xs"
        style={{
          border: "1px solid var(--color-warning, #D97706)",
          background: "var(--color-warning-bg, #FEF3C7)",
          color: "var(--color-warning-text, #92400E)",
          borderRadius: "var(--radius-button, 8px)",
        }}
      >
        <summary className="cursor-pointer">Unknown event: {event.originalType}</summary>
        <pre className="mt-1 overflow-x-auto text-[10px]">{JSON.stringify(event.raw, null, 2)}</pre>
      </details>
    </div>
  );
}

export function FallbackChip({ event }: { event: ParsedEvent }) {
  return (
    <div
      className="p-1 text-[10px]"
      style={{
        border: "1px solid var(--color-border, #e0dbd4)",
        background: "var(--color-surface, #ffffff)",
        color: "var(--color-muted, #6b7280)",
        borderRadius: "var(--radius-button, 8px)",
      }}
      data-testid={`bubble-${event.kind}`}
    >
      {event.kind}
    </div>
  );
}

export function renderAttachmentCard(event: ParsedEvent): ReactNode {
  if (event.kind !== "attachment") return null;
  const payload = event.attachment;
  const filename = readStringField(payload, "filename") ?? readStringField(payload, "name");
  if (!filename) return null;
  return <AttachmentCard basename={basenameOf(filename)} />;
}

function basenameOf(p: string): string {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return idx >= 0 ? p.slice(idx + 1) : p;
}

function readStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = (value as Record<string, unknown>)[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function formatTimestamp(iso: string | undefined): { short: string; iso: string } | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return { short: `${hh}:${mm}`, iso };
}
