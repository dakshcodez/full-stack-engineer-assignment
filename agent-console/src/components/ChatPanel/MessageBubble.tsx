'use client'

import { memo } from 'react'
import type { ChatMessage, AssistantMessage } from '@/lib/stores/chatStore'
import type { ClientMessage } from '@/lib/protocol/types'
import { ToolCallCard } from './ToolCallCard'
import { useChatStore } from '@/lib/stores/chatStore'
import { useTimelineStore } from '@/lib/stores/timelineStore'

interface Props {
  message: ChatMessage
  sendRaw: (msg: ClientMessage) => void
}

export const MessageBubble = memo(function MessageBubble({ message, sendRaw }: Props) {
  const selectedSegmentId = useChatStore((s) => s.selectedSegmentId)
  const setSelectedSegment = useChatStore((s) => s.setSelectedSegment)
  const setSelectedEvent = useTimelineStore((s) => s.setSelectedEvent)

  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] rounded-2xl bg-blue-600 px-4 py-2.5 text-sm text-white">
          {message.content}
        </div>
      </div>
    )
  }

  const am = message as AssistantMessage

  const handleToolClick = (callId: string) => {
    setSelectedSegment(callId)
    // Find the timeline event for this call_id and select it
    const events = useTimelineStore.getState().events
    const match = events.find(
      (e) =>
        e.kind === 'generic' &&
        e.msg.type === 'TOOL_CALL' &&
        e.msg.call_id === callId,
    )
    if (match) setSelectedEvent(match.id)
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-2xl bg-zinc-800 px-4 py-3 text-sm text-zinc-100">
        {am.segments.map((seg, i) => {
          if (seg.kind === 'tokens') {
            return (
              <span key={i} className="whitespace-pre-wrap leading-relaxed">
                {seg.text}
                {am.streamStatus === 'streaming' && i === am.segments.length - 1 && (
                  <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-zinc-400" />
                )}
              </span>
            )
          }

          return (
            <ToolCallCard
              key={seg.callId}
              segment={seg}
              isSelected={selectedSegmentId === seg.callId}
              onClick={() => handleToolClick(seg.callId)}
              onAck={(callId) => sendRaw({ type: 'TOOL_ACK', call_id: callId })}
            />
          )
        })}

        {am.streamStatus === 'complete' && am.segments.length === 0 && (
          <span className="text-zinc-500 italic">empty response</span>
        )}
      </div>
    </div>
  )
})
