// Recursive JSON diff — produces a DiffNode tree describing what changed
// between two arbitrary JSON objects.

export type DiffNode =
  | { kind: 'added'; value: unknown }
  | { kind: 'removed'; value: unknown }
  | { kind: 'changed'; from: unknown; to: unknown }
  | { kind: 'unchanged'; value: unknown }
  | { kind: 'object'; children: Record<string, DiffNode> }
  | { kind: 'array'; children: DiffNode[] }

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function computeDiff(
  prev: unknown,
  next: unknown,
): DiffNode {
  // Both objects
  if (isPlainObject(prev) && isPlainObject(next)) {
    const keys = new Set([...Object.keys(prev), ...Object.keys(next)])
    const children: Record<string, DiffNode> = {}
    for (const key of keys) {
      const hasPrev = Object.prototype.hasOwnProperty.call(prev, key)
      const hasNext = Object.prototype.hasOwnProperty.call(next, key)
      if (!hasPrev) {
        children[key] = { kind: 'added', value: next[key] }
      } else if (!hasNext) {
        children[key] = { kind: 'removed', value: prev[key] }
      } else {
        children[key] = computeDiff(prev[key], next[key])
      }
    }
    return { kind: 'object', children }
  }

  // Both arrays
  if (Array.isArray(prev) && Array.isArray(next)) {
    const len = Math.max(prev.length, next.length)
    const children: DiffNode[] = []
    for (let i = 0; i < len; i++) {
      if (i >= prev.length) {
        children.push({ kind: 'added', value: next[i] })
      } else if (i >= next.length) {
        children.push({ kind: 'removed', value: prev[i] })
      } else {
        children.push(computeDiff(prev[i], next[i]))
      }
    }
    return { kind: 'array', children }
  }

  // Primitives or mixed types
  if (prev === next) {
    return { kind: 'unchanged', value: next }
  }
  return { kind: 'changed', from: prev, to: next }
}

// Helper: does a DiffNode subtree contain any non-unchanged nodes?
export function hasChanges(node: DiffNode): boolean {
  switch (node.kind) {
    case 'added':
    case 'removed':
    case 'changed':
      return true
    case 'unchanged':
      return false
    case 'object':
      return Object.values(node.children).some(hasChanges)
    case 'array':
      return node.children.some(hasChanges)
  }
}
