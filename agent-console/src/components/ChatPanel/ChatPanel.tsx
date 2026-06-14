'use client'

import { useLayoutEffect, useRef } from 'react'
import { useChatStore } from '@/lib/stores/chatStore'
import { MessageBubble } from './MessageBubble'
import type { ClientMessage } from '@/lib/protocol/types'

interface Props {
  sendRaw: (msg: ClientMessage) => void
}

export function ChatPanel({ sendRaw }: Props) {
  const messages = useChatStore((s) => s.messages)
  const containerRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(true)
  const rafRef = useRef<number | null>(null)

  // After every render: if pinned to bottom, scroll there instantly via rAF.
  // useLayoutEffect (no deps) runs after every commit, catching both new messages
  // and token updates within an existing message — which never change messages.length.
  useLayoutEffect(() => {
    if (!isAtBottomRef.current) return
    if (rafRef.current !== null) return // already queued
    rafRef.current = requestAnimationFrame(() => {
      const el = containerRef.current
      if (el) el.scrollTop = el.scrollHeight
      rafRef.current = null
    })
  })

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    // User is "at bottom" if within 80px — unpin only on deliberate scroll-up
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  return (
    <div
      ref={containerRef}
      className="flex h-full flex-col overflow-y-auto px-4 py-4 space-y-4"
      onScroll={handleScroll}
    >
      {messages.length === 0 && (
        <div className="flex flex-1 items-center justify-center text-zinc-500 text-sm">
          Send a message to start
        </div>
      )}
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} sendRaw={sendRaw} />
      ))}
      {/* Spacer keeps the last message from sitting flush at the bottom */}
      <div className="h-2 shrink-0" />
    </div>
  )
}
