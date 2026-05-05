/*
 * scrollback-sanitizer.ts — strip cursor-control + repaint sequences from
 * pty bytes before disk persistence (iterate-2026-05-05-post-v0.8-stabilization,
 * AC-1).
 *
 * Persisted format contract (post-external-review v2):
 *   PRESERVE: printable UTF-8, "\n" (LF), "\r\n" (CRLF), "\t" (HT),
 *             SGR sequences "\x1b[<params>m" (colors, bold, italic, …),
 *             OSC sequences "\x1b]…\x07" / "\x1b]…\x1b\\" (window title etc.).
 *   STRIP:    bare "\r" not followed by "\n" (carriage-return repaint),
 *             "\b" (backspace), all CSI with non-"m" final byte (cursor
 *             movement, erase, scroll, alt-screen, save/restore, private
 *             "\x1b[?…h/l").
 *   DROP:     incomplete CSI > MAX_CSI_BYTES, incomplete OSC > MAX_OSC_BYTES.
 *             Parser resyncs at the next valid byte.
 *
 * Why bytes-not-strings: chunks come from pty.onData which can split UTF-8
 * codepoints across boundaries. The sanitizer scans by ASCII byte values
 * (ESC=0x1B, CSI=[=0x5B, OSC=]=0x5D) — UTF-8 continuation bytes (0x80-0xBF)
 * never collide with these. Final UTF-8 decode happens in
 * ScrollbackStore.read() via StringDecoder.
 *
 * Why state-on-instance: a single pty produces one byte stream; state
 * (mid-CSI / mid-OSC / mid-CRLF) carries across `feed()` calls. One
 * sanitizer instance per task in PerTaskState.
 */

const ESC = 0x1b;
const CSI_BRACKET = 0x5b; // '['
const OSC_BRACKET = 0x5d; // ']'
const BEL = 0x07;
const BACKSLASH = 0x5c; // '\\'
const CR = 0x0d;
const LF = 0x0a;
const TAB = 0x09;
const BS = 0x08; // backspace

const MAX_CSI_BYTES = 32;
const MAX_OSC_BYTES = 4096;

type State =
  | "GROUND"
  | "SAW_ESC"
  | "IN_CSI"
  | "CSI_DRAIN"
  | "IN_OSC"
  | "SAW_OSC_ESC"
  | "OSC_DRAIN"
  | "OSC_DRAIN_SAW_ESC"
  | "SAW_CR";

export class ScrollbackSanitizer {
  private state: State = "GROUND";
  /** Bytes held for an in-progress sequence (CSI / OSC). */
  private pending: number[] = [];

  /**
   * Process one chunk of pty bytes. Returns the sanitized bytes for this
   * chunk; held state (mid-CSI, mid-OSC, mid-CRLF) carries forward to
   * the next call. UTF-8-safe by construction (only ASCII byte values
   * are inspected; multi-byte UTF-8 continuation bytes pass through).
   */
  feed(input: Buffer): Buffer {
    const out: number[] = [];
    let i = 0;
    while (i < input.length) {
      const b = input[i];

      switch (this.state) {
        case "GROUND": {
          if (b === ESC) {
            this.state = "SAW_ESC";
            i++;
            break;
          }
          if (b === CR) {
            this.state = "SAW_CR";
            i++;
            break;
          }
          if (b === BS) {
            // Strip backspace; advance.
            i++;
            break;
          }
          // All other bytes — printable text, LF, TAB, multi-byte UTF-8
          // continuation, etc. — pass through verbatim.
          out.push(b);
          i++;
          break;
        }

        case "SAW_ESC": {
          if (b === CSI_BRACKET) {
            this.state = "IN_CSI";
            this.pending.length = 0;
            i++;
            break;
          }
          if (b === OSC_BRACKET) {
            this.state = "IN_OSC";
            this.pending.length = 0;
            i++;
            break;
          }
          // Bare ESC + non-CSI/non-OSC byte. Conservative fallback:
          // emit the ESC and re-feed the current byte in GROUND. Rare
          // in pty output (legacy 7-bit C1 controls) — keeping the byte
          // verbatim avoids losing potentially meaningful content.
          out.push(ESC);
          this.state = "GROUND";
          // Loop without advancing — re-process current byte in GROUND.
          break;
        }

        case "IN_CSI": {
          // Final byte: 0x40-0x7E. Parameter bytes: 0x30-0x3F (digits +
          // ':;<=>?'). Intermediate bytes: 0x20-0x2F (' ' through '/').
          if (b >= 0x40 && b <= 0x7e) {
            // Final byte — decide preserve vs strip.
            if (b === 0x6d /* 'm' */) {
              // SGR — emit ESC + '[' + pending params + 'm'.
              out.push(ESC, CSI_BRACKET, ...this.pending, b);
            }
            // else: strip — pending + final byte are both dropped.
            this.pending.length = 0;
            this.state = "GROUND";
            i++;
            break;
          }
          // Parameter or intermediate byte — accumulate.
          if (
            (b >= 0x20 && b <= 0x2f) ||
            (b >= 0x30 && b <= 0x3f)
          ) {
            if (this.pending.length >= MAX_CSI_BYTES) {
              // Overflow — abandon sequence + drain remaining bytes
              // until we hit a CSI final byte (or fresh ESC) so the
              // overlong parameter list doesn't leak as text.
              this.pending.length = 0;
              this.state = "CSI_DRAIN";
              i++;
              break;
            }
            this.pending.push(b);
            i++;
            break;
          }
          // Malformed CSI — abandon, resync. Re-feed current byte in
          // GROUND so it isn't lost (could be ESC starting a new seq).
          this.pending.length = 0;
          this.state = "GROUND";
          break;
        }

        case "CSI_DRAIN": {
          // Swallow bytes from an overlong CSI until the (would-be)
          // final byte arrives. ESC starts a new sequence.
          if (b === ESC) {
            this.state = "SAW_ESC";
            i++;
            break;
          }
          if (b >= 0x40 && b <= 0x7e) {
            this.state = "GROUND";
            i++;
            break;
          }
          // Parameter / intermediate / other — keep draining.
          i++;
          break;
        }

        case "IN_OSC": {
          if (b === BEL) {
            // BEL terminator — emit ESC + ']' + pending + BEL.
            out.push(ESC, OSC_BRACKET, ...this.pending, BEL);
            this.pending.length = 0;
            this.state = "GROUND";
            i++;
            break;
          }
          if (b === ESC) {
            // Possibly the start of an ST terminator (ESC '\\') or an
            // interrupting new sequence. Defer to SAW_OSC_ESC.
            this.state = "SAW_OSC_ESC";
            i++;
            break;
          }
          if (this.pending.length >= MAX_OSC_BYTES) {
            // Overflow — abandon sequence + drain remaining bytes
            // until we hit BEL or ESC.
            this.pending.length = 0;
            this.state = "OSC_DRAIN";
            i++;
            break;
          }
          this.pending.push(b);
          i++;
          break;
        }

        case "OSC_DRAIN": {
          // Swallow bytes from an overlong OSC until the (would-be)
          // terminator arrives. BEL terminates outright; ESC may be
          // ST (\x1b\\) or a new sequence.
          if (b === BEL) {
            this.state = "GROUND";
            i++;
            break;
          }
          if (b === ESC) {
            this.state = "OSC_DRAIN_SAW_ESC";
            i++;
            break;
          }
          i++;
          break;
        }

        case "OSC_DRAIN_SAW_ESC": {
          // Just saw ESC inside drained OSC — could be ST (drain ends)
          // or interrupting ESC for a new sequence.
          if (b === BACKSLASH) {
            // ST — drained OSC consumed.
            this.state = "GROUND";
            i++;
            break;
          }
          // Not ST — abandon drain, re-feed current byte in SAW_ESC.
          this.state = "SAW_ESC";
          break;
        }

        case "SAW_OSC_ESC": {
          if (b === BACKSLASH) {
            // ST terminator: emit ESC + ']' + pending + ESC + '\\'.
            out.push(ESC, OSC_BRACKET, ...this.pending, ESC, BACKSLASH);
            this.pending.length = 0;
            this.state = "GROUND";
            i++;
            break;
          }
          // Not ST — abandon OSC, treat the new ESC as fresh.
          this.pending.length = 0;
          this.state = "SAW_ESC";
          // Don't advance — re-feed current byte in SAW_ESC.
          break;
        }

        case "SAW_CR": {
          if (b === LF) {
            // CRLF preserved as the pair.
            out.push(CR, LF);
            this.state = "GROUND";
            i++;
            break;
          }
          // Bare CR (repaint trigger) — strip the held CR + re-feed
          // current byte in GROUND.
          this.state = "GROUND";
          break;
        }

        default: {
          // Unreachable — TypeScript exhaustiveness.
          this.state = "GROUND";
          i++;
        }
      }
    }
    return Buffer.from(out);
  }

  /**
   * End-of-stream flush. Releases any held state. Bare CR + orphan ESC
   * + incomplete CSI / OSC are all dropped (treating end-of-stream as
   * an implicit "abandon held sequence" boundary).
   */
  flush(): Buffer {
    const out: number[] = [];
    if (this.state === "SAW_ESC") {
      // Orphan ESC at end of stream — emit verbatim (rare).
      out.push(ESC);
    }
    // SAW_CR / IN_CSI / IN_OSC / SAW_OSC_ESC: held bytes are dropped.
    this.state = "GROUND";
    this.pending.length = 0;
    return Buffer.from(out);
  }

  /** Reset to GROUND, discarding any held state. */
  reset(): void {
    this.state = "GROUND";
    this.pending.length = 0;
  }
}
