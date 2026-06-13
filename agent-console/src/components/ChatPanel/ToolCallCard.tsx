'use client'

import { useEffect } from 'react'
import type { ToolSegment } from '@/lib/stores/chatStore'

interface Props {
  segment: ToolSegment
  onAck: (callId: string) => void
  isSelected: boolean
  onClick: () => void
}

export function ToolCallCard({ segment, onAck, isSelected, onClick }: Props) {
  // Send TOOL_ACK the moment this card renders (within React commit phase)
  useEffect(() => {
    if (segment.status === 'pending') {
      onAck(segment.callId)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment.callId])

  const borderColor = isSelected ? 'border-blue-400' : 'border-zinc-600'

  return (
    <div
      className={`my-2 rounded-lg border ${borderColor} bg-zinc-800 text-sm cursor-pointer transition-colors hover:border-zinc-400`}
      data-call-id={segment.callId}
      onClick={onClick}
    >
      {/* Tool call header */}
      <div className="flex items-center gap-2 border-b border-zinc-700 px-3 py-2">
        <span className="font-mono text-xs text-purple-400">⚙ tool_call</span>
        <span className="font-semibold text-zinc-200">{segment.toolName}</span>
        <span className="ml-auto font-mono text-xs text-zinc-500">
          {segment.callId}
        </span>
      </div>

      {/* Args */}
      <div className="px-3 py-2">
        <div className="mb-1 text-xs font-medium text-zinc-400">args</div>
        <pre className="overflow-x-auto rounded bg-zinc-900 p-2 text-xs text-zinc-300">
          {JSON.stringify(segment.args, null, 2)}
        </pre>
      </div>

      {/* Result — shown once TOOL_RESULT arrives */}
      {segment.status === 'pending' ? (
        <div className="flex items-center gap-2 border-t border-zinc-700 px-3 py-2 text-xs text-zinc-500">
          <span className="h-2 w-2 animate-pulse rounded-full bg-yellow-400" />
          waiting for result…
        </div>
      ) : (
        <div className="border-t border-zinc-700 px-3 py-2">
          <div className="mb-1 text-xs font-medium text-green-400">result</div>
          <pre className="overflow-x-auto rounded bg-zinc-900 p-2 text-xs text-green-300">
            {JSON.stringify(segment.result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}
