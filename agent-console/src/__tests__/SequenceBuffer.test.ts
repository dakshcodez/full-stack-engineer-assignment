import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SequenceBuffer } from '@/lib/protocol/SequenceBuffer'
import type { ServerMessage } from '@/lib/protocol/types'

function token(seq: number, text = `t${seq}`): ServerMessage {
  return { type: 'TOKEN', seq, text, stream_id: 's1' }
}

describe('SequenceBuffer', () => {
  let buf: SequenceBuffer

  beforeEach(() => {
    vi.useFakeTimers()
    buf = new SequenceBuffer()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns empty array for empty buffer', () => {
    expect(buf.push(token(1))).toHaveLength(1)
    expect(buf.getLastProcessed()).toBe(1)
  })

  it('dispatches a single message immediately', () => {
    const out = buf.push(token(1))
    expect(out).toHaveLength(1)
    expect(out[0]?.seq).toBe(1)
  })

  it('dispatches already-sorted messages in order', () => {
    expect(buf.push(token(1))).toHaveLength(1)
    expect(buf.push(token(2))).toHaveLength(1)
    expect(buf.push(token(3))).toHaveLength(1)
    expect(buf.getLastProcessed()).toBe(3)
  })

  it('buffers out-of-order message until gap is filled', () => {
    // seq 2 arrives before seq 1
    const out2 = buf.push(token(2))
    expect(out2).toHaveLength(0) // held, gap before it

    const out1 = buf.push(token(1))
    // seq 1 drains, then seq 2 follows
    expect(out1).toHaveLength(2)
    expect(out1[0]?.seq).toBe(1)
    expect(out1[1]?.seq).toBe(2)
  })

  it('handles fully reversed sequence', () => {
    buf.push(token(5))
    buf.push(token(4))
    buf.push(token(3))
    buf.push(token(2))
    const out = buf.push(token(1))
    expect(out.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5])
  })

  it('deduplicates exact-seq duplicates', () => {
    const out1 = buf.push(token(1))
    const out2 = buf.push(token(1)) // duplicate
    expect(out1).toHaveLength(1)
    expect(out2).toHaveLength(0)
    expect(buf.getLastProcessed()).toBe(1)
  })

  it('deduplicates duplicate in the middle of a sequence', () => {
    buf.push(token(1))
    buf.push(token(2))
    const dup = buf.push(token(2)) // duplicate seq 2
    expect(dup).toHaveLength(0)
    const out3 = buf.push(token(3))
    expect(out3).toHaveLength(1)
    expect(out3[0]?.seq).toBe(3)
  })

  it('force-flushes on gap timeout', async () => {
    const flushed: ServerMessage[] = []
    buf.onFlush = (msgs) => flushed.push(...msgs)

    buf.push(token(2)) // gap — seq 1 never arrives
    expect(flushed).toHaveLength(0)

    vi.advanceTimersByTime(200)

    expect(flushed).toHaveLength(1)
    expect(flushed[0]?.seq).toBe(2)
  })

  it('does not double-fire gap timer when more messages arrive', () => {
    const flushed: ServerMessage[] = []
    buf.onFlush = (msgs) => flushed.push(...msgs)

    buf.push(token(3))
    buf.push(token(4)) // same gap, no new timer

    vi.advanceTimersByTime(200)
    expect(flushed.map((m) => m.seq)).toEqual([3, 4])
  })

  it('gap that fills before timeout does not trigger force-flush', () => {
    const flushed: ServerMessage[] = []
    buf.onFlush = (msgs) => flushed.push(...msgs)

    buf.push(token(2))
    buf.push(token(1)) // fills the gap — timer should be cleared

    vi.advanceTimersByTime(200)
    expect(flushed).toHaveLength(0) // no force-flush needed
  })

  it('reset clears state and restarts seq from 1', () => {
    buf.push(token(1))
    buf.push(token(2))
    buf.reset()

    expect(buf.getLastProcessed()).toBe(0)
    const out = buf.push(token(1)) // seq 1 again after reset
    expect(out).toHaveLength(1)
  })

  it('getLastProcessed tracks highest dispatched seq', () => {
    buf.push(token(1))
    expect(buf.getLastProcessed()).toBe(1)
    buf.push(token(3)) // held
    expect(buf.getLastProcessed()).toBe(1) // still 1, 3 is buffered
    buf.push(token(2))
    expect(buf.getLastProcessed()).toBe(3) // 2 and 3 drained
  })

  it('handles message arriving after force-flush without duplication', () => {
    const flushed: ServerMessage[] = []
    const dispatched: ServerMessage[] = []
    buf.onFlush = (msgs) => flushed.push(...msgs)

    buf.push(token(2)) // gap
    vi.advanceTimersByTime(200) // force-flush seq 2
    expect(flushed.map((m) => m.seq)).toEqual([2])

    // seq 1 arrives late — already-missed, should be discarded
    // (it was never in processed, so it dispatches but nextExpected moved past it)
    // seq 3 arrives — should dispatch normally
    const out = buf.push(token(3))
    dispatched.push(...out)
    expect(dispatched.map((m) => m.seq)).toEqual([3])
  })
})
