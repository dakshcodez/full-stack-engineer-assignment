'use client'

import { memo, useState } from 'react'
import type { TimelineEvent } from '@/lib/stores/timelineStore'

interface Props {
  event: TimelineEvent
  isSelected: boolean
  onClick: () => void
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function eventLabel(event: TimelineEvent): {
  badge: string
  badgeColor: string
  summary: string
} {
  if (event.kind === 'token_batch') {
    const dur = event.endTime - event.startTime
    return {
      badge: 'TOKEN',
      badgeColor: 'bg-zinc-600 text-zinc-200',
      summary: `Streamed ${event.count} token${event.count !== 1 ? 's' : ''} (${formatMs(dur)})`,
    }
  }

  const msg = event.msg
  switch (msg.type) {
    case 'TOOL_CALL':
      return {
        badge: 'TOOL_CALL',
        badgeColor: 'bg-purple-700 text-purple-100',
        summary: `${msg.tool_name} — ${msg.call_id}`,
      }
    case 'TOOL_RESULT':
      return {
        badge: 'TOOL_RESULT',
        badgeColor: 'bg-green-800 text-green-100',
        summary: msg.call_id,
      }
    case 'CONTEXT_SNAPSHOT':
      return {
        badge: 'CONTEXT',
        badgeColor: 'bg-blue-700 text-blue-100',
        summary: msg.context_id,
      }
    case 'PING':
      return {
        badge: 'PING',
        badgeColor: 'bg-yellow-700 text-yellow-100',
        summary: msg.challenge ? `challenge: ${msg.challenge}` : 'corrupt (empty challenge)',
      }
    case 'STREAM_END':
      return {
        badge: 'STREAM_END',
        badgeColor: 'bg-teal-700 text-teal-100',
        summary: msg.stream_id,
      }
    case 'ERROR':
      return {
        badge: 'ERROR',
        badgeColor: 'bg-red-700 text-red-100',
        summary: `${msg.code}: ${msg.message}`,
      }
    default:
      return {
        badge: 'UNKNOWN',
        badgeColor: 'bg-zinc-700 text-zinc-100',
        summary: '',
      }
  }
}

export const TimelineRow = memo(function TimelineRow({
  event,
  isSelected,
  onClick,
}: Props) {
  const [expanded, setExpanded] = useState(false)
  const { badge, badgeColor, summary } = eventLabel(event)

  const seq =
    event.kind === 'token_batch'
      ? `${event.seqStart}–${event.seqEnd}`
      : event.msg.seq.toString()

  const isToolCall =
    event.kind === 'generic' && event.msg.type === 'TOOL_CALL'
  const isToolResult =
    event.kind === 'generic' && event.msg.type === 'TOOL_RESULT'

  return (
    <div
      className={`group flex flex-col border-b border-zinc-800 px-3 py-2 text-xs cursor-pointer transition-colors ${
        isSelected ? 'bg-zinc-700' : 'hover:bg-zinc-800/60'
      }`}
      onClick={onClick}
    >
      <div className="flex items-center gap-2">
        {/* Visual connector for tool call/result pairs */}
        {(isToolCall || isToolResult) && (
          <div className="h-4 w-0.5 shrink-0 rounded bg-purple-500" />
        )}

        <span
          className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${badgeColor}`}
        >
          {badge}
        </span>

        <span className="truncate text-zinc-300">{summary}</span>

        <span className="ml-auto shrink-0 font-mono text-zinc-600">
          seq {seq}
        </span>

        {/* Expand button for token batches */}
        {event.kind === 'token_batch' && (
          <button
            className="shrink-0 rounded px-1 text-zinc-500 hover:text-zinc-200"
            onClick={(e) => {
              e.stopPropagation()
              setExpanded((v) => !v)
            }}
          >
            {expanded ? '▲' : '▼'}
          </button>
        )}
      </div>

      {/* Expanded token text */}
      {expanded && event.kind === 'token_batch' && (
        <div className="mt-2 rounded bg-zinc-900 p-2 font-mono text-zinc-300 text-[11px] leading-relaxed whitespace-pre-wrap break-all">
          {event.text}
        </div>
      )}
    </div>
  )
})
