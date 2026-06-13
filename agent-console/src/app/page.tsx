'use client'

import { useWebSocket } from '@/hooks/useWebSocket'
import { ChatPanel } from '@/components/ChatPanel/ChatPanel'
import { TimelinePanel } from '@/components/TimelinePanel/TimelinePanel'
import { ContextPanel } from '@/components/ContextPanel/ContextPanel'
import { ConnectionStatus } from '@/components/ConnectionStatus'
import { InputBar } from '@/components/InputBar'

export default function Home() {
  // Mount the WebSocket connection for the entire app
  useWebSocket()

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      <ConnectionStatus />

      {/* Three-panel layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Chat — takes remaining space */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            <ChatPanel />
          </div>
          <InputBar />
        </div>

        {/* Timeline — fixed width, scrollable */}
        <div className="hidden w-72 flex-col overflow-hidden lg:flex">
          <TimelinePanel />
        </div>

        {/* Context Inspector — fixed width, scrollable */}
        <div className="hidden w-80 flex-col overflow-hidden xl:flex">
          <ContextPanel />
        </div>
      </div>
    </div>
  )
}
