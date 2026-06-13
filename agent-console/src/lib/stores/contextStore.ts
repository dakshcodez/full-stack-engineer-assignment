'use client'

import { create } from 'zustand'
import type { ContextSnapshotMessage } from '@/lib/protocol/types'
import { computeDiff } from '@/lib/diff/jsonDiff'
import type { DiffNode } from '@/lib/diff/jsonDiff'

export interface ContextSnapshot {
  seq: number
  data: Record<string, unknown>
  diff: DiffNode | null  // null for the first snapshot (no previous to diff against)
  timestamp: number
}

export interface ContextHistory {
  contextId: string
  snapshots: ContextSnapshot[]
  currentIndex: number
}

interface ContextState {
  histories: Map<string, ContextHistory>
  activeContextId: string | null
}

interface ContextActions {
  addSnapshot: (msg: ContextSnapshotMessage) => void
  setActiveContext: (id: string) => void
  setCurrentIndex: (contextId: string, index: number) => void
  reset: () => void
}

export const useContextStore = create<ContextState & ContextActions>(
  (set, get) => ({
    histories: new Map(),
    activeContextId: null,

    addSnapshot: (msg) => {
      const { histories } = get()
      const existing = histories.get(msg.context_id)

      const prevData =
        existing && existing.snapshots.length > 0
          ? existing.snapshots[existing.snapshots.length - 1]?.data ?? null
          : null

      const diff = prevData ? computeDiff(prevData, msg.data) : null

      const snapshot: ContextSnapshot = {
        seq: msg.seq,
        data: msg.data,
        diff,
        timestamp: Date.now(),
      }

      const updated = new Map(histories)
      if (existing) {
        updated.set(msg.context_id, {
          ...existing,
          snapshots: [...existing.snapshots, snapshot],
          currentIndex: existing.snapshots.length, // point to new snapshot
        })
      } else {
        updated.set(msg.context_id, {
          contextId: msg.context_id,
          snapshots: [snapshot],
          currentIndex: 0,
        })
      }

      set((s) => ({
        histories: updated,
        activeContextId: s.activeContextId ?? msg.context_id,
      }))
    },

    setActiveContext: (id) => set({ activeContextId: id }),

    setCurrentIndex: (contextId, index) => {
      const { histories } = get()
      const h = histories.get(contextId)
      if (!h) return
      const updated = new Map(histories)
      updated.set(contextId, { ...h, currentIndex: index })
      set({ histories: updated })
    },

    reset: () => set({ histories: new Map(), activeContextId: null }),
  }),
)
