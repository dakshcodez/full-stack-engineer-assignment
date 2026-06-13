'use client'

import { create } from 'zustand'
import type {
  TokenMessage,
  ToolCallMessage,
  ToolResultMessage,
  StreamEndMessage,
} from '@/lib/protocol/types'

// An assistant message is rendered as an ordered list of segments.
// Tokens arrive before/after tool calls, so we interleave them.
export type TokenSegment = {
  kind: 'tokens'
  text: string
}

export type ToolSegment = {
  kind: 'tool'
  callId: string
  toolName: string
  args: Record<string, unknown>
  result: Record<string, unknown> | null
  status: 'pending' | 'complete'
}

export type Segment = TokenSegment | ToolSegment

export type StreamStatus = 'streaming' | 'paused' | 'complete'

export interface AssistantMessage {
  id: string
  streamId: string
  segments: Segment[]
  streamStatus: StreamStatus
  // call_ids awaiting TOOL_RESULT (handles rapid back-to-back tool calls)
  pendingCallIds: Set<string>
}

export interface UserMessage {
  id: string
  role: 'user'
  content: string
}

export type ChatMessage = UserMessage | AssistantMessage

interface ChatState {
  messages: ChatMessage[]
  // map streamId → index in messages for O(1) lookup
  streamIndex: Map<string, number>
  selectedSegmentId: string | null
}

interface ChatActions {
  addUserMessage: (content: string) => void
  handleToken: (msg: TokenMessage) => void
  handleToolCall: (msg: ToolCallMessage) => void
  handleToolResult: (msg: ToolResultMessage) => void
  handleStreamEnd: (msg: StreamEndMessage) => void
  setSelectedSegment: (id: string | null) => void
  reset: () => void
}

const initialState: ChatState = {
  messages: [],
  streamIndex: new Map(),
  selectedSegmentId: null,
}

export const useChatStore = create<ChatState & ChatActions>((set) => ({
  ...initialState,

  addUserMessage: (content) =>
    set((s) => ({
      messages: [
        ...s.messages,
        { id: crypto.randomUUID(), role: 'user', content } satisfies UserMessage,
      ],
    })),

  handleToken: (msg) =>
    set((s) => {
      const idx = s.streamIndex.get(msg.stream_id)
      if (idx === undefined) {
        // New stream — create assistant message
        const newMsg: AssistantMessage = {
          id: crypto.randomUUID(),
          streamId: msg.stream_id,
          segments: [{ kind: 'tokens', text: msg.text }],
          streamStatus: 'streaming',
          pendingCallIds: new Set(),
        }
        const newMessages = [...s.messages, newMsg]
        const newIndex = new Map(s.streamIndex)
        newIndex.set(msg.stream_id, newMessages.length - 1)
        return { messages: newMessages, streamIndex: newIndex }
      }

      // Existing stream — append to last token segment
      const messages = s.messages.map((m, i) => {
        if (i !== idx) return m
        const am = m as AssistantMessage
        const segments = [...am.segments]
        const last = segments[segments.length - 1]
        if (last && last.kind === 'tokens') {
          segments[segments.length - 1] = {
            kind: 'tokens',
            text: last.text + msg.text,
          }
        } else {
          segments.push({ kind: 'tokens', text: msg.text })
        }
        return { ...am, segments }
      })
      return { messages }
    }),

  handleToolCall: (msg) =>
    set((s) => {
      const idx = s.streamIndex.get(msg.stream_id)
      let messages = s.messages
      let streamIndex = s.streamIndex

      if (idx === undefined) {
        // Tool call before any tokens (lookup script)
        const newMsg: AssistantMessage = {
          id: crypto.randomUUID(),
          streamId: msg.stream_id,
          segments: [],
          streamStatus: 'paused',
          pendingCallIds: new Set([msg.call_id]),
        }
        const newMessages = [...s.messages, newMsg]
        const newIndex = new Map(s.streamIndex)
        newIndex.set(msg.stream_id, newMessages.length - 1)
        newMsg.segments.push({
          kind: 'tool',
          callId: msg.call_id,
          toolName: msg.tool_name,
          args: msg.args,
          result: null,
          status: 'pending',
        })
        return { messages: newMessages, streamIndex: newIndex }
      }

      messages = s.messages.map((m, i) => {
        if (i !== idx) return m
        const am = m as AssistantMessage
        const pending = new Set(am.pendingCallIds)
        pending.add(msg.call_id)
        return {
          ...am,
          streamStatus: 'paused' as StreamStatus,
          pendingCallIds: pending,
          segments: [
            ...am.segments,
            {
              kind: 'tool' as const,
              callId: msg.call_id,
              toolName: msg.tool_name,
              args: msg.args,
              result: null,
              status: 'pending' as const,
            },
          ],
        }
      })
      return { messages, streamIndex }
    }),

  handleToolResult: (msg) =>
    set((s) => {
      const idx = s.streamIndex.get(msg.stream_id)
      if (idx === undefined) return s

      const messages = s.messages.map((m, i) => {
        if (i !== idx) return m
        const am = m as AssistantMessage
        const pending = new Set(am.pendingCallIds)
        pending.delete(msg.call_id)

        const segments = am.segments.map((seg) => {
          if (seg.kind === 'tool' && seg.callId === msg.call_id) {
            return { ...seg, result: msg.result, status: 'complete' as const }
          }
          return seg
        })

        return {
          ...am,
          segments,
          pendingCallIds: pending,
          streamStatus: (pending.size === 0
            ? 'streaming'
            : 'paused') as StreamStatus,
        }
      })
      return { messages }
    }),

  handleStreamEnd: (msg) =>
    set((s) => {
      const idx = s.streamIndex.get(msg.stream_id)
      if (idx === undefined) return s

      const messages = s.messages.map((m, i) => {
        if (i !== idx) return m
        return { ...(m as AssistantMessage), streamStatus: 'complete' as StreamStatus }
      })
      return { messages }
    }),

  setSelectedSegment: (id) => set({ selectedSegmentId: id }),

  reset: () => set({ ...initialState, streamIndex: new Map() }),
}))
