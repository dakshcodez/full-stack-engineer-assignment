'use client'

import { useEffect, useRef } from 'react'
import { WsManager } from '@/lib/protocol/WsManager'
import type { ClientMessage, ServerMessage } from '@/lib/protocol/types'
import { useConnectionStore } from '@/lib/stores/connectionStore'
import { useChatStore } from '@/lib/stores/chatStore'
import { useTimelineStore } from '@/lib/stores/timelineStore'
import { useContextStore } from '@/lib/stores/contextStore'

// Attach the singleton to window so it survives HMR module reloads in dev.
// In production builds there is no HMR, so a plain module-level var is fine —
// but using window is safe in both environments.
declare global {
  interface Window {
    __agentWsManager?: WsManager
  }
}

function getOrCreateManager(): WsManager {
  if (typeof window === 'undefined') {
    // SSR — return a no-op instance; it will never be used (effects don't run server-side)
    return new WsManager()
  }
  if (!window.__agentWsManager) {
    window.__agentWsManager = new WsManager()
  }
  return window.__agentWsManager
}

// Routes an ordered ServerMessage to the correct stores.
function routeMessage(msg: ServerMessage): void {
  const chat = useChatStore.getState()
  const timeline = useTimelineStore.getState()
  const context = useContextStore.getState()

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
      break
  }
}

export function useWebSocket() {
  const managerRef = useRef<WsManager | null>(null)

  useEffect(() => {
    const mgr = getOrCreateManager()
    managerRef.current = mgr

    mgr.onStatusChange = (status) => {
      useConnectionStore.getState().setStatus(status)
    }
    mgr.onMessage = routeMessage

    // Immediately push the current status — the callback may have been detached
    // during a StrictMode/HMR cleanup cycle while the socket stayed open, so the
    // store might be stale even though the manager is already 'connected'.
    useConnectionStore.getState().setStatus(mgr.getStatus())

    mgr.connect()

    return () => {
      // Detach callbacks but keep the connection alive across HMR remounts.
      // The window-persisted singleton stays connected; only a full page reload
      // or explicit disconnect() call will tear it down.
      mgr.onMessage = () => {}
      mgr.onStatusChange = () => {}
    }
  }, [])

  const sendMessage = (content: string) => {
    const mgr = managerRef.current
    if (!mgr) return
    // Server resets seq to 1 on each USER_MESSAGE — reset our buffer to match.
    mgr.resetBuffer()
    useChatStore.getState().addUserMessage(content)
    mgr.send({ type: 'USER_MESSAGE', content })
  }

  const sendRaw = (msg: ClientMessage) => {
    managerRef.current?.send(msg)
  }

  return { sendMessage, sendRaw }
}
