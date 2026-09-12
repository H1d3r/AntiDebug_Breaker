import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';

const id = z.string().min(1).max(128);
const helloSchema = z.object({
  type: z.literal('hello'), protocolVersion: z.literal(1), token: z.string().min(1).max(256),
  extensionId: z.string().regex(/^[a-p]{32}$/), version: z.string().min(1).max(64),
  browserSessionId: id,
}).strict();
const responseSchema = z.object({
  type: z.literal('response'), id, result: z.unknown().optional(),
  error: z.object({ code: z.union([z.string().max(128), z.number()]), message: z.string().max(8192), details: z.unknown().optional() }).strict().optional(),
}).strict().refine(value => Object.hasOwn(value, 'result') !== Object.hasOwn(value, 'error'));
const eventSchema = z.object({ type: z.literal('event'), event: z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/), data: z.unknown() }).strict();
const heartbeatSchema = z.object({ type: z.enum(['ping', 'pong']), id: id.optional() }).strict();
const chunkSchema = z.object({ type: z.literal('response_chunk'), id, index: z.number().int().min(0).max(127),
  total: z.number().int().min(1).max(128), data: z.string() }).strict();
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

export class BridgeError extends Error {
  constructor(code, message, details) { super(message); this.name = 'BridgeError'; this.code = code; if (details !== undefined) this.details = details; }
}

/** One authenticated extension session on a loopback-only WebSocket endpoint. */
export class ExtensionBridge extends EventEmitter {
  constructor({ port = 19876, token, requestTimeoutMs = 15000, handshakeTimeoutMs = 5000, maxPayload = 1024 * 1024, maxPending = 64, heartbeatMs = 15000 } = {}) {
    super();
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('Invalid bridge port.');
    if (typeof token !== 'string' || token.length < 32 || token.length > 256) throw new TypeError('Bridge token must contain 32 to 256 characters.');
    this.port = port; this.token = token; this.requestTimeoutMs = requestTimeoutMs; this.handshakeTimeoutMs = handshakeTimeoutMs;
    this.maxPayload = maxPayload; this.maxPending = maxPending; this.heartbeatMs = heartbeatMs;
    this.pending = new Map(); this.sockets = new Set(); this.connection = null; this.metadata = null; this.server = null; this.wss = null;
  }

  status() {
    return { listening: Boolean(this.server?.listening), connected: this.connection?.readyState === WebSocket.OPEN,
      port: this.port, extensionId: this.metadata?.extensionId ?? null, version: this.metadata?.version ?? null,
      browserSessionId: this.metadata?.browserSessionId ?? null, pendingRequests: this.pending.size };
  }

  async start() {
    if (this.server) throw new BridgeError('ALREADY_STARTED', 'The extension bridge is already started.');
    const server = createServer((_req, res) => { res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); res.end('Not found'); });
    const wss = new WebSocketServer({ noServer: true, maxPayload: this.maxPayload, perMessageDeflate: false });
    this.server = server; this.wss = wss;
    server.on('upgrade', (req, socket, head) => {
      const origin = req.headers.origin;
      const match = typeof origin === 'string' && /^chrome-extension:\/\/([a-p]{32})$/.exec(origin);
      if (req.url !== '/extension' || !match || req.headers.host !== `127.0.0.1:${this.port}`) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
      }
      if (this.sockets.size >= 16) { socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n'); return; }
      wss.handleUpgrade(req, socket, head, ws => this.accept(ws, match[1]));
    });
    try {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(this.port, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
    } catch (error) {
      this.server = null; this.wss = null; wss.close();
      if (error.code === 'EADDRINUSE') throw new BridgeError('PORT_IN_USE', `Port ${this.port} is already in use. Only one AntiDebug MCP process may own this pairing port; stop the other process or use a separate config.`);
      throw error;
    }
    this.port = server.address().port;
    server.on('error', error => this.emit('bridgeError', new BridgeError('SERVER_ERROR', error.message)));
    this.heartbeat = setInterval(() => {
      for (const ws of this.sockets) {
        if (!ws.alive) { ws.terminate(); continue; }
        ws.alive = false; if (ws.readyState === WebSocket.OPEN) ws.ping();
      }
    }, this.heartbeatMs);
    this.heartbeat.unref();
    return this.status();
  }

  accept(ws, originId) {
    this.sockets.add(ws); ws.alive = true; ws.authenticated = false;
    const timer = setTimeout(() => ws.close(4001, 'Handshake timeout'), this.handshakeTimeoutMs); timer.unref();
    ws.on('pong', () => { ws.alive = true; });
    ws.on('error', () => {}); // close handles failed transport; payloads/tokens never reach logs.
    ws.on('message', (raw, binary) => {
      if (binary) { ws.close(4002, 'JSON text messages required'); return; }
      let message;
      try { message = JSON.parse(raw.toString('utf8')); } catch { ws.close(4002, 'Invalid JSON'); return; }
      if (!ws.authenticated) {
        const parsed = helloSchema.safeParse(message);
        const candidate = parsed.success ? Buffer.from(parsed.data.token) : Buffer.alloc(0);
        const expected = Buffer.from(this.token);
        if (!parsed.success || parsed.data.extensionId !== originId || candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) {
          ws.close(4003, 'Authentication failed'); return;
        }
        if (this.connection) { ws.close(4009, 'Another extension/browser session is already paired'); return; }
        clearTimeout(timer); ws.authenticated = true; this.connection = ws;
        this.metadata = { extensionId: parsed.data.extensionId, version: parsed.data.version, browserSessionId: parsed.data.browserSessionId };
        ws.send(JSON.stringify({ type: 'welcome', protocolVersion: 1, sessionId: randomUUID(), maxMessageBytes: this.maxPayload }));
        this.emit('connected', { ...this.metadata }); return;
      }
      if (message?.type === 'response_chunk') {
        if (!chunkSchema.safeParse(message).success) { ws.close(4002, 'Invalid response chunk'); return; }
        const pending = this.pending.get(message.id);
        if (!pending) return; // Timed-out transfers never allocate buffers.
        if (pending.method !== 'debugger.command') { ws.close(4002, 'Unexpected chunked response'); return; }
        const chunks = pending.chunks ||= { parts: [], total: message.total, bytes: 0 };
        if (message.total !== chunks.total || message.index !== chunks.parts.length || message.index >= message.total) {
          ws.close(4002, 'Invalid response chunk order'); return;
        }
        chunks.bytes += Buffer.byteLength(message.data);
        if (chunks.bytes > MAX_RESPONSE_BYTES) { ws.close(1009, 'Response exceeds transfer limit'); return; }
        chunks.parts.push(message.data);
        if (chunks.parts.length !== chunks.total) return;
        const responseId = message.id;
        try { message = JSON.parse(chunks.parts.join('')); } catch { ws.close(4002, 'Invalid chunked JSON'); return; }
        pending.chunks = null;
        if (message?.type !== 'response' || message.id !== responseId) { ws.close(4002, 'Invalid chunked response identity'); return; }
      }
      if (message?.type === 'response') {
        const parsed = responseSchema.safeParse(message);
        if (!parsed.success) { ws.close(4002, 'Invalid response'); return; }
        const pending = this.pending.get(message.id);
        if (!pending) return; // Late response to an expired request.
        this.pending.delete(message.id); clearTimeout(pending.timer);
        if (message.error) pending.reject(new BridgeError(message.error.code, message.error.message, message.error.details));
        else pending.resolve(message.result);
      } else if (message?.type === 'event') {
        if (!eventSchema.safeParse(message).success) { ws.close(4002, 'Invalid event'); return; }
        this.emit('event', { event: message.event, data: message.data, ...this.metadata, receivedAt: Date.now() });
      } else if (heartbeatSchema.safeParse(message).success) {
        ws.alive = true;
        if (message.type === 'ping') ws.send(JSON.stringify({ type: 'pong', ...(message.id ? { id: message.id } : {}) }));
      } else ws.close(4002, 'Unexpected message');
    });
    ws.on('close', (code, reason) => {
      clearTimeout(timer); this.sockets.delete(ws);
      if (this.connection !== ws) return;
      const metadata = this.metadata; this.connection = null; this.metadata = null;
      this.rejectPending(new BridgeError('EXTENSION_DISCONNECTED', 'The paired extension disconnected; reconnect before retrying.'));
      this.emit('disconnected', { ...metadata, code, reason: reason.toString().slice(0, 256) });
    });
  }

  request(method, params = {}, { timeoutMs = this.requestTimeoutMs } = {}) {
    if (!this.status().connected) return Promise.reject(new BridgeError('EXTENSION_NOT_CONNECTED', 'Open the extension pairing settings and connect it to this MCP server.'));
    if (this.pending.size >= this.maxPending) return Promise.reject(new BridgeError('BRIDGE_BUSY', 'Too many extension requests are pending.'));
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) return Promise.reject(new BridgeError('INVALID_TIMEOUT', 'Request timeout must be between 1 and 120000 milliseconds.'));
    const requestId = randomUUID();
    let encoded;
    try { encoded = JSON.stringify({ type: 'request', id: requestId, method, params }); }
    catch { return Promise.reject(new BridgeError('INVALID_REQUEST', 'Request must be JSON serializable.')); }
    if (Buffer.byteLength(encoded) > this.maxPayload) return Promise.reject(new BridgeError('MESSAGE_TOO_LARGE', 'Extension request exceeds the message size limit.'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new BridgeError('EXTENSION_TIMEOUT', `Extension request timed out: ${method}. A timed-out mutation may still have applied; inspect state before retrying.`)); }, timeoutMs); timer.unref();
      this.pending.set(requestId, { resolve, reject, timer, method });
      this.connection.send(encoded, error => {
        if (!error) return;
        const pending = this.pending.get(requestId);
        if (pending) { this.pending.delete(requestId); clearTimeout(timer); reject(new BridgeError('EXTENSION_DISCONNECTED', 'Failed to send request to the extension.')); }
      });
    });
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }

  async stop() {
    clearInterval(this.heartbeat);
    this.rejectPending(new BridgeError('BRIDGE_STOPPED', 'The extension bridge stopped.'));
    for (const ws of this.sockets) ws.terminate();
    this.sockets.clear();
    const server = this.server, wss = this.wss;
    const metadata = this.metadata;
    this.server = null; this.wss = null; this.connection = null; this.metadata = null;
    if (metadata) this.emit('disconnected', { ...metadata, code: 1001, reason: 'Bridge stopped' });
    await Promise.all([server ? new Promise(resolve => server.close(resolve)) : null, wss ? new Promise(resolve => wss.close(resolve)) : null]);
  }
}
