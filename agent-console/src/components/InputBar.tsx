'use client'

import { useState, useRef, type KeyboardEvent } from 'react'
import { useConnectionStore } from '@/lib/stores/connectionStore'

interface Props {
  sendMessage: (content: string) => void
}

export function InputBar({ sendMessage }: Props) {
  const [value, setValue] = useState('')
  const status = useConnectionStore((s) => s.status)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const isDisabled = status !== 'connected' && status !== 'idle'

  const handleSend = () => {
    const trimmed = value.trim()
    if (!trimmed || isDisabled) return
    sendMessage(trimmed)
    setValue('')
    textareaRef.current?.focus()
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex items-end gap-2 border-t border-zinc-700 bg-zinc-900 px-4 py-3">
      <textarea
        ref={textareaRef}
        rows={1}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={
          isDisabled
            ? 'Reconnecting…'
            : 'Send a message… (Enter to send, Shift+Enter for newline)'
        }
        disabled={isDisabled}
        className="flex-1 resize-none rounded-xl bg-zinc-800 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:ring-1 focus:ring-zinc-500 disabled:opacity-50"
        style={{ maxHeight: '120px', overflowY: 'auto' }}
      />
      <button
        onClick={handleSend}
        disabled={!value.trim() || isDisabled}
        className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Send
      </button>
    </div>
  )
}
