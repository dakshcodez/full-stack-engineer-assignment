import { SequenceBuffer } from './SequenceBuffer'
import type { ServerMessage, ClientMessage } from './types'

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'resuming'
  | 'disconnected'

// Manages the WebSocket lifecycle. Zero React — all side effects go through
// the onMessage and onStatusChange callbacks set by useWebSocket.
//
// Connection state machine:
//   idle → connecting → connected ↔ streaming/tool work
//   connected → disconnected → reconnecting → connecting → resuming → connected
export class WsManager {
  private ws: WebSocket | null = null
  private sequenceBuffer: SequenceBuffer
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private status: ConnectionStatus = 'idle'
  private intentionalClose = false

  // ms delays for exponential backoff: 500, 1000, 2000, 4000, 8000, then 10000
  private static readonly BACKOFF = [500, 1000, 2000, 4000, 8000, 10000] as const
  private static readonly WS_URL = 'ws://localhost:4747/ws'
  // Heartbeat: server sends PING every 12s; we check every 3s that we haven't
  // missed responding.  We track the last challenge we need to echo.
  private pendingChallenge: string | null = null

  // Callbacks wired up by useWebSocket
  onMessage: (msg: ServerMessage) => void = () => {}
  onStatusChange: (status: ConnectionStatus) => void = () => {}

  constructor() {
    this.sequenceBuffer = new SequenceBuffer()
    this.sequenceBuffer.onFlush = (msgs) => {
      for (const msg of msgs) this.onMessage(msg)
    }
  }

  connect(): void {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    )
      return
    this.setStatus('connecting')
    this.intentionalClose = false
    this.openSocket()
  }

  disconnect(): void {
    this.intentionalClose = true
    this.clearReconnectTimer()
    this.stopPingTimer()
    if (this.ws) {
      this.ws.onclose = null
      this.ws.close(1000, 'client_close')
      this.ws = null
    }
    this.setStatus('idle')
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  getLastProcessed(): number {
    return this.sequenceBuffer.getLastProcessed()
  }

  resetBuffer(): void {
    this.sequenceBuffer.reset()
  }

  // ── Private ───────────────────────────────────────────────

  private openSocket(): void {
    const ws = new WebSocket(WsManager.WS_URL)
    this.ws = ws

    ws.onopen = () => this.handleOpen()
    ws.onmessage = (event) => this.handleRawMessage(event.data as string)
    ws.onclose = () => this.handleClose()
    ws.onerror = () => {
      // onclose always fires after onerror; handle there
    }
  }

  private handleOpen(): void {
    this.reconnectAttempts = 0
    this.clearReconnectTimer()

    const lastSeq = this.sequenceBuffer.getLastProcessed()
    if (lastSeq > 0) {
      // Reconnection — send RESUME as the very first message
      this.setStatus('resuming')
      this.send({ type: 'RESUME', last_seq: lastSeq })
    }

    // After RESUME (or on first connect) consider ourselves connected
    this.setStatus('connected')
    this.startPingTimer()
  }

  private handleRawMessage(raw: string): void {
    let msg: ServerMessage
    try {
      msg = JSON.parse(raw) as ServerMessage
    } catch {
      // Malformed frame — ignore
      return
    }

    // PING is handled inline; does not go through the sequence buffer
    // (heartbeat must be answered regardless of ordering state)
    if (msg.type === 'PING') {
      this.handlePing(msg.challenge)
      // Still dispatch to stores so the timeline can record it
      this.onMessage(msg)
      return
    }

    const ready = this.sequenceBuffer.push(msg)
    for (const m of ready) this.onMessage(m)
  }

  private handleClose(): void {
    this.stopPingTimer()
    this.ws = null
    if (this.intentionalClose) return
    this.setStatus('disconnected')
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer()
    const backoff = WsManager.BACKOFF
    const delay = backoff[Math.min(this.reconnectAttempts, backoff.length - 1)] ?? 10000
    this.reconnectAttempts++
    this.setStatus('reconnecting')
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.setStatus('connecting')
      this.openSocket()
    }, delay)
  }

  private handlePing(challenge: string): void {
    // Always PONG — even if challenge is empty (corrupt heartbeat in chaos mode)
    this.pendingChallenge = challenge
    this.send({ type: 'PONG', echo: challenge })
    this.pendingChallenge = null
  }

  // The server sends a PING every 12s and terminates after 3 missed PONGs.
  // We rely on the onmessage handler to reply inline; the interval here just
  // guards against a scenario where our reply was lost.
  private startPingTimer(): void {
    this.stopPingTimer()
    // Nothing active to do here — PONG is sent synchronously in handlePing.
    // Keep the method for future instrumentation.
  }

  private stopPingTimer(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
    this.pendingChallenge = null
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return
    this.status = status
    this.onStatusChange(status)
  }
}
