/*
 * replay-drain-queue.ts — the byte-capped hold-queue for live pty output that
 * arrives while a `replay_snapshot` write is in flight.
 *
 * Split out of `useReplayDrainGate` (iterate-2026-07-30) once the gate grew
 * snapshot SEQUENCING on top of queue BOOKKEEPING: two concerns, and only this one
 * is pure. Keeping it separate makes the trim rule directly testable rather than
 * reachable only through a mounted hook and a mock terminal.
 *
 * Contract, unchanged from the inline version:
 *   - while a snapshot write is in flight, live `data` is HELD, not written —
 *     interleaving the two corrupts the xterm buffer (Bug B glyph-fragment smear);
 *   - past the byte cap the OLDEST chunks are dropped (ring-buffer trim) and the
 *     newest always survives; force-draining mid-flight is NOT an option because it
 *     provably re-creates that smear;
 *   - a trim is REPORTED to the caller. Dropping chunks silently is what DO-NOT #18
 *     forbids, and it is the same defect class as the server's saturation drop: the
 *     bytes are gone, so only a fresh full-grid snapshot can restore them.
 */

export const REPLAY_DRAIN_MAX_BYTES = 8 * 1024 * 1024;

const utf8ByteLength = (s: string): number => new TextEncoder().encode(s).length;

export class ReplayDrainQueue {
  private chunks: string[] = [];
  private bytes = 0;

  constructor(private readonly maxBytes: number = REPLAY_DRAIN_MAX_BYTES) {}

  /**
   * Hold one chunk.
   *
   * @returns `true` when the cap forced older chunks out — the caller must then ask
   *   for a full-grid resync, because those bytes are unrecoverable locally.
   */
  push(chunk: string): boolean {
    this.chunks.push(chunk);
    this.bytes += utf8ByteLength(chunk);
    let trimmed = false;
    while (this.bytes > this.maxBytes && this.chunks.length > 1) {
      const dropped = this.chunks.shift();
      if (dropped === undefined) break;
      this.bytes -= utf8ByteLength(dropped);
      trimmed = true;
    }
    return trimmed;
  }

  /** Everything held, as one concatenated write, leaving the queue empty. */
  takeAll(): string {
    const out = this.chunks.join("");
    this.clear();
    return out;
  }

  clear(): void {
    this.chunks = [];
    this.bytes = 0;
  }

  get byteLength(): number {
    return this.bytes;
  }

  get length(): number {
    return this.chunks.length;
  }
}
