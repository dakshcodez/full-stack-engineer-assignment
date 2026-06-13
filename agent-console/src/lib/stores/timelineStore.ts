'use client'

import { create } from 'zustand'
import type { ServerMessage } from '@/lib/protocol/types'

// Timeline events — every server message gets a row, but consecutive TOKEN
// messages are collapsed into a single expandable batch.

export interface TokenBatchEvent {
  kind: 'token_batch'
  id: string
  streamId: string
  count: number
  text: string
  startTime: number
  endTime: number
  seqStart: number
  seqEnd: number
}

export interface GenericEvent {
  kind: 'generic'
  id: string
  msg: ServerMessage
  time: number
}

export type TimelineEvent = TokenBatchEvent | GenericEvent

interface TimelineState {
  events: TimelineEvent[]
  selectedEventId: string | null
  // rAF batching internals (not in Zustand — refs in the store module)
}

interface TimelineActions {
  addEvent: (msg: ServerMessage) => void
  flushTokenBatch: () => void
  setSelectedEvent: (id: string | null) => void
  reset: () => void
}

// Current in-flight token batch tracked outside Zustand to avoid triggering
// re-renders on every token.
let _currentBatch: TokenBatchEvent | null = null
let _rafHandle: number | null = null

function scheduleBatchFlush(flush: () => void): void {
  if (_rafHandle !== null) return
  _rafHandle =
    typeof requestAnimationFrame !== 'undefined'
      ? requestAnimationFrame(() => {
          _rafHandle = null
          flush()
        })
      : (setTimeout(() => {
          _rafHandle = null
          flush()
        }, 16) as unknown as number)
}

export const useTimelineStore = create<TimelineState & TimelineActions>(
  (set, get) => ({
    events: [],
    selectedEventId: null,

    addEvent: (msg) => {
      if (msg.type === 'TOKEN') {
        if (
          _currentBatch &&
          _currentBatch.streamId === msg.stream_id
        ) {
          // Update the in-flight batch without touching Zustand state
          _currentBatch.count++
          _currentBatch.text += msg.text
          _currentBatch.endTime = Date.now()
          _currentBatch.seqEnd = msg.seq
        } else {
          // Flush any existing batch for a different stream, then start new
          get().flushTokenBatch()
          _currentBatch = {
            kind: 'token_batch',
            id: crypto.randomUUID(),
            streamId: msg.stream_id,
            count: 1,
            text: msg.text,
            startTime: Date.now(),
            endTime: Date.now(),
            seqStart: msg.seq,
            seqEnd: msg.seq,
          }
        }
        scheduleBatchFlush(() => get().flushTokenBatch())
        return
      }

      // Non-token event: flush current batch first, then append
      get().flushTokenBatch()
      const event: GenericEvent = {
        kind: 'generic',
        id: crypto.randomUUID(),
        msg,
        time: Date.now(),
      }
      set((s) => ({ events: [...s.events, event] }))
    },

    flushTokenBatch: () => {
      if (!_currentBatch) return
      const batch = { ..._currentBatch }
      _currentBatch = null
      set((s) => ({ events: [...s.events, batch] }))
    },

    setSelectedEvent: (id) => set({ selectedEventId: id }),

    reset: () => {
      _currentBatch = null
      if (_rafHandle !== null) {
        if (typeof cancelAnimationFrame !== 'undefined') {
          cancelAnimationFrame(_rafHandle)
        } else {
          clearTimeout(_rafHandle)
        }
        _rafHandle = null
      }
      set({ events: [], selectedEventId: null })
    },
  }),
)
