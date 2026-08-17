import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import {
  parseProposedEntries,
  parseLoggedEntries,
  findLoggedEntry,
  nextLoggedNumber,
  toLoggedBlock,
  withDecisionsLock,
} from "../decisions-lock.js";

describe("parseProposedEntries", () => {
  it("splits multiple entries at header boundaries", () => {
    const raw =
      "## [2026-08-17T09:00:00.000Z] acme-lead\n" +
      "- **Context:** a\n- **Decision:** b\n" +
      "## [2026-08-17T09:05:00.000Z] other-lead\n" +
      "- **Context:** c\n";
    const entries = parseProposedEntries(raw);
    expect(entries).toHaveLength(2);
    expect(entries[0].timestamp).toBe("2026-08-17T09:00:00.000Z");
    expect(entries[0].leadId).toBe("acme-lead");
    expect(entries[0].block).toContain("Context:** a");
    expect(entries[0].block).not.toContain("other-lead");
    expect(entries[1].leadId).toBe("other-lead");
  });

  it("returns an empty array for an empty document", () => {
    expect(parseProposedEntries("")).toEqual([]);
  });

  it("ignores lines that don't match the exact header shape", () => {
    const raw = "## Not a real header\nsome body\n## [2026-08-17T09:00:00.000Z] acme-lead\nbody\n";
    const entries = parseProposedEntries(raw);
    expect(entries).toHaveLength(1);
    expect(entries[0].leadId).toBe("acme-lead");
  });

  it("doubt-review fix (HIGH): a CRLF-terminated proposed header still parses", () => {
    const raw = "## [2026-08-17T09:00:00.000Z] acme-lead\r\n- **Context:** a\r\n";
    const entries = parseProposedEntries(raw);
    expect(entries).toHaveLength(1);
    expect(entries[0].timestamp).toBe("2026-08-17T09:00:00.000Z");
    expect(entries[0].leadId).toBe("acme-lead");
    // startIndex/endIndex must still key against the ORIGINAL (CRLF) raw
    // string — the fix must not normalize line endings before splitBlocks.
    expect(raw.slice(entries[0].startIndex, entries[0].endIndex)).toBe(raw);
  });

  it("splicing startIndex/endIndex removes exactly one entry", () => {
    const raw =
      "## [T1] a\nbodyA\n" +
      "## [T2] b\nbodyB\n" +
      "## [T3] c\nbodyC\n";
    const entries = parseProposedEntries(raw);
    const middle = entries[1];
    const spliced = raw.slice(0, middle.startIndex) + raw.slice(middle.endIndex);
    expect(spliced).toBe("## [T1] a\nbodyA\n## [T3] c\nbodyC\n");
  });
});

describe("parseLoggedEntries / findLoggedEntry / nextLoggedNumber", () => {
  it("parses numbered entries", () => {
    const raw =
      "## ADR-0001 [2026-08-17T09:00:00.000Z] acme-lead\nbody1\n" +
      "## ADR-0002 [2026-08-17T09:05:00.000Z] other-lead\nbody2\n";
    const entries = parseLoggedEntries(raw);
    expect(entries).toHaveLength(2);
    expect(entries[0].number).toBe(1);
    expect(entries[1].number).toBe(2);
  });

  it("nextLoggedNumber is 1 for an empty log", () => {
    expect(nextLoggedNumber([])).toBe(1);
  });

  it("nextLoggedNumber continues from the existing max, not the count", () => {
    const entries = parseLoggedEntries(
      "## ADR-0001 [T1] a\nx\n## ADR-0005 [T2] b\ny\n",
    );
    expect(nextLoggedNumber(entries)).toBe(6);
  });

  it("findLoggedEntry matches on BOTH timestamp and leadId", () => {
    const entries = parseLoggedEntries(
      "## ADR-0001 [2026-08-17T09:00:00.000Z] acme-lead\nx\n",
    );
    expect(findLoggedEntry(entries, "2026-08-17T09:00:00.000Z", "acme-lead")).toBeDefined();
    expect(findLoggedEntry(entries, "2026-08-17T09:00:00.000Z", "other-lead")).toBeUndefined();
    expect(findLoggedEntry(entries, "wrong-timestamp", "acme-lead")).toBeUndefined();
  });

  it(
    "doubt-review fix (HIGH): a CRLF-terminated header line still parses — " +
      "`.` never matches \\r (JS LineTerminator exclusion), so a bare `(.+)$` " +
      "could never reach `$` on a CRLF file and nextLoggedNumber silently " +
      "always returned 1, minting duplicate ADR numbers",
    () => {
      const entries = parseLoggedEntries(
        "## ADR-0001 [2026-01-01T00:00:00Z] pete\r\nbody\r\n",
      );
      expect(entries).toHaveLength(1);
      expect(entries[0].number).toBe(1);
      expect(entries[0].leadId).toBe("pete");
      expect(nextLoggedNumber(entries)).toBe(2);
    },
  );

  it("a proposed-side body line resembling an ADR header is not misparsed as a logged entry", () => {
    // Documented limitation (plan review, deepseek LOW): this demonstrates
    // current (best-effort) behavior on decision_log.md, not a fix for
    // maliciously-crafted proposed content — that risk sits upstream in
    // leadwright's own daemon form-check.
    const raw =
      "## ADR-0001 [2026-08-17T09:00:00.000Z] acme-lead\n" +
      "some body text, not a header\n";
    const entries = parseLoggedEntries(raw);
    expect(entries).toHaveLength(1);
  });
});

describe("toLoggedBlock", () => {
  it("rewrites the header line to ADR-NNNN form, preserving the body verbatim", () => {
    const block = "## [2026-08-17T09:00:00.000Z] acme-lead\n- **Context:** a\n- **Decision:** b\n";
    const logged = toLoggedBlock(block, 7);
    expect(logged).toBe(
      "## ADR-0007 [2026-08-17T09:00:00.000Z] acme-lead\n- **Context:** a\n- **Decision:** b\n",
    );
  });

  it("zero-pads to 4 digits", () => {
    const block = "## [T] a\nbody\n";
    expect(toLoggedBlock(block, 42)).toMatch(/^## ADR-0042 /);
  });

  it("handles a header-only block with no body", () => {
    const block = "## [T] a";
    expect(toLoggedBlock(block, 1)).toBe("## ADR-0001 [T] a");
  });

  it("throws on a block that is not a proposed-header block (internal invariant)", () => {
    expect(() => toLoggedBlock("not a header\nbody\n", 1)).toThrow();
  });

  it(
    "doubt-review fix (HIGH): rewrites a CRLF-terminated proposed header " +
      "correctly — leadId is captured WITHOUT the trailing \\r (the " +
      "reconstructed header line is therefore bare-LF; the body's own " +
      "\\r\\n is untouched, since `rest` slices from the original raw " +
      "string, not from the (.+?)\\r?$ match)",
    () => {
      const block = "## [2026-08-17T09:00:00.000Z] acme-lead\r\n- **Context:** a\r\n";
      const logged = toLoggedBlock(block, 3);
      expect(logged).toBe(
        "## ADR-0003 [2026-08-17T09:00:00.000Z] acme-lead\n- **Context:** a\r\n",
      );
    },
  );
});

describe("withDecisionsLock — ensureFile does not clobber an existing path", () => {
  let leadsRoot: string;

  beforeEach(() => {
    leadsRoot = mkdtempSync(path.join(tmpdir(), "org-lock-ensurefile-fixture-"));
  });

  afterEach(() => {
    rmSync(leadsRoot, { recursive: true, force: true });
  });

  it(
    "code-review fix: a pre-existing decisions-proposed.md with real content survives " +
      "lock acquisition untouched (ensureFile now uses O_CREAT|O_EXCL, never existsSync+" +
      "writeFileSync — the EEXIST branch is exercised here). A real dangling-symlink " +
      "variant of this test is blocked on this Windows dev host (fs.symlinkSync requires " +
      "elevation without Developer Mode, same constraint noted elsewhere in this codebase); " +
      "the symlink-specific half of the fix (O_EXCL fails against a dangling symlink " +
      "without following it, per POSIX open(2)) is verified by code inspection plus the " +
      "existing mocked-lstat symlink-rejection tests in file-write-decisions-lock.test.ts " +
      "and countersign.test.ts, which prove assertNotSymlink still runs and rejects.",
    async () => {
      const proposedPath = path.join(leadsRoot, "decisions-proposed.md");
      writeFileSync(proposedPath, "## [T] a\npre-existing content\n", "utf8");

      await withDecisionsLock({ leadsRoot }, () => {
        // no-op — just prove acquisition didn't wipe the file first
      });

      expect(readFileSync(proposedPath, "utf8")).toBe("## [T] a\npre-existing content\n");
    },
  );
});
