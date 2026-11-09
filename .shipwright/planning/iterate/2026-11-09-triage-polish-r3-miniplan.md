# Mini-plan: triage-polish-r3

1. **Help** (`triageHelpText.ts`, `TriageHelp.tsx`, `triageHelpDoc.ts`): rename the section to "What Fix now does"; rewrite every `todo` as the effect of Fix now; drop `severityHelp`, `req3`, the `req3-campaign` alias and `tooling`; GitHub help varies by item kind (`sourceHelp(source, title)`); regenerate the doc; Opus wording review.
2. **Project dropdown** (`ProjectFilterDropdown.tsx`): `showCounts` prop (default true); Triage passes false.
3. **Grid** (`TriageGroupList.tsx`, parked list in `TriagePage.tsx`): `grid grid-cols-1 min-[900px]:grid-cols-2 min-[1500px]:grid-cols-3`.
4. **Card** (`TriageItemCard.tsx`, `TriageBadgeUI.tsx`): mockup-style source label, coloured project pill (`projectColor`), 12px dark secondary text, no severity "?".
5. **Detail dialog** (`TriageDetailHeader/Meta/Modal/Actions`): pills identical to the card, status badge dropped, findings explained inline, raw detail folded, fields in a collapsed "Details" section, Edit button in the action row.
6. **Strip** (`TriageActiveFilters.tsx`): solid surface, dark text.
7. **Filter menu** (`TriageFilterMenu.tsx`): Reset view first.
8. **Tests:** update affected unit tests, new Playwright spec `triage-polish-r3.spec.ts`, regenerate the visual baseline.

**Alternative rejected:** detecting project-specific sources server-side (needs per-project config, out of scope) — generic fallback instead.
