/*
 * shipslog-docs-reader.test.ts — fs-backed contract for
 * readShipsLogDocs (iterate-2026-08-31-shipslog-documents-panel):
 *   - curated Agent Docs / Compliance rows skip silently when missing
 *   - Requirements discovers only planning subdirs with their own spec.md,
 *     excluding iterate/adr/campaigns, with a "NN — Title Case" label
 *   - Iterate lists only flat *.md files (no subdirectories), newest-mtime-first
 *   - an unreadable project root degrades to an empty bundle, never throws
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import path from "node:path";
import os from "node:os";

import { readShipsLogDocs } from "./shipslog-docs-reader.js";

describe("readShipsLogDocs", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const tmp = (): string => {
    const d = mkdtempSync(path.join(os.tmpdir(), "shipslogdocs-"));
    dirs.push(d);
    return d;
  };
  const write = (root: string, rel: string, content = "content") => {
    const abs = path.join(root, ...rel.split("/"));
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf-8");
  };

  it("absent project entirely → all four groups empty, no throw", async () => {
    const root = tmp();
    const bundle = await readShipsLogDocs(root);
    expect(bundle).toEqual({ requirements: [], iterateSpecs: [], agentDocs: [], compliance: [] });
  });

  it("agentDocs / compliance: only existing curated files appear, others skipped silently", async () => {
    const root = tmp();
    write(root, ".shipwright/agent_docs/architecture.md");
    write(root, ".shipwright/agent_docs/decision_log.md");
    // build_dashboard.md / conventions.md / design_tokens.md intentionally absent.
    write(root, ".shipwright/compliance/dashboard.md");

    const bundle = await readShipsLogDocs(root);

    expect(bundle.agentDocs.map((r) => r.label).sort()).toEqual(["Architecture", "Decision Log"]);
    expect(bundle.agentDocs.every((r) => typeof r.when === "string")).toBe(true);
    expect(bundle.compliance.map((r) => r.label)).toEqual(["Dashboard"]);
  });

  it("requirements: discovers a section's spec.md, excludes iterate/adr/campaigns, labels 'NN — Title Case'", async () => {
    const root = tmp();
    write(root, ".shipwright/planning/01-adopted/spec.md");
    write(root, ".shipwright/planning/02-billing-and-invoicing/spec.md");
    write(root, ".shipwright/planning/03-empty-section/README.md"); // no spec.md — excluded
    write(root, ".shipwright/planning/iterate/2026-08-31-x.md");
    write(root, ".shipwright/planning/adr/001-decision.md");
    write(root, ".shipwright/planning/campaigns/some-campaign.md");

    const bundle = await readShipsLogDocs(root);

    expect(bundle.requirements).toHaveLength(2);
    const byLabel = Object.fromEntries(bundle.requirements.map((r) => [r.label, r]));
    expect(byLabel["01 — Adopted"].path).toBe(".shipwright/planning/01-adopted/spec.md");
    expect(byLabel["02 — Billing And Invoicing"]).toBeDefined();
  });

  it("iterateSpecs: only flat *.md files, no subdirectories, newest mtime first", async () => {
    const root = tmp();
    write(root, ".shipwright/planning/iterate/2026-08-01-a.md");
    write(root, ".shipwright/planning/iterate/2026-08-30-b.md");
    write(root, ".shipwright/planning/iterate/notes.txt"); // wrong extension — excluded
    write(root, ".shipwright/planning/iterate/campaigns/nested.md"); // subdirectory — excluded

    const older = path.join(root, ".shipwright/planning/iterate/2026-08-01-a.md");
    const newer = path.join(root, ".shipwright/planning/iterate/2026-08-30-b.md");
    const oldTs = new Date("2026-08-01T00:00:00Z");
    const newTs = new Date("2026-08-30T00:00:00Z");
    utimesSync(older, oldTs, oldTs);
    utimesSync(newer, newTs, newTs);

    const bundle = await readShipsLogDocs(root);

    expect(bundle.iterateSpecs.map((r) => r.label)).toEqual(["2026-08-30-b.md", "2026-08-01-a.md"]);
  });

  it("unreadable project root → empty bundle, never throws", async () => {
    const bundle = await readShipsLogDocs(path.join(os.tmpdir(), "shipslogdocs-does-not-exist-xyz"));
    expect(bundle).toEqual({ requirements: [], iterateSpecs: [], agentDocs: [], compliance: [] });
  });
});
