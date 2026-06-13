'use client'

import { useCallback } from 'react'

export type EventTypeFilter =
  | 'TOKEN'
  | 'TOOL_CALL'
  | 'TOOL_RESULT'
  | 'CONTEXT_SNAPSHOT'
  | 'PING'
  | 'STREAM_END'
  | 'ERROR'

const ALL_TYPES: EventTypeFilter[] = [
  'TOKEN',
  'TOOL_CALL',
  'TOOL_RESULT',
  'CONTEXT_SNAPSHOT',
  'PING',
  'STREAM_END',
  'ERROR',
]

interface Props {
  activeTypes: Set<EventTypeFilter>
  search: string
  onTypesChange: (types: Set<EventTypeFilter>) => void
  onSearchChange: (q: string) => void
}

export function FilterBar({
  activeTypes,
  search,
  onTypesChange,
  onSearchChange,
}: Props) {
  const toggle = useCallback(
    (type: EventTypeFilter) => {
      const next = new Set(activeTypes)
      if (next.has(type)) {
        next.delete(type)
      } else {
        next.add(type)
      }
      onTypesChange(next)
    },
    [activeTypes, onTypesChange],
  )

  const allActive = activeTypes.size === ALL_TYPES.length

  return (
    <div className="flex flex-col gap-2 border-b border-zinc-700 px-3 py-2">
      {/* Search */}
      <input
        type="text"
        placeholder="Search events…"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        className="w-full rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:ring-1 focus:ring-zinc-500"
      />

      {/* Type chips */}
      <div className="flex flex-wrap gap-1">
        <button
          onClick={() =>
            onTypesChange(
              allActive ? new Set() : new Set(ALL_TYPES),
            )
          }
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
            allActive
              ? 'bg-zinc-500 text-white'
              : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
          }`}
        >
          ALL
        </button>
        {ALL_TYPES.map((type) => (
          <button
            key={type}
            onClick={() => toggle(type)}
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
              activeTypes.has(type)
                ? 'bg-zinc-500 text-white'
                : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700'
            }`}
          >
            {type}
          </button>
        ))}
      </div>
    </div>
  )
}

export { ALL_TYPES }
