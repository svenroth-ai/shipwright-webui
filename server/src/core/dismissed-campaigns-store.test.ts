import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { DismissedCampaignsStore } from "./dismissed-campaigns-store.js";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "dismissed-store-"));
  // Nested so the store has to create the parent dir (mkdir parity).
  file = path.join(dir, "registry", "dismissed-campaigns.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("DismissedCampaignsStore", () => {
  it("returns an empty set / false when the file is missing (read does not create it)", () => {
    const s = new DismissedCampaignsStore(file);
    expect(s.listDismissed("p1")).toEqual(new Set());
    expect(s.isDismissed("p1", "slug")).toBe(false);
  });

  it("dismiss persists a slug under its projectId, written as schemaVersion-1 JSON", async () => {
    const s = new DismissedCampaignsStore(file);
    await s.dismiss("p1", "2026-06-07-tracked-campaign-status");
    expect(s.isDismissed("p1", "2026-06-07-tracked-campaign-status")).toBe(true);
    const raw = JSON.parse(readFileSync(file, "utf-8"));
    expect(raw.schemaVersion).toBe(1);
    expect(raw.dismissed.p1).toEqual(["2026-06-07-tracked-campaign-status"]);
  });

  it("keys dismissals by projectId — no cross-project leakage", async () => {
    const s = new DismissedCampaignsStore(file);
    await s.dismiss("p1", "slug");
    expect(s.isDismissed("p2", "slug")).toBe(false);
    expect(s.listDismissed("p2")).toEqual(new Set());
  });

  it("dismiss is idempotent (no duplicate entries on repeat)", async () => {
    const s = new DismissedCampaignsStore(file);
    await s.dismiss("p1", "slug");
    await s.dismiss("p1", "slug");
    expect(JSON.parse(readFileSync(file, "utf-8")).dismissed.p1).toEqual(["slug"]);
  });

  it("restore removes a slug and is a no-op when the slug is absent", async () => {
    const s = new DismissedCampaignsStore(file);
    await s.dismiss("p1", "a");
    await s.dismiss("p1", "b");
    await s.restore("p1", "a");
    expect(s.isDismissed("p1", "a")).toBe(false);
    expect(s.isDismissed("p1", "b")).toBe(true);
    await s.restore("p1", "a"); // idempotent
    expect(s.listDismissed("p1")).toEqual(new Set(["b"]));
  });

  it("round-trips: a fresh instance reads back persisted state", async () => {
    await new DismissedCampaignsStore(file).dismiss("p1", "slug");
    expect(new DismissedCampaignsStore(file).isDismissed("p1", "slug")).toBe(true);
  });

  it("tolerates a corrupt state file (empty set, never throws on read)", () => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "{ not valid json");
    const s = new DismissedCampaignsStore(file);
    expect(s.listDismissed("p1")).toEqual(new Set());
  });

  it("wraps a mutation in the injected lock (acquire before write, release after)", async () => {
    const order: string[] = [];
    const lock = async (_p: string) => {
      order.push("acquire");
      return async () => {
        order.push("release");
      };
    };
    const s = new DismissedCampaignsStore(file, { lock });
    await s.dismiss("p1", "slug");
    expect(order).toEqual(["acquire", "release"]);
    expect(s.isDismissed("p1", "slug")).toBe(true);
  });

  it("releases the lock even when the write fails", async () => {
    // Make the target path a directory so the write throws inside the lock.
    mkdirSync(file, { recursive: true });
    const order: string[] = [];
    const lock = async (_p: string) => {
      order.push("acquire");
      return async () => {
        order.push("release");
      };
    };
    const s = new DismissedCampaignsStore(file, { lock });
    await expect(s.dismiss("p1", "slug")).rejects.toThrow();
    expect(order).toEqual(["acquire", "release"]);
  });
});
