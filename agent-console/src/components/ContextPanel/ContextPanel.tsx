'use client'

import { useMemo } from 'react'
import { useContextStore } from '@/lib/stores/contextStore'
import { JsonTree } from './JsonTree'

export function ContextPanel() {
  const histories = useContextStore((s) => s.histories)
  const activeContextId = useContextStore((s) => s.activeContextId)
  const setActiveContext = useContextStore((s) => s.setActiveContext)
  const setCurrentIndex = useContextStore((s) => s.setCurrentIndex)

  const contextIds = useMemo(() => Array.from(histories.keys()), [histories])
  const active = activeContextId ? histories.get(activeContextId) : null
  const snapshot = active
    ? active.snapshots[active.currentIndex] ?? null
    : null

  return (
    <div className="flex h-full flex-col border-l border-zinc-700 bg-zinc-900">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-700 px-3 py-2">
        <span className="text-xs font-semibold text-zinc-300">Context Inspector</span>
        {snapshot && (
          <span className="text-xs text-zinc-500">
            {Math.round(JSON.stringify(snapshot.data).length / 1024)}KB
          </span>
        )}
      </div>

      {contextIds.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-zinc-600">
          No context received
        </div>
      ) : (
        <>
          {/* Context ID tabs */}
          {contextIds.length > 1 && (
            <div className="flex gap-1 border-b border-zinc-700 px-2 py-1.5 overflow-x-auto">
              {contextIds.map((id) => (
                <button
                  key={id}
                  onClick={() => setActiveContext(id)}
                  className={`shrink-0 rounded px-2 py-0.5 text-xs transition-colors ${
                    id === activeContextId
                      ? 'bg-zinc-600 text-zinc-100'
                      : 'text-zinc-400 hover:bg-zinc-800'
                  }`}
                >
                  {id}
                </button>
              ))}
            </div>
          )}

          {active && (
            <>
              {/* History scrubber */}
              {active.snapshots.length > 1 && (
                <div className="border-b border-zinc-700 px-3 py-2">
                  <div className="mb-1 flex items-center justify-between text-xs text-zinc-400">
                    <span>Snapshot history</span>
                    <span>
                      {active.currentIndex + 1} / {active.snapshots.length}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={active.snapshots.length - 1}
                    value={active.currentIndex}
                    onChange={(e) =>
                      setCurrentIndex(
                        active.contextId,
                        Number(e.target.value),
                      )
                    }
                    className="w-full accent-blue-500"
                  />
                  {/* Diff legend */}
                  {snapshot?.diff && (
                    <div className="mt-1.5 flex gap-3 text-[10px]">
                      <span className="text-green-400">■ added</span>
                      <span className="text-red-400">■ removed</span>
                      <span className="text-yellow-400">■ changed</span>
                    </div>
                  )}
                </div>
              )}

              {/* JSON tree */}
              {snapshot && (
                <div className="flex-1 overflow-y-auto px-2 py-2">
                  <JsonTree
                    data={snapshot.data}
                    diff={snapshot.diff ?? undefined}

                  />
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
