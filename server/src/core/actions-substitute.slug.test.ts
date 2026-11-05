import { describe, it, expect } from "vitest";

import {
  substitutePlaceholders,
  validateTemplate,
  type SubstitutionContext,
  type ShellForm,
} from "./actions-substitute.js";
import { slugifyTitle, shortTaskId } from "./task-slug.js";

const UUID = "3d9e8bd4-1111-2222-3333-444444444444";
const SHELLS: ShellForm[] = ["powershell", "cmd", "posix"];

function ctx(title: string): SubstitutionContext {
  return {
    project: { id: "p", path: "/home/sven/app" },
    task: { uuid: UUID, title, phase: "build", phase_label: "Build" },
    pluginDirs: [],
    allowedPhaseIds: new Set(["build"]),
    actionId: "new-task",
  };
}

const slug = (title: string, form: ShellForm = "posix") =>
  substitutePlaceholders("{task.slug}", ctx(title), form);

// @covers FR-01.37
describe("{task.slug}", () => {
  it("lowercases and hyphenates", () => {
    expect(slug("Gap Analyse")).toBe("gap-analyse");
  });

  it("transliterates umlauts and ß", () => {
    expect(slug("Änderung für Müller")).toBe("aenderung-fuer-mueller");
    expect(slug("Öl Straße")).toBe("oel-strasse");
  });

  it("collapses runs and trims edge dashes", () => {
    expect(slug("--  a   //  b  --")).toBe("a-b");
  });

  it("truncates a long title to ~30 chars without a trailing dash", () => {
    const out = slug("word ".repeat(20));
    expect(out.length).toBeLessThanOrEqual(30);
    expect(out).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(slugifyTitle("a".repeat(29) + " bbb")).toBe("a".repeat(29));
  });

  it("transliterates decomposed (NFD) umlauts like precomposed ones", () => {
    expect(slug("Müller")).toBe("mueller");
    expect(slug("Änderung")).toBe("aenderung");
  });

  it("stays [a-z0-9-] for exotic code points (İ, Kelvin sign, emoji)", () => {
    for (const t of ["İstanbul", "Kelvin", "x😀y", "\u0000a​b"]) {
      expect(slug(t)).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("cuts mid-word at 30 chars", () => {
    expect(slugifyTitle("a".repeat(45))).toBe("a".repeat(30));
  });

  it("falls back to 'task' when nothing survives", () => {
    expect(slug("!!! ???")).toBe("task");
    expect(slug("")).toBe("task");
    expect(slug("日本語")).toBe("task");
  });

  it("shell metacharacters can only ever yield [a-z0-9-]", () => {
    const evil = "a $(rm -rf /); `id` \" ' & | > < \\ b";
    for (const form of SHELLS) {
      expect(slug(evil, form)).toMatch(/^[a-z0-9-]+$/);
    }
    expect(slug(evil)).toBe("a-rm-rf-id-b");
  });

  it("is identical across powershell, cmd and posix", () => {
    const values = SHELLS.map((f) => slug("Gap Analyse", f));
    expect(new Set(values).size).toBe(1);
  });
});

// @covers FR-01.37
describe("{task.short_id}", () => {
  it("is exactly the first 6 chars of the uuid, same in all shells", () => {
    expect(shortTaskId(UUID)).toBe("3d9e8b");
    for (const form of SHELLS) {
      expect(substitutePlaceholders("{task.short_id}", ctx("x"), form)).toBe("3d9e8b");
    }
  });
});

// @covers FR-01.37
describe("worktree template + validateTemplate", () => {
  it("renders the readable worktree name", () => {
    const out = substitutePlaceholders(
      "claude -w wt-{task.slug}-{task.short_id}",
      ctx("Gap Analyse"),
      "posix",
    );
    expect(out).toBe("claude -w wt-gap-analyse-3d9e8b");
  });

  it("validateTemplate accepts the new placeholders", () => {
    expect(
      validateTemplate("claude -w wt-{task.slug}-{task.short_id}", "custom", ["build"]),
    ).toBeNull();
  });
});
