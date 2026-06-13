'use client'

import { create } from 'zustand'
import type { ConnectionStatus } from '@/lib/protocol/WsManager'

interface ConnectionState {
  status: ConnectionStatus
  attempt: number
}

interface ConnectionActions {
  setStatus: (status: ConnectionStatus) => void
  incrementAttempt: () => void
  resetAttempt: () => void
}

export const useConnectionStore = create<ConnectionState & ConnectionActions>(
  (set) => ({
    status: 'idle',
    attempt: 0,
    setStatus: (status) =>
      set((s) => ({
        status,
        attempt: status === 'reconnecting' ? s.attempt + 1 : s.attempt,
      })),
    incrementAttempt: () => set((s) => ({ attempt: s.attempt + 1 })),
    resetAttempt: () => set({ attempt: 0 }),
  }),
)
