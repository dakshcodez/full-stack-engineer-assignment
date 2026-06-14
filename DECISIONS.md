# DECISIONS.md

## 1. Seq-based ordering and deduplication

**Data structure:** `SequenceBuffer` — a `Map<number, ServerMessage>` keyed by `seq`, plus a `Set<number>` of already-processed sequence numbers, plus a `nextExpected` counter.

**Why `Map` + `Set`:** Random-access insertion by seq number is O(1). Deduplication on push is O(1). Draining a contiguous run is a linear scan from `nextExpected` upward with O(1) deletes. The alternative — an append-only array sorted on insert — would require O(n) binary search or O(n) re-sort on every push, which matters when chaos mode sends bursts of out-of-order tokens.

**Gap handling:** When seq N+1 never arrives (server dropped a frame), the buffer arms a 200ms force-flush timer on the first push that leaves a gap. If the gap fills before 200ms, the timer cancels. If it doesn't, the buffer flushes everything it has and advances `nextExpected` past the hole. The timeout is intentionally short (200ms) because the server's normal inter-token interval is 30–80ms; a 200ms gap almost always means the frame was lost, not just delayed.

**`getLastProcessed()`:** Returns `nextExpected - 1` — the highest seq that has been drained out of the buffer and handed to the stores. This is the value sent in `RESUME`, and it is the only place where "consumed by DOM" is defined. The separation is deliberate: the socket might have received seq 20 while the buffer is still waiting for seq 17, so `getLastProcessed()` correctly returns 16.

**Reset on `USER_MESSAGE`:** The server restarts seq at 1 on every new user message. `WsManager.resetBuffer()` is called before sending `USER_MESSAGE` so the buffer treats the next message as seq 1 rather than expecting a continuation.

---

## 2. Preventing layout shift during tool call interruptions

**Segment model:** An `AssistantMessage` is a `Segment[]` — either `TokenSegment { kind: 'tokens', text }` or `ToolSegment { kind: 'tool', ... }`. Tokens accumulate into the last `TokenSegment`. A `TOOL_CALL` appends a new `ToolSegment`; crucially, the preceding `TokenSegment` is not modified — its `text` is frozen at the exact boundary where the tool call arrived.

**No reflow:** Because the frozen `TokenSegment` is a separate array element, the DOM node it renders into never changes its content after the tool call arrives. React reconciles only the new `ToolSegment` node. There is no string replacement, no index shift, and no parent re-layout.

**`streamStatus` discriminant:** The message carries `streamStatus: 'streaming' | 'paused' | 'complete'`. The blinking cursor is rendered only on the last segment when `streamStatus === 'streaming'`. When `TOOL_CALL` arrives, status becomes `'paused'` and the cursor disappears from the token text. When `TOOL_RESULT` arrives and all pending call IDs are resolved, status returns to `'streaming'` and a new cursor appears after any subsequent token segment. The user sees the stream pause and resume cleanly with no visible content jump.

**Multiple concurrent tool calls:** `pendingCallIds: Set<string>` tracks every in-flight call. Status returns to `'streaming'` only when the set is empty. This handles the chaos-mode "rapid tool calls" scenario where two `TOOL_CALL` events arrive before any `TOOL_RESULT`.

---

## 3. Reconnection state recovery

**What "consumed" means:** A message is "consumed" when it exits `SequenceBuffer.push()` and is handed to a store. `getLastProcessed()` returns that watermark. The socket may have received seq 50 but if the buffer forced-flushed at seq 47 and is still holding 48–50, the `RESUME` sends `last_seq=47`. This ensures the server replays 48–50 rather than assuming they were processed.

**RESUME timing:** `WsManager.handleOpen()` sends `RESUME` synchronously as the very first action after the TCP handshake completes, before any user message or other traffic. The server specification requires this ordering.

**Stale socket guard:** Each `WebSocket` instance is passed by reference into its own `handleOpen(ws)` and `handleClose(ws)` closures. If a reconnect creates a new socket before the old one's close event fires, the old event is compared against `this.ws` and silently ignored. This prevents the classic race where a stale close event nulls `this.ws` and triggers a spurious reconnect of the *new* connection.

**HMR / StrictMode guard:** The singleton is stored on `window.__agentWsManager`. React's StrictMode double-mount calls `connect()` twice — the second call is a no-op because `this.ws.readyState === CONNECTING`. When callbacks are reattached after a StrictMode cleanup, `mgr.getStatus()` is pushed immediately to the connection store so the UI reflects the actual current state even if `setStatus` deduplication prevented a callback from firing.

**Tool cards survive drops:** If the connection drops after `TOOL_CALL` but before `TOOL_RESULT`, the `ToolSegment` stays in the store with `status: 'pending'` and renders "waiting for result…". When the connection resumes and `TOOL_RESULT` is replayed, `SequenceBuffer` deduplicates it (the seq is already in the processed set if it arrived before the drop, or delivers it fresh if it was genuinely missed). Either way `handleToolResult` updates the matching segment by `callId` and the card updates in place with no flicker.

---

## 4. Handling 50 concurrent agent streams on one screen

The current architecture is single-session: one `WsManager`, one connection, one sequence namespace. For an operations dashboard with 50 simultaneous streams:

**Connection layer:** Each agent stream would need its own `WsManager` instance (or multiplex over a single socket with a stream-level identifier). The singleton pattern dissolves into a `Map<agentId, WsManager>`. Backoff state, sequence buffers, and heartbeat timers are all already encapsulated inside `WsManager`, so this scales cleanly.

**Store sharding:** The Zustand stores would be keyed by `agentId`. Either use a factory pattern (`createChatStore(agentId)`) or store everything in a single store with `Map<agentId, AgentState>`. The latter avoids React subscription fan-out but makes selectors more complex.

**Timeline:** 50 streams at 30 tokens/s each = 1500 events/s. The rAF batch flush must be per-stream or the single flush becomes a bottleneck. `@tanstack/react-virtual` already handles the list virtualisation; the more critical change is ensuring each stream's token batch is flushed independently so a bursty stream doesn't starve quiet ones.

**TOOL_ACK race condition (protocol note):** The spec says the server waits up to 5 seconds for `TOOL_ACK` before logging a violation and sending the result anyway. At 50 streams, if a slow render delays the `useEffect` that sends `TOOL_ACK`, a violation will be logged even though the client is behaving correctly. The real fix is to decouple `TOOL_ACK` from React's commit phase — send it directly from `WsManager.handleRawMessage()` when a `TOOL_CALL` is received, before it even enters the sequence buffer. This eliminates the render-timing dependency entirely.

**Memory:** 50 streams × N snapshots × potential 500KB each = significant heap pressure. Context history would need a max-length cap (e.g., keep last 10 snapshots per `context_id`) and `ContextSnapshot.data` should be stored as a parsed-once reference, not re-parsed on every diff render.

---

## 5. Handling 100x longer responses (full document generation)

**Token accumulation:** The current `TokenSegment` accumulates text by string concatenation on every TOKEN event. For a 100x longer response, this string can grow into the megabytes. The fix is a `string[]` chunk array instead of a single concatenated string, joined only at render time. React renders the joined string once per rAF flush rather than once per token.

**DOM nodes:** A single `<span>` with a megabyte string is fine for the browser's text engine, but wrapping it in React's reconciler with `whitespace-pre-wrap` causes a full re-layout on every token. The fix: make the token span a `textarea`-style element (or a `contenteditable div`) that the browser can update incrementally via `textContent +=` outside of React, bypassing reconciliation for append-only content. This is the same trick used by terminal emulators.

**SequenceBuffer:** With 100x more tokens, the buffer's `Map` will hold more entries during a gap. The force-flush timeout (200ms) should be tuned down or the buffer should have a max-size hard limit that triggers a flush regardless of gaps.

**Timeline:** Each token batch row would represent more tokens and longer durations. The existing grouping ("Streamed N tokens (Xms)") already handles this. The expanded view of a batch would need pagination or a virtual scroll within the row rather than rendering all N tokens at once.

**Diff engine:** `jsonDiff` does a full recursive walk on every new `CONTEXT_SNAPSHOT`. For very large contexts (which tend to accompany large responses), this is O(n) on the context size. A content-hash cache (store a hash of each subtree) would let `computeDiff` skip unchanged branches in O(1), similar to how React's VDOM bails out on same-reference props.

**Protocol-level gap:** The current RESUME model replays everything after `last_seq`. For a 100x longer document, a mid-stream reconnect could replay thousands of TOKEN events. The server (or a revised protocol) should support replay from a paragraph or section boundary rather than individual tokens, similar to HTTP range requests.

---

## Protocol flaw identified

The `TOOL_ACK` flow has a race condition: the server starts a 5-second timer when it sends `TOOL_CALL`. The client sends `TOOL_ACK` from a `useEffect` that fires after React's commit phase. Under high CPU load or a slow render (large DOM, GC pause), the commit can be delayed beyond 5 seconds, causing a protocol violation even when the client is correct. The spec treats this as a client violation (`/log` shows `"verdict": "violation"`), but it is actually a timing dependency between the server's wall clock and the client's render pipeline — two systems that have no coordination mechanism. A robust protocol would let the client send `TOOL_ACK` from the network layer (before rendering) and decouple acknowledgement from visual confirmation.
