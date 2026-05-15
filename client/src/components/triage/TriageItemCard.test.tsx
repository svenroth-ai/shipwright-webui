/*
 * TriageItemCard.test.tsx — visual regression guard for the white-surface
 * card restyle (iterate-20260515-triage-card-styling).
 *
 * The card previously rendered with no background fill, so the warm-beige
 * page (`--color-bg`) showed through a `border-stone-200` outline —
 * "beige on beige", low contrast. These tests pin the card to the white
 * `--color-surface` token plus a subtle resting shadow that lifts on hover.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { TriageItemCard } from "./TriageItemCard";
import type { TriageItem } from "../../lib/triageApi";

const item: TriageItem = {
  id: "trg-bbbb2222",
  ts: "2026-05-14T09:00:00Z",
  originalTs: "2026-05-14T09:00:00Z",
  source: "compliance",
  severity: "medium",
  kind: "maintenance",
  title: "Traceability matrix drift",
  detail: "FR-01.30 maps to a stale file path.",
  evidencePath: null,
  runId: null,
  commit: null,
  dedupKey: "compliance:matrix",
  status: "triage",
  suggestedPriority: "P2",
  suggestedDomain: "engineering",
  statusBy: null,
  statusReason: null,
  promotedTaskId: null,
};

describe("TriageItemCard styling", () => {
  it("renders on the white --color-surface with a resting shadow (not beige-on-beige)", () => {
    render(<TriageItemCard item={item} onClick={vi.fn()} />);
    const card = screen.getByTestId(`triage-item-${item.id}`);
    expect(card).toHaveClass("bg-[var(--color-surface)]");
    expect(card).toHaveClass("shadow-[var(--shadow-sm)]");
    expect(card).toHaveClass("border-[var(--color-border)]");
  });

  it("lifts to the stronger hover shadow on hover", () => {
    render(<TriageItemCard item={item} onClick={vi.fn()} />);
    const card = screen.getByTestId(`triage-item-${item.id}`);
    expect(card).toHaveClass("hover:shadow-[var(--shadow-card-hover)]");
  });
});
