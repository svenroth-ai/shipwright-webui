# Mini-Plan: start-campaign-action

- **Run ID:** iterate-2026-06-03-start-campaign-action · **medium** · feature
- **Risk:** `touches_public_api` (new POST route) + relaxes read-only-on-campaign-state → ADR.

## Files

### Server (new)
1. `server/src/core/campaign-write.ts` — `setCampaignStatus(campaignDir, status: CampaignLifecycleStatus)`:
   read-modify-write. If `status.json` exists → parse, set top-level `status`,
   write back (preserve everything else, indent 2). Else read `campaign.md`,
   replace existing frontmatter `status:` line or insert one into the `---`
   block, write back. Throws `CampaignWriteError`. Caller holds the lock.
   Mirrors `triage-write.ts` (error class + structure). `CAMPAIGN_LIFECYCLE`
   reuse from `campaign-status-json.ts`.
2. `server/src/core/campaign-write.test.ts` — status.json path, frontmatter
   path, scoped-write (sub_iterates untouched), invalid status rejected,
   write-failure → CampaignWriteError.

### Server (modify)
3. `server/src/routes/campaigns.ts` — `CampaignRoutesDeps` gains
   `lock: (path) => Promise<() => Promise<void>>`. New `POST
   /api/campaigns/:projectId/:slug/start`: getProjectById→404; resolveCampaignsDir
   (403 traversal / 404 invalid); resolve+realpath the `<slug>` dir within
   campaignsDir (404 if missing/escapes); acquire lock (503 on ELOCKED);
   `setCampaignStatus(dir,"active")`; 200 `{slug,status:"active"}`. Idempotent.
   `+ campaigns.test.ts` start cases.
4. `server/src/routes/triage.ts` — `TriageRoutesDeps` gains optional
   `listCampaignRefs?: (projectId) => Array<{expandsTriage: string|null; slug: string; status: string|null}>`.
   GET handler calls it once, builds a `triageId → {slug,status}` map, enriches
   each returned item with `campaignSlug`/`campaignStatus`. **No campaign import.**
5. `server/src/types/triage.ts` + `client/src/lib/triageApi.ts` — `TriageItem`
   gains optional `campaignSlug?: string|null; campaignStatus?: string|null`
   (mirrored both sides per ADR-080).
6. `server/src/index.ts` — campaigns mount gains `lock: createTriageLock()`;
   triage mount gains `listCampaignRefs: (projectId) => { resolve project →
   resolveCampaignsDir → readCampaigns → map to {expandsTriage,slug,status} }`
   (index.ts is the composition root → may import campaign-store + campaign-paths).

### Client (modify)
7. `client/src/lib/campaignsApi.ts` — `startCampaign(projectId, slug): Promise<{slug,status}>` (POST).
8. `client/src/components/triage/TriageDetailModal.tsx` — when `item.campaignStatus`
   is set: `draft` → primary "Start Campaign" (onClick: `startCampaign` → on ok
   `setActiveProjectId(projectId)` + `navigate("/")`); `active` → "Go to board"
   (same nav, no POST); `complete` → no campaign button; Fix-now demoted to
   secondary for these items. Non-campaign items unchanged.
   `+ TriageDetailModal.test.tsx` (or new) cases.

### Docs / ADR
9. `.shipwright/planning/01-adopted/spec.md` FR-01.33 MODIFY AC; `architecture.md`
   note; decision-drop ADR (read-only relaxation, cites triage-write precedent);
   doc-sync token `campaign-write`.

### E2E
10. `client/e2e/flows/start-campaign-action.spec.ts` (F0.5).

## Work breakdown (TDD, sequential)
1. campaign-write.ts (RED tests: status.json + frontmatter + scoped) → impl.
2. campaigns POST start route (RED: 200/404/403/idempotent) → impl + index mount lock.
3. triage enrichment dep (RED: item gains campaignSlug/status via injected dep; triage.ts has no campaign import) → impl + index wiring.
4. client startCampaign + TriageItem fields.
5. TriageDetailModal Start-Campaign / Go-to-board / Fix-now-demote (RED render+click) → impl.
6. docs + ADR + doc-sync token.
7. E2E author + execute.

## Test strategy
- Server: temp dirs; campaign-write parity fixtures (producer format); route tests with injected lock (in-process mutex) + getProjectById; triage enrichment test asserts the injected dep is used + no campaign import (extend `campaigns-no-triage-coupling`).
- Client: vi.mock api + useProjectFilter/navigate; RTL render of the modal by campaignStatus.
- Boundary: read-after-write (start → GET reports active) + scoped-write fixture.
- E2E: isolated built stack, draft campaign + umbrella triage item.

## Alternative (considered, rejected)
**Option B — shell out to `campaign_progress.py start`** (subprocess, shell:false,
like Preview): keeps the producer as sole writer. **Rejected:** `start` requires
a `status.json` and hard-errors on frontmatter-only hand-authored campaigns
(e.g. `compliance-detective-realign`), so it can't start our existing campaigns;
also adds a runtime tooling+uv dependency on the server host. **Client-side
triage↔campaign correlation** (Triage fetches `useCampaigns`): rejected — it
imports campaign code into the Triage surface, breaking the AC-8 boundary;
server-side injected-dep enrichment keeps Triage decoupled.

## Read-only relaxation (ADR)
WebUI was read-only on campaign state (Architecture rule 1). This adds ONE narrow,
operator-initiated, lock-protected write (campaign lifecycle status only) —
exactly the `triage-write.ts` pattern the project already sanctioned (ADR-101/106).
Documented as an ADR; the write touches nothing but the `status` field.
