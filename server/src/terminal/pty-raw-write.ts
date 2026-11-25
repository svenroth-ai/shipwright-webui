/*
 * pty-raw-write.ts — event-loop-safe delivery of ONE chunk to a pty master
 * (issue #632, follow-up to PR #420 / FR-01.28).
 *
 * WHY. node-pty's `write()` goes through a libuv `tty.ReadStream`, and libuv
 * writes to a tty handle SYNCHRONOUSLY (blocking). When the slave side is in
 * canonical mode and its ~1 KiB input queue is full (the shell is busy, or a
 * long unterminated line is being typed), that `write(2)` blocks the Node
 * MAIN thread until the shell drains — which can be never — freezing every
 * session on the process. Spacing 512-byte chunks over timers (PR #420)
 * changes the timing but adds no back-pressure.
 *
 * FIX. On Unix, deliver each chunk with an ASYNC `fs.write` on the master fd:
 * it runs on the libuv threadpool, so a stuck write parks one pool thread
 * instead of the event loop (and a non-blocking fd yields EAGAIN, which we
 * retry on a short timer — real back-pressure with nothing parked). The
 * caller sends the next chunk only after this one completed. Windows
 * (ConPTY) has no such queue and exposes no usable fd: it keeps the
 * synchronous `pty.write`. Small (<= chunk size) writes stay on the sync path.
 * Threadpool caveat: if the fd is blocking, a stuck write parks one pool
 * thread (not the event loop); the EAGAIN retry covers a non-blocking fd.
 */
import fs from "node:fs";

export interface RawWritablePty {
  write(data: string): void;
  /** Unix master fd (node-pty `UnixTerminal.fd`); absent on ConPTY and in test doubles. */
  readonly fd?: number;
}

export const EAGAIN_RETRY_DELAY_MS = 5;

/** Max consecutive EAGAIN retries before the chunk is failed (~10 s at 5 ms). */
export const EAGAIN_MAX_RETRIES = 2000;

/**
 * Write `chunk` to `pty`, then call `done` exactly once (`err` set on
 * failure). Synchronous when the pty has no usable fd (Windows / test
 * doubles); asynchronous off the main thread otherwise.
 */
export function writePtyChunk(
  entry: { readonly pty: RawWritablePty; readonly tornDown?: boolean },
  chunk: string,
  done: (err?: Error) => void,
): void {
  const fd = entry.pty.fd;
  if (process.platform === "win32" || typeof fd !== "number" || fd < 0) {
    try {
      entry.pty.write(chunk);
    } catch (err) {
      done(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    done();
    return;
  }
  const buf = Buffer.from(chunk, "utf8");
  let offset = 0;
  let retries = 0;
  const next = (): void => {
    // The master fd is closed on kill(): never write (or retry) into a closed
    // or OS-reused fd once the entry is torn down.
    if (entry.tornDown) {
      done();
      return;
    }
    fs.write(fd, buf, offset, buf.length - offset, null, (err, written) => {
      if (err) {
        if ((err as NodeJS.ErrnoException).code === "EAGAIN" && retries++ < EAGAIN_MAX_RETRIES) {
          setTimeout(next, EAGAIN_RETRY_DELAY_MS).unref?.();
          return;
        }
        done(err);
        return;
      }
      offset += written;
      if (offset < buf.length) {
        if (written === 0) {
          // No progress without an error: back off like EAGAIN (capped), never spin.
          if (retries++ >= EAGAIN_MAX_RETRIES) return done(new Error("pty write made no progress"));
          setTimeout(next, EAGAIN_RETRY_DELAY_MS).unref?.();
          return;
        }
        next();
        return;
      }
      done();
    });
  };
  next();
}
