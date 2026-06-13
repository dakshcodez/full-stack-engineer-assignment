'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useTimelineStore } from '@/lib/stores/timelineStore'
import { useChatStore } from '@/lib/stores/chatStore'
import { TimelineRow } from './TimelineRow'
import { FilterBar, ALL_TYPES } from './FilterBar'
import type { EventTypeFilter } from './FilterBar'
import type { TimelineEvent } from '@/lib/stores/timelineStore'

function matchesFilter(
  event: TimelineEvent,
  activeTypes: Set<EventTypeFilter>,
  search: string,
): boolean {
  // Type filter
  const type: EventTypeFilter =
    event.kind === 'token_batch'
      ? 'TOKEN'
      : (event.msg.type as EventTypeFilter)
  if (!activeTypes.has(type)) return false

  // Text search (case-insensitive)
  if (!search) return true
  const q = search.toLowerCase()
  if (event.kind === 'token_batch') return event.text.toLowerCase().includes(q)
  return JSON.stringify(event.msg).toLowerCase().includes(q)
}

export function TimelinePanel() {
  const events = useTimelineStore((s) => s.events)
  const selectedEventId = useTimelineStore((s) => s.selectedEventId)
  const setSelectedEvent = useTimelineStore((s) => s.setSelectedEvent)
  const setSelectedSegment = useChatStore((s) => s.setSelectedSegment)

  const [activeTypes, setActiveTypes] = useState<Set<EventTypeFilter>>(
    new Set(ALL_TYPES),
  )
  const [search, setSearch] = useState('')

  const filtered = useMemo(
    () => events.filter((e) => matchesFilter(e, activeTypes, search)),
    [events, activeTypes, search],
  )

  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 38,
    overscan: 10,
  })

  // Auto-scroll to bottom when new events arrive (only if already at bottom)
  const isAtBottomRef = useRef(true)
  useEffect(() => {
    if (isAtBottomRef.current && filtered.length > 0) {
      virtualizer.scrollToIndex(filtered.length - 1, { behavior: 'smooth' })
    }
  }, [filtered.length, virtualizer])

  // Scroll to selected event (bidirectional: triggered by chat panel clicks)
  useEffect(() => {
    if (!selectedEventId) return
    const idx = filtered.findIndex((e) => e.id === selectedEventId)
    if (idx !== -1) {
      virtualizer.scrollToIndex(idx, { behavior: 'smooth' })
    }
  }, [selectedEventId, filtered, virtualizer])

  const handleRowClick = useCallback(
    (event: TimelineEvent) => {
      setSelectedEvent(event.id)

      // If it's a TOOL_CALL or TOOL_RESULT, also select the matching chat segment
      if (event.kind === 'generic') {
        if (
          event.msg.type === 'TOOL_CALL' ||
          event.msg.type === 'TOOL_RESULT'
        ) {
          setSelectedSegment(event.msg.call_id)
        }
      }
    },
    [setSelectedEvent, setSelectedSegment],
  )

  return (
    <div className="flex h-full flex-col border-l border-zinc-700 bg-zinc-900">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-700 px-3 py-2">
        <span className="text-xs font-semibold text-zinc-300">
          Agent Trace
        </span>
        <span className="text-xs text-zinc-500">{filtered.length} events</span>
      </div>

      {/* Filter bar */}
      <FilterBar
        activeTypes={activeTypes}
        search={search}
        onTypesChange={setActiveTypes}
        onSearchChange={setSearch}
      />

      {/* Virtualized event list */}
      <div
        ref={parentRef}
        className="flex-1 overflow-y-auto"
        onScroll={(e) => {
          const el = e.currentTarget
          isAtBottomRef.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 60
        }}
      >
        {filtered.length === 0 ? (
          <div className="p-4 text-center text-xs text-zinc-600">
            No events yet
          </div>
        ) : (
          <div
            style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}
          >
            {virtualizer.getVirtualItems().map((vItem) => {
              const event = filtered[vItem.index]
              if (!event) return null
              return (
                <div
                  key={vItem.key}
                  data-index={vItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${vItem.start}px)`,
                  }}
                >
                  <TimelineRow
                    event={event}
                    isSelected={selectedEventId === event.id}
                    onClick={() => handleRowClick(event)}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
