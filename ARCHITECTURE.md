# Agent Console — Architectural Plan

---

## Guiding Principle

The app has three distinct concerns that must stay decoupled:

1. **Protocol layer** — raw WebSocket, seq ordering, heartbeat, reconnection. Zero React.
2. **Domain state** — what the user sees: chat messages, timeline events, context snapshots. Pure data transforms.
3. **Render layer** — React components that read domain state and trigger protocol actions.

Most WebSocket chat code collapses all three into `useEffect`. That is exactly what fails under chaos mode.

---

## State Management Choice: Zustand

- Can update state from outside React (the WsManager runs outside the component tree)
- Selective subscriptions — the timeline store updating 30x/sec doesn't re-render the chat panel
- No boilerplate
- Works cleanly with TypeScript strict mode

---

## Folder Structure

```
src/
  lib/
    protocol/
      types.ts           ← mirror server types.ts (shared shapes)
      SequenceBuffer.ts  ← reorder + dedup logic
      WsManager.ts       ← connection lifecycle, sends, heartbeat
    stores/
      chatStore.ts       ← assistant messages, segments, tool cards
      timelineStore.ts   ← event log, token batches
      contextStore.ts    ← snapshots, diffs, history
      connectionStore.ts ← status, backoff state
    diff/
      jsonDiff.ts        ← recursive JSON diff algorithm
  hooks/
    useWebSocket.ts      ← mounts WsManager, wires events → stores
  components/
    ChatPanel/
    TimelinePanel/
    ContextPanel/
    ConnectionStatus.tsx
    InputBar.tsx
  app/
    page.tsx
    layout.tsx
```

---

## The Two State Machines to Build

### WebSocket Connection States

```
         mount / send message
IDLE ──────────────────────────→ CONNECTING
                                      │
                         open ────────┤ failed
                           ↓          ↓
                       CONNECTED   RECONNECTING ← hard drop (no close frame)
                           │              │
                   stream  │  backoff     │ elapsed
                    work   │  ──────────→ CONNECTING
                           │
                     unexpected close
                           ↓
                      DISCONNECTED
                           │
                      after 500ms
                           ↓
                      RECONNECTING
                           │ open
                           ↓
                       RESUMING ← sends RESUME {last_seq} as first message
                           │
                      replay done
                           ↓
                       CONNECTED
```

### Per-Stream Message States

```
          first TOKEN or TOOL_CALL
IDLE ────────────────────────────→ STREAMING
                                       │
                             TOOL_CALL │
                                       ↓
                                 TOOL_PENDING  ← can receive more TOOL_CALLs
                                 (map of       ← (rapid tool call scenario)
                                  pending
                                  call_ids)
                                       │
                              all TOOL_RESULTs received
                                       ↓
                                   STREAMING
                                       │
                                  STREAM_END
                                       ↓
                                   COMPLETE
```

---

## Step 1 — Project Setup

```bash
npx create-next-app@latest agent-console \
  --typescript --tailwind --app --src-dir --no-eslint
cd agent-console
npm install zustand
```

Configure `tsconfig.json`: `"strict": true`, `"noUncheckedIndexedAccess": true`.

Copy `agent-server/src/types.ts` into `src/lib/protocol/types.ts` — this is the single source of truth for message shapes. No duplication.

---

## Step 2 — Sequence Buffer (build and test first)

`SequenceBuffer.ts` is the most critical non-UI piece. Build it in isolation with unit tests before touching React.

**Responsibilities:**
- Accept incoming messages (possibly out-of-order, possibly duplicate)
- Release messages in `seq` order
- Deduplicate by `seq`
- After a 200ms gap, flush whatever is buffered (handles chaos mode where a message truly doesn't arrive)

**Data structures:**

```typescript
class SequenceBuffer {
  private buffer: Map<number, ServerMessage>   // seq → message
  private processed: Set<number>               // already-dispatched seqs
  private nextExpected: number                 // lastProcessed + 1
  private gapTimer: ReturnType<typeof setTimeout> | null

  push(msg: ServerMessage): ServerMessage[]    // returns messages ready to dispatch
  getLastProcessed(): number
  reset(): void
}
```

**Logic on `push(msg)`:**
1. If `msg.seq` is in `processed` → discard (duplicate)
2. Add to `buffer`
3. Drain contiguous run: while `buffer.has(nextExpected)`, pop it, add seq to `processed`, yield it, increment `nextExpected`
4. If buffer still has entries but nothing is contiguous (gap), arm a 200ms timer to force-flush in seq order

**Unit tests to write:** empty buffer, single element, already-sorted, fully reversed, duplicates in middle, gap that fills before timeout, gap that times out.

---

## Step 3 — WsManager (pure class, no React)

`WsManager.ts` owns everything WebSocket-related.

```typescript
class WsManager {
  private ws: WebSocket | null
  private sequenceBuffer: SequenceBuffer
  private reconnectAttempts: number
  private backoffMs = [500, 1000, 2000, 4000, 8000, 10000]
  private pingTimer: ReturnType<typeof setInterval> | null

  // Callbacks set by useWebSocket hook
  onMessage: (msg: ServerMessage) => void
  onStatusChange: (status: ConnectionStatus) => void

  connect(): void
  disconnect(): void
  send(msg: ClientMessage): void
  private handleOpen(): void
  private handleClose(): void       // schedules reconnect
  private handleMessage(raw): void  // → sequenceBuffer.push → onMessage
  private scheduleReconnect(): void // exponential backoff
  private sendResume(): void        // first message on reconnect
  private startHeartbeat(): void    // PING handler — sends PONG
  private stopHeartbeat(): void
}
```

**Critical rule:** `handleMessage` calls `sequenceBuffer.push()`, gets back an array of ordered messages, then calls `onMessage` for each one. This is the only path messages travel from wire to application.

**Heartbeat:** On PING received — if `challenge` is empty (corrupt ping), send `PONG` with `echo: ""` anyway. Do not crash, do not disconnect. The server sends it intentionally.

**RESUME:** On reconnect open, before any other send: `{ type: "RESUME", last_seq: sequenceBuffer.getLastProcessed() }`.

---

## Step 4 — Connection Store + Status UI

`connectionStore.ts`:

```typescript
interface ConnectionState {
  status: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'resuming'
  attempt: number
  nextRetryMs: number
}
```

`ConnectionStatus.tsx`: A small non-blocking banner (fixed top-right, doesn't cover chat). Shows "Reconnecting... (attempt 2, retry in 2s)" when disconnected. Disappears when connected. The chat panel remains fully interactive — scroll, copy — during disconnection.

---

## Step 5 — Chat Store + Streaming Text

This is the core of Task 1. The key data model:

```typescript
// An assistant message is a list of segments
type Segment =
  | { kind: 'tokens'; text: string }
  | { kind: 'tool'; callId: string; toolName: string; args: object; result?: object; status: 'pending' | 'complete' }

interface AssistantMessage {
  id: string
  streamId: string
  segments: Segment[]
  streamStatus: 'streaming' | 'paused' | 'complete'
  pendingCallIds: Set<string>   // for rapid tool call tracking
}
```

**Reducer actions:**

| Event | Action |
|---|---|
| `TOKEN` | Find last segment. If `kind: 'tokens'`, append `text`. If `kind: 'tool'`, add new `{ kind: 'tokens', text: '' }` first, then append. |
| `TOOL_CALL` | Add `{ kind: 'tool', status: 'pending', ... }`. Add `callId` to `pendingCallIds`. Set `streamStatus = 'paused'`. |
| `TOOL_RESULT` | Find tool segment by `callId`, set `result` and `status: 'complete'`. Remove from `pendingCallIds`. If `pendingCallIds` is now empty, set `streamStatus = 'streaming'`. |
| `STREAM_END` | Set `streamStatus = 'complete'`. |

**No layout shift:** The token text before a tool call is already in the DOM inside a `TokenSegment` component. When TOOL_CALL arrives, a new segment is added *after* it — the existing text DOM node doesn't change. The tool card appears below. Use `min-height` on the ToolCallCard to reserve space before the result arrives.

**TOOL_ACK:** In the `ToolCallCard` component, fire inside `useEffect`:
```typescript
useEffect(() => {
  wsManager.send({ type: 'TOOL_ACK', call_id: callId })
}, [callId])
```
This fires the moment the card renders, within React's commit phase — well inside the 2 second window.

---

## Step 6 — Timeline Store + Panel

The challenge: 30+ events/second during token streaming. Naive approach re-renders the full list every token.

**Token batching strategy:**

```typescript
interface TokenBatch {
  kind: 'token_batch'
  streamId: string
  count: number
  totalText: string
  startTime: number
  endTime: number
}
```

In `timelineStore`, maintain a `currentBatch: TokenBatch | null` ref (not state). When a TOKEN event arrives:
- If `currentBatch` is for the same `streamId`, increment count, append text, update endTime — **no React state update yet**
- Schedule a `requestAnimationFrame` flush (if not already scheduled)
- The rAF callback commits the current batch to Zustand state — at most 60Hz React updates

When any non-TOKEN event arrives: flush the current batch immediately, then add the new event row.

**Components:**
- `TimelinePanel`: virtualized list using `@tanstack/react-virtual` — essential for long sessions
- `TimelineRow`: memoized with `React.memo`, keyed by event id
- `TokenBatchRow`: shows "Streamed 47 tokens (1.2s)" with expand button showing full text
- `FilterBar`: filter by type (multi-select chips), text search (debounced 150ms)

**Bidirectional linking:** Store a `selectedEventId` in timeline store and a `selectedSegmentId` in chat store. Clicking a timeline row sets `selectedEventId` and also sets `selectedSegmentId` via the `callId` or `streamId` linkage. The chat panel highlights the matching segment. Clicking a tool card sets `selectedSegmentId` and the timeline scrolls to the matching `TOOL_CALL` row.

---

## Step 7 — Context Inspector

**Data model:**

```typescript
interface ContextHistory {
  contextId: string
  snapshots: { seq: number; data: object; diff?: JsonDiff }[]
  currentIndex: number
}
```

**Diff algorithm** (`jsonDiff.ts`): Recursive function returning:

```typescript
type DiffNode =
  | { kind: 'added'; value: unknown }
  | { kind: 'removed'; value: unknown }
  | { kind: 'changed'; from: unknown; to: unknown }
  | { kind: 'unchanged'; value: unknown }
  | { kind: 'object'; children: Record<string, DiffNode> }
  | { kind: 'array'; children: DiffNode[] }
```

**JsonTree component:** Lazy expansion — each node is collapsed by default. Only render children when the node is expanded. Expansion state lives in a local `Set<string>` (path strings). This is how 500KB stays interactive — 99% of nodes are never rendered.

**History scrubber:** A simple `<input type="range" min={0} max={snapshots.length - 1}>`. Stepping backward shows the diff from the previous snapshot. Diff highlights applied in `JsonTree`:
- `bg-green-100` for added keys
- `bg-red-100` for removed keys
- `bg-yellow-100` for changed values

---

## Step 8 — `useWebSocket` Hook

This is the glue layer. It mounts the `WsManager` and routes every incoming `ServerMessage` to the right store:

```typescript
function useWebSocket() {
  const manager = useRef(new WsManager())

  useEffect(() => {
    manager.current.onStatusChange = (status) =>
      connectionStore.setState({ status })

    manager.current.onMessage = (msg) => {
      switch (msg.type) {
        case 'TOKEN':
        case 'TOOL_CALL':
        case 'TOOL_RESULT':
        case 'STREAM_END':
          chatStore.dispatch(msg)
          timelineStore.addEvent(msg)
          break
        case 'CONTEXT_SNAPSHOT':
          contextStore.addSnapshot(msg)
          timelineStore.addEvent(msg)
          break
        case 'PING':
          timelineStore.addEvent(msg)
          // PONG is sent inside WsManager — not here
          break
        case 'ERROR':
          timelineStore.addEvent(msg)
          break
      }
    }

    manager.current.connect()
    return () => manager.current.disconnect()
  }, [])

  return {
    send: (msg: ClientMessage) => manager.current.send(msg)
  }
}
```

---

## Step 9 — Page Layout

```
┌─────────────────────────────────────────────────────────────┐
│  [ConnectionStatus banner — only shows when disconnected]    │
├──────────────────────┬──────────────────┬───────────────────┤
│                      │                  │                   │
│    CHAT PANEL        │  TIMELINE PANEL  │  CONTEXT PANEL    │
│    (flex-1)          │  (w-72)          │  (w-80)           │
│                      │                  │                   │
│  Messages scroll     │  Event log       │  JSON tree        │
│  up, input at        │  with filter     │  History          │
│  bottom              │                  │  scrubber         │
│                      │                  │                   │
├──────────────────────┴──────────────────┴───────────────────┤
│  [Input bar — full width]                                    │
└─────────────────────────────────────────────────────────────┘
```

---

## Build Order

| Day | Deliverable | Why this order |
|---|---|---|
| **1** | Project setup + `SequenceBuffer` with unit tests | Foundation. Test it before anything depends on it. |
| **1** | `WsManager` (connect, send, PING/PONG, reconnect, RESUME) | All other features depend on receiving messages. |
| **2** | Connection store + status UI + `useWebSocket` hook | Proves the protocol layer works end-to-end. |
| **2** | Chat store (TOKEN → STREAM_END, no tool calls yet) | Streaming text works in normal mode. |
| **3** | Tool call interruption (TOOL_CALL → TOOL_ACK → TOOL_RESULT → resume) | Task 1 complete. |
| **3** | Timeline store with token batching | Task 2 scaffolding. |
| **4** | Timeline panel (virtual list, filter, bidirectional linking) | Task 2 complete. |
| **4** | Context inspector (tree, diff, history scrubber) | Task 3 complete. |
| **5** | Chaos mode testing + edge case fixes | Tasks 4 & 5. |
| **5** | README + DECISIONS.md + screen recording | Deliverables. |

---

## The Race Condition Worth Documenting

The assignment hints at a `TOOL_ACK` race condition. Here it is:

The server sends `TOOL_CALL`, waits for `TOOL_ACK`, then sends `TOOL_RESULT`. If the connection drops *after* the client sends `TOOL_ACK` but *before* the server receives it, the server times out after 5 seconds and sends `TOOL_RESULT` anyway — but the client may never have received `TOOL_RESULT` before the drop.

On `RESUME`, the replayed events include `TOOL_RESULT` but whether `TOOL_CALL` is replayed depends on whether the client had already updated `lastProcessed` past that seq. The exact replay window is determined by `last_seq` — if the client processed `TOOL_CALL`'s seq before the drop, the replay won't include `TOOL_CALL`, only `TOOL_RESULT`. The client must be able to handle a `TOOL_RESULT` arriving for a `call_id` it has already rendered a card for (idempotent result application).

Document this in `DECISIONS.md`.
