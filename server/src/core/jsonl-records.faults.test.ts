import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/*
 * jsonl-records.faults.test.ts — filesystem fault injection for
 * `endsWithoutNewline` (iterate-2026-07-18-triage-jsonl-record-boundary).
 *
 * Kept in its OWN file because it mocks `node:fs` wholesale; doing that in
 * `jsonl-records.test.ts` would break the real-filesystem tests there.
 *
 * The behaviours pinned here are unreachable through the real filesystem — a
 * short positional read and a concurrent truncation are exactly the
 * cross-process race the module documents as its known limitation, and the only
 * honest way to test them is to inject the fault (external review, medium).
 */

const mockFs = vi.hoisted(() => ({
  openSync: vi.fn(),
  closeSync: vi.fn(),
  fstatSync: vi.fn(),
  readSync: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, ...mockFs };
});

const { endsWithoutNewline } = await import("./jsonl-records.js");

describe("endsWithoutNewline — filesystem faults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFs.openSync.mockReturnValue(42);
    mockFs.closeSync.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("treats a SHORT read as safely appendable rather than unterminated", () => {
    // `Buffer.alloc` zero-fills. Without an explicit bytesRead check, buf[0]
    // stays 0, which !== LF, and the probe would wrongly report "unterminated"
    // and inject a spurious newline.
    mockFs.fstatSync.mockReturnValue({ size: 100 } as never);
    mockFs.readSync.mockReturnValue(0); // read nothing

    expect(endsWithoutNewline("whatever.jsonl")).toBe(false);
    expect(mockFs.closeSync).toHaveBeenCalledWith(42);
  });

  it("sizes from the OPEN handle, not a prior stat, so the offset is live", () => {
    // Python does seek(-1, SEEK_END), which is inherently live-end-relative.
    // Using fstat on the open fd matches that: the offset we read from is
    // derived from the same file state the handle refers to.
    mockFs.fstatSync.mockReturnValue({ size: 10 } as never);
    mockFs.readSync.mockImplementation(
      (_fd: number, buf: Buffer, _o: number, _l: number, pos: number) => {
        expect(pos).toBe(9); // size - 1, from fstat — not a stale stat
        buf[0] = 0x7d; // '}' — not a newline
        return 1;
      },
    );

    expect(endsWithoutNewline("whatever.jsonl")).toBe(true);
    expect(mockFs.fstatSync).toHaveBeenCalledWith(42);
  });

  it("closes the descriptor even when the read throws", () => {
    mockFs.fstatSync.mockReturnValue({ size: 10 } as never);
    mockFs.readSync.mockImplementation(() => {
      throw new Error("EIO");
    });

    // Degrades to "safely appendable"; the append itself surfaces real I/O
    // problems via TriageWriteError.
    expect(endsWithoutNewline("whatever.jsonl")).toBe(false);
    expect(mockFs.closeSync).toHaveBeenCalledWith(42);
  });

  it("does not attempt a close when the open itself fails", () => {
    mockFs.openSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    expect(endsWithoutNewline("missing.jsonl")).toBe(false);
    expect(mockFs.closeSync).not.toHaveBeenCalled();
  });

  it("returns false for a zero-byte file without reading", () => {
    mockFs.fstatSync.mockReturnValue({ size: 0 } as never);

    expect(endsWithoutNewline("empty.jsonl")).toBe(false);
    expect(mockFs.readSync).not.toHaveBeenCalled();
    expect(mockFs.closeSync).toHaveBeenCalledWith(42);
  });
});
