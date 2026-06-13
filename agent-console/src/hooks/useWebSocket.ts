'use client'

import { useEffect, useRef } from 'react'
import { WsManager } from '@/lib/protocol/WsManager'
import type { ClientMessage, ServerMessage } from '@/lib/protocol/types'
import { useConnectionStore } from '@/lib/stores/connectionStore'
import { useChatStore } from '@/lib/stores/chatStore'
import { useTimelineStore } from '@/lib/stores/timelineStore'
import { useContextStore } from '@/lib/stores/contextStore'

// Singleton manager — persists across renders. Created once per app mount.
let _manager: WsManager | null = null

function getManager(): WsManager {
  if (!_manager) _manager = new WsManager()
  return _manager
}

// Routes an ordered ServerMessage to the correct stores.
function routeMessage(msg: ServerMessage): void {
  const chat = useChatStore.getState()
  const timeline = useTimelineStore.getState()
  const context = useContextStore.getState()

  // Always add to timeline
  timeline.addEvent(msg)

  switch (msg.type) {
    case 'TOKEN':
      chat.handleToken(msg)
      break
    case 'TOOL_CALL':
      chat.handleToolCall(msg)
      break
    case 'TOOL_RESULT':
      chat.handleToolResult(msg)
      break
    case 'STREAM_END':
      chat.handleStreamEnd(msg)
      break
    case 'CONTEXT_SNAPSHOT':
      context.addSnapshot(msg)
      break
    case 'PING':
    case 'ERROR':
      // Handled by WsManager (PING) or shown in timeline (ERROR); no chat action
      break
  }
}

export function useWebSocket() {
  const managerRef = useRef<WsManager>(getManager())

  useEffect(() => {
    const mgr = managerRef.current

    mgr.onStatusChange = (status) => {
      const conn = useConnectionStore.getState()
      conn.setStatus(status)
    }

    mgr.onMessage = routeMessage

    mgr.connect()

    return () => {
      // Don't destroy on unmount — StrictMode double-mounts would cause issues.
      // The manager is a singleton; disconnect is called only on explicit teardown.
    }
  }, [])

  const sendMessage = (content: string) => {
    const mgr = managerRef.current
    // Reset buffer seq tracking for the new conversation turn
    // (server resets seq to 1 on each USER_MESSAGE)
    mgr.resetBuffer()
    useChatStore.getState().addUserMessage(content)
    mgr.send({ type: 'USER_MESSAGE', content })
  }

  const sendRaw = (msg: ClientMessage) => {
    managerRef.current.send(msg)
  }

  return { sendMessage, sendRaw }
}
