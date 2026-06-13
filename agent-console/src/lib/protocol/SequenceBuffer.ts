import type { ServerMessage } from './types'

// Accepts out-of-order and duplicate messages; releases them in seq order.
//
// In chaos mode the server may shuffle a window of up to 4 messages and send
// duplicates. This class:
//   1. Discards exact-seq duplicates via a processed Set.
//   2. Buffers incoming messages and drains contiguous runs starting from the
//      next expected seq.
//   3. After GAP_TIMEOUT_MS without progress, force-flushes whatever is
//      buffered in seq order so a permanently missing message does not stall
//      the stream.
export class SequenceBuffer {
  private buffer: Map<number, ServerMessage> = new Map()
  private processed: Set<number> = new Set()
  private nextExpected: number = 1
  private gapTimer: ReturnType<typeof setTimeout> | null = null

  private static readonly GAP_TIMEOUT_MS = 200

  // Push a message and return the ordered batch ready to dispatch.
  push(msg: ServerMessage): ServerMessage[] {
    // Discard duplicates
    if (this.processed.has(msg.seq)) return []

    this.buffer.set(msg.seq, msg)

    const ready = this.drain()

    if (ready.length > 0) {
      this.clearGapTimer()
      // If buffer still has entries there is a gap ahead of us
      if (this.buffer.size > 0) this.armGapTimer()
    } else {
      // Nothing drained — gap exists; arm timer to force-flush
      this.armGapTimer()
    }

    return ready
  }

  // The highest seq we have fully dispatched. Sent as last_seq on RESUME.
  getLastProcessed(): number {
    return this.nextExpected - 1
  }

  // Reset for a new conversation turn (server resets seq to 1 on each USER_MESSAGE).
  reset(): void {
    this.buffer.clear()
    this.processed.clear()
    this.nextExpected = 1
    this.clearGapTimer()
  }

  // Provide a callback so callers can receive force-flushed messages when the
  // gap timer fires. The caller wires this up after construction.
  onFlush: ((msgs: ServerMessage[]) => void) | null = null

  // ── Private ───────────────────────────────────────────────

  private drain(): ServerMessage[] {
    const out: ServerMessage[] = []
    while (this.buffer.has(this.nextExpected)) {
      const msg = this.buffer.get(this.nextExpected)!
      this.buffer.delete(this.nextExpected)
      this.processed.add(this.nextExpected)
      this.nextExpected++
      out.push(msg)
    }
    return out
  }

  private armGapTimer(): void {
    if (this.gapTimer !== null) return
    this.gapTimer = setTimeout(() => {
      this.gapTimer = null
      if (this.buffer.size === 0) return

      // Force-flush remaining buffer in seq order
      const sorted = Array.from(this.buffer.values()).sort(
        (a, b) => a.seq - b.seq,
      )
      for (const msg of sorted) {
        this.buffer.delete(msg.seq)
        this.processed.add(msg.seq)
        // Advance nextExpected past this message so subsequent messages
        // that arrive in order will drain normally
        if (msg.seq >= this.nextExpected) {
          this.nextExpected = msg.seq + 1
        }
      }
      this.onFlush?.(sorted)
    }, SequenceBuffer.GAP_TIMEOUT_MS)
  }

  private clearGapTimer(): void {
    if (this.gapTimer !== null) {
      clearTimeout(this.gapTimer)
      this.gapTimer = null
    }
  }
}
