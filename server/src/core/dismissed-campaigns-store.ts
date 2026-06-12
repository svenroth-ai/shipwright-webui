/*
 * dismissed-campaigns-store.ts — webui-owned "board quittance" for campaigns.
 *
 * A campaign whose planning dir is gitignored/cleaned up surfaces on the board
 * purely from the tracked event log (the `derivedFromEvents` SYNTHESIZE path in
 * `campaign-events.ts`). Such a card can NEVER auto-hide — events reveal only
 * completed sub-iterates, never whether pending ones remain — so a genuinely
 * finished campaign lingers forever. This store records an operator's manual
 * "Erledigt" acknowledgment so the board can hide it (reversible via restore).
 *
 * IMPORTANT — this is NOT a producer status write. WebUI is read-only on
 * campaign / run-config producer state (CLAUDE.md DO-NOT #12); we do NOT write
 * `status: complete` into any `.shipwright/.../campaigns/<slug>/`. The automatic
 * counterpart (a producer-emitted terminal `campaign_completed` event) is
 * tracked as monorepo triage trg-7580f4fe and will feed the same client gate.
 *
 * Persistence: a single JSON file in the webui registry dir
 * (`${registryDir}/dismissed-campaigns.json`), beside `sdk-sessions.json`, keyed
 * by `projectId` → list of dismissed campaign slugs. NOT in any target project
 * repo, NOT in a worktree.
 *
 *   { "schemaVersion": 1, "dismissed": { "<projectId>": ["<slug>", …] } }
 *
 * Reads are lock-free + tolerant (the board annotation polls at 3 s; a torn read
 * of a half-written file → empty set → self-heals next poll). Mutations
 * (dismiss / restore) are a locked read-modify-write via `proper-lockfile`
 * (multi-writer rule, CLAUDE.md DO-NOT #6), mirroring `SdkSessionsStore.persist`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { getConfig } from "../config.js";
import { createTriageLock } from "./triage-lock.js";

const SCHEMA_VERSION = 1 as const;

interface DismissedFile {
  schemaVersion: number;
  /** projectId → dismissed campaign slugs. */
  dismissed: Record<string, string[]>;
}

export interface DismissedStoreDeps {
  /** Optional proper-lockfile wrapper; omitted in unit tests that don't
   *  exercise the lock. Production wires the collision-safe `.weblock` lock. */
  lock?: (p: string) => Promise<() => Promise<void>>;
}

/**
 * The narrow surface the campaigns route depends on. Lets route tests inject a
 * fake (e.g. one whose `dismiss` throws ELOCKED) without a real file/lock.
 */
export interface DismissedCampaignsApi {
  listDismissed(projectId: string): Set<string>;
  dismiss(projectId: string, slug: string): Promise<void>;
  restore(projectId: string, slug: string): Promise<void>;
}

function emptyFile(): DismissedFile {
  return { schemaVersion: SCHEMA_VERSION, dismissed: {} };
}

export class DismissedCampaignsStore implements DismissedCampaignsApi {
  private readonly path: string;
  private readonly deps: DismissedStoreDeps;

  constructor(filePath: string, deps: DismissedStoreDeps = {}) {
    this.path = filePath;
    this.deps = deps;
  }

  /** Lock-free tolerant read of the dismissed slugs for one project. */
  listDismissed(projectId: string): Set<string> {
    const slugs = this.readRaw().dismissed[projectId];
    return new Set(Array.isArray(slugs) ? slugs.filter((s) => typeof s === "string") : []);
  }

  isDismissed(projectId: string, slug: string): boolean {
    return this.listDismissed(projectId).has(slug);
  }

  /** Hide a campaign from the board. Idempotent. */
  async dismiss(projectId: string, slug: string): Promise<void> {
    await this.mutate(projectId, (set) => set.add(slug));
  }

  /** Un-hide a previously dismissed campaign. Idempotent. */
  async restore(projectId: string, slug: string): Promise<void> {
    await this.mutate(projectId, (set) => {
      set.delete(slug);
    });
  }

  // -- internals ----------------------------------------------------------

  /** Tolerant read: missing / unreadable / corrupt / wrong-shape → empty. */
  private readRaw(): DismissedFile {
    if (!existsSync(this.path)) return emptyFile();
    let text: string;
    try {
      text = readFileSync(this.path, "utf-8");
    } catch {
      return emptyFile();
    }
    if (!text.trim()) return emptyFile();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return emptyFile();
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return emptyFile();
    }
    const dismissed = (parsed as DismissedFile).dismissed;
    if (typeof dismissed !== "object" || dismissed === null || Array.isArray(dismissed)) {
      return emptyFile();
    }
    return { schemaVersion: SCHEMA_VERSION, dismissed: dismissed as Record<string, string[]> };
  }

  /**
   * Locked read-modify-write. The set mutation runs INSIDE the lock so two
   * concurrent writers can't lose each other's change. Writes only when the set
   * actually changed (idempotent dismiss/restore touch nothing). The lock is
   * always released, even when the write throws.
   */
  private async mutate(projectId: string, fn: (set: Set<string>) => void): Promise<void> {
    this.ensureFile();
    const release = this.deps.lock ? await this.deps.lock(this.path) : null;
    try {
      const data = this.readRaw();
      const before = new Set(
        Array.isArray(data.dismissed[projectId]) ? data.dismissed[projectId] : [],
      );
      const set = new Set(before);
      fn(set);
      if (set.size === before.size && [...set].every((s) => before.has(s))) {
        return; // no change → no write
      }
      if (set.size === 0) {
        delete data.dismissed[projectId];
      } else {
        data.dismissed[projectId] = [...set];
      }
      data.schemaVersion = SCHEMA_VERSION;
      writeFileSync(this.path, JSON.stringify(data, null, 2));
    } finally {
      if (release) await release();
    }
  }

  /** Create the parent dir + an empty file so proper-lockfile can lstat it. */
  private ensureFile(): void {
    const dirName = path.dirname(this.path);
    if (!existsSync(dirName)) mkdirSync(dirName, { recursive: true });
    if (!existsSync(this.path)) writeFileSync(this.path, "");
  }
}

// -- default singleton --------------------------------------------------------

let defaultStore: DismissedCampaignsStore | null = null;

/**
 * Memoized store rooted at `${registryDir}/dismissed-campaigns.json` with the
 * collision-safe `.weblock` lock. The campaigns route resolves this lazily so
 * `index.ts` (a grandfathered bloat-baseline file) needs no wiring change; tests
 * inject their own store instead of calling this.
 */
export function getDefaultDismissedStore(): DismissedCampaignsStore {
  if (!defaultStore) {
    const filePath = path.join(getConfig().registryDir, "dismissed-campaigns.json");
    defaultStore = new DismissedCampaignsStore(filePath, { lock: createTriageLock() });
  }
  return defaultStore;
}
