'use client'

import { useState, memo } from 'react'
import type { DiffNode } from '@/lib/diff/jsonDiff'
import { hasChanges } from '@/lib/diff/jsonDiff'

interface Props {
  data: unknown
  diff?: DiffNode
  depth?: number
  path?: string
}

function diffBg(node: DiffNode | undefined): string {
  if (!node) return ''
  switch (node.kind) {
    case 'added':
      return 'bg-green-900/40 border-l-2 border-green-500'
    case 'removed':
      return 'bg-red-900/40 border-l-2 border-red-500'
    case 'changed':
      return 'bg-yellow-900/40 border-l-2 border-yellow-500'
    default:
      return ''
  }
}

function Primitive({ value, diff }: { value: unknown; diff?: DiffNode }) {
  const str =
    value === null
      ? 'null'
      : typeof value === 'string'
        ? `"${value}"`
        : String(value)

  const color =
    typeof value === 'string'
      ? 'text-green-400'
      : typeof value === 'number'
        ? 'text-blue-400'
        : typeof value === 'boolean'
          ? 'text-yellow-400'
          : 'text-zinc-400'

  if (diff?.kind === 'changed') {
    return (
      <span>
        <span className="text-red-400 line-through mr-1">
          {typeof diff.from === 'string' ? `"${diff.from}"` : String(diff.from)}
        </span>
        <span className={color}>{str}</span>
      </span>
    )
  }

  return <span className={color}>{str}</span>
}

export const JsonTree = memo(function JsonTree({
  data,
  diff,
  depth = 0,
  path = 'root',
}: Props) {
  const [expanded, setExpanded] = useState(depth < 2)

  const indent = depth * 12

  // Primitive value
  if (
    data === null ||
    typeof data !== 'object' ||
    (!Array.isArray(data) && !(typeof data === 'object'))
  ) {
    return (
      <span className={`pl-[${indent}px] ${diffBg(diff)}`}>
        <Primitive value={data} diff={diff} />
      </span>
    )
  }

  const isArray = Array.isArray(data)
  const entries = isArray
    ? (data as unknown[]).map((v, i) => [String(i), v] as [string, unknown])
    : Object.entries(data as Record<string, unknown>)

  const brackets = isArray ? ['[', ']'] : ['{', '}']
  const childDiffs =
    diff?.kind === 'object'
      ? diff.children
      : diff?.kind === 'array'
        ? Object.fromEntries(
            diff.children.map((c, i) => [String(i), c]),
          )
        : {}

  const hasChildChanges =
    diff ? hasChanges(diff) : false

  const rowBg = diffBg(diff)

  return (
    <div style={{ paddingLeft: indent }} className="font-mono text-xs">
      <button
        onClick={() => setExpanded((v) => !v)}
        className={`flex items-center gap-1 rounded px-1 text-left hover:bg-zinc-700/50 w-full ${rowBg}`}
      >
        <span className="text-zinc-500 select-none w-3">
          {entries.length > 0 ? (expanded ? '▼' : '▶') : ' '}
        </span>
        <span className="text-zinc-300">{brackets[0]}</span>
        {!expanded && (
          <>
            <span className="text-zinc-500">
              {entries.length} {isArray ? 'items' : 'keys'}
            </span>
            {hasChildChanges && (
              <span className="ml-1 rounded bg-yellow-700/50 px-1 text-[10px] text-yellow-300">
                changes
              </span>
            )}
          </>
        )}
        {!expanded && <span className="text-zinc-300">{brackets[1]}</span>}
      </button>

      {expanded && (
        <div>
          {entries.map(([key, val]) => {
            const childDiff = childDiffs[key]
            const childBg = diffBg(childDiff)
            const isPrimitive =
              val === null || typeof val !== 'object'

            return (
              <div key={key} className={`flex ${childBg}`}>
                <span className="text-zinc-500 shrink-0 select-none mr-1 pl-3">
                  {isArray ? '' : `${key}: `}
                </span>
                {isPrimitive ? (
                  <Primitive value={val} diff={childDiff} />
                ) : (
                  <JsonTree
                    data={val}
                    diff={childDiff}
                    depth={depth + 1}
                    path={`${path}.${key}`}
                  />
                )}
              </div>
            )
          })}
          <div style={{ paddingLeft: 12 }} className="text-zinc-300">
            {brackets[1]}
          </div>
        </div>
      )}
    </div>
  )
})
