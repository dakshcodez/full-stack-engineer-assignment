'use client'

import { useConnectionStore } from '@/lib/stores/connectionStore'

export function ConnectionStatus() {
  const { status, attempt } = useConnectionStore()

  if (status === 'connected' || status === 'idle') return null

  const labels: Record<string, string> = {
    connecting: 'Connecting…',
    reconnecting: `Reconnecting… (attempt ${attempt})`,
    resuming: 'Resuming session…',
    disconnected: 'Disconnected',
  }

  const colors: Record<string, string> = {
    connecting: 'bg-yellow-500',
    reconnecting: 'bg-orange-500',
    resuming: 'bg-blue-500',
    disconnected: 'bg-red-500',
  }

  const label = labels[status] ?? status
  const color = colors[status] ?? 'bg-gray-500'

  return (
    <div
      className={`fixed top-3 right-3 z-50 flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium text-white shadow-lg ${color}`}
      role="status"
      aria-live="polite"
    >
      <span className="h-2 w-2 animate-pulse rounded-full bg-white/70" />
      {label}
    </div>
  )
}
