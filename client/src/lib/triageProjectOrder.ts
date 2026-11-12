/*
 * triageProjectOrder.ts — the user's own order of the project lanes on the
 * Triage page (iterate-2026-11-12-triage-lanes-rows). Pure helpers; the order
 * itself is persisted by triageViewStorage. A stored order may name projects
 * that no longer exist and may miss new ones, so both are tolerated: unknown
 * ids are ignored, projects without a saved place keep their natural order at
 * the end.
 */

/** `items` re-sorted by `order`; items not in `order` follow in input order. */
export function applyProjectOrder<T extends { id: string }>(
  items: readonly T[],
  order: readonly string[],
): T[] {
  if (order.length === 0) return [...items];
  const rank = new Map(order.map((id, i) => [id, i] as const));
  const known = items.filter((p) => rank.has(p.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  const rest = items.filter((p) => !rank.has(p.id));
  return [...known, ...rest];
}

/**
 * `order` after the project `movedId` takes the slot `overId` occupies (the
 * others shift). Pass the FULL current order (every project, also those a
 * filter currently hides) so hidden projects keep their place.
 */
export function moveProject(order: readonly string[], movedId: string, overId: string): string[] {
  // A lane whose project vanished is not in the saved order: add it first so it can still move.
  const next = [...order];
  for (const id of [movedId, overId]) if (!next.includes(id)) next.push(id);
  const from = next.indexOf(movedId);
  const to = next.indexOf(overId);
  if (from === to) return [...order];
  next.splice(from, 1);
  next.splice(to, 0, movedId);
  return next;
}
