import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { ExtensionBrowser } from './extension-browser.js';

const MAX_EVENTS = 1500;
const MAX_REQUESTS = 500;
const MAX_SCRIPTS = 2000;
const MAX_TEXT = 1_000_000;
const CAPABILITIES = Object.freeze({
  existingBrowserOnly: true,
  initialPairingRequiresRunningPage: true,
  targetBinding: 'extension-nonce-challenge',
  frames: 'top-level and same-process execution contexts',
  outOfProcessIframes: false,
  workers: false,
  devtoolsConcurrent: true,
  control: 'MCP and DevTools share target state; paused/resumed events are authoritative',
});

export class BrowserError extends Error {
  constructor(code, message, details) {
    super(message); this.name = 'BrowserError'; this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function bounded(value, fallback, min, max) {
  return Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Math.floor(Number(value)))) : fallback;
}

function trim(value, max = 8192) {
  return typeof value === 'string' && value.length > max ? `${value.slice(0, max)}…` : value;
}

function remember(map, key, value, max) {
  if (!map.has(key) && map.size >= max) map.delete(map.keys().next().value);
  map.set(key, value);
}

function timed(promise, ms, message = 'The browser command timed out.') {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new BrowserError('TIMEOUT', message)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

function safeValue(value, max = 32768) {
  if (value === undefined) return undefined;
  try {
    const encoded = JSON.stringify(value);
    return encoded.length > max ? { truncated: true, preview: encoded.slice(0, max) } : value;
  } catch { return { unavailable: true }; }
}

function remoteValue(value) {
  if (!value) return null;
  return { type: value.type, subtype: value.subtype, value: safeValue(value.value),
    unserializableValue: value.unserializableValue, description: trim(value.description),
    objectId: value.objectId, preview: safeValue(value.preview) };
}

function snapshotInPage({ prefix, maxElements, maxTextLength }) {
  const store = new Map();
  globalThis.__adbMcpElements = store;
  const nodes = document.querySelectorAll('a,button,input,textarea,select,summary,[role="button"],[role="link"],[contenteditable="true"],[tabindex]');
  const elements = [];
  for (const node of nodes) {
    if (elements.length >= maxElements) break;
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    if (!rect.width || !rect.height || style.visibility === 'hidden' || style.display === 'none') continue;
    const ref = `${prefix}:e${elements.length + 1}`;
    store.set(ref, node);
    const label = node.getAttribute('aria-label') || node.labels?.[0]?.textContent || node.getAttribute('title') || '';
    elements.push({ ref, tag: node.tagName.toLowerCase(), role: node.getAttribute('role'),
      text: (node.innerText || node.textContent || '').trim().slice(0, 500), label: label.trim().slice(0, 500),
      type: node.getAttribute('type'), placeholder: node.getAttribute('placeholder'),
      disabled: Boolean(node.disabled), href: node.tagName === 'A' ? node.href : undefined,
      value: ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName) && node.type !== 'password' ? String(node.value).slice(0, 500) : undefined,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } });
  }
  const text = document.body?.innerText || '';
  return { url: location.href, title: document.title, text: text.slice(0, maxTextLength),
    textTruncated: text.length > maxTextLength, elements, elementsTruncated: elements.length >= maxElements };
}

function prepareElementInPage({ ref, action, replace }) {
  const node = globalThis.__adbMcpElements?.get(ref);
  if (!node || !node.isConnected) throw new Error('STALE_ELEMENT: take a new snapshot.');
  if (node.disabled) throw new Error('ELEMENT_DISABLED');
  node.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  if (action === 'type' || action === 'press') {
    node.focus();
    if (replace) {
      if (typeof node.select === 'function') node.select();
      else if (node.isContentEditable) {
        const selection = window.getSelection();
        const range = document.createRange(); range.selectNodeContents(node);
        selection.removeAllRanges(); selection.addRange(range);
      }
    }
  }
  const rect = node.getBoundingClientRect();
  if (!rect.width || !rect.height) throw new Error('ELEMENT_NOT_VISIBLE');
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, tag: node.tagName };
}

/** Only extension-packaged source from scripts.prepare is accepted by this builder. */
export function buildEarlyHookBundle(snapshot) {
  if (!snapshot || typeof snapshot.hostname !== 'string' || !Array.isArray(snapshot.enabledScripts) || !Array.isArray(snapshot.files)) {
    throw new BrowserError('INVALID_PREPARATION', 'scripts.prepare returned an invalid navigation snapshot.');
  }
  const scripts = snapshot.enabledScripts;
  if (scripts.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_]+$/.test(id))) {
    throw new BrowserError('INVALID_PREPARATION', 'The navigation snapshot contains invalid script identifiers.');
  }
  if (!scripts.length) return null;
  const files = snapshot.files;
  const ids = new Set(); let length = 0;
  for (const file of files) {
    if (!file || typeof file.id !== 'string' || !/^[A-Za-z0-9_]+$/.test(file.id) || typeof file.source !== 'string' || ids.has(file.id)) {
      throw new BrowserError('INVALID_PREPARATION', 'The navigation snapshot contains invalid or duplicate packaged files.');
    }
    ids.add(file.id); length += file.source.length;
    if (length > 2_000_000) throw new BrowserError('PREPARATION_TOO_LARGE', 'Packaged navigation scripts exceed the 2 MB preparation limit.');
  }
  if (files[0]?.id !== 'adb_runtime' || scripts.some(id => !ids.has(id))) {
    throw new BrowserError('INCOMPLETE_PREPARATION', 'The runtime and every enabled script must be supplied in registration order.');
  }
  const config = { hostname: snapshot.hostname, revision: snapshot.revision, enabledScripts: scripts,
    configs: snapshot.configs || {}, mergedHooks: snapshot.mergedHooks || {} };
  // Capture dispatch before any Hook can replace browser functions. Config is written
  // synchronously, then script listeners register, then one synchronous ready event
  // installs the Hooks before the website's first inline script can run.
  const prologue = `(() => {\nconst snapshot = ${JSON.stringify(config)};\n` +
    `if (!['http:', 'https:'].includes(location.protocol) || location.hostname !== snapshot.hostname) return;\n` +
    `const dispatch = window.dispatchEvent.bind(window);\nconst Message = window.MessageEvent;\nconst ready = [];\nconst errors = [];\n` +
    `for (const id of snapshot.enabledScripts) {\n` +
    ` const config = snapshot.configs[id]; if (!config) continue;\n` +
    ` try { for (const [key, value] of Object.entries(config)) {\n` +
    `  if (key === 'keyword_filter_enabled') continue;\n` +
    `  localStorage.setItem('Antidebug_breaker_' + id + '_' + key, key === 'param' ? JSON.stringify(value) : String(value));\n` +
    ` } ready.push(id); } catch (error) { errors.push({ scriptId: id, phase: 'config', message: String(error) }); }\n}\n` +
    `try { localStorage.setItem('Antidebug_breaker_Hooks', JSON.stringify(snapshot.mergedHooks)); } catch (error) { errors.push({ phase: 'merged_config', message: String(error) }); }\n`;
  const source = files.map(file => `\ntry {\n// Extension packaged file: ${file.id}\n${file.source}\n` +
    `} catch (error) { errors.push({ scriptId: ${JSON.stringify(file.id)}, phase: 'script', message: String(error) }); }\n`).join('');
  const epilogue = `\nif (snapshot.enabledScripts.includes('AntiAnti_Hook') && !ready.includes('AntiAnti_Hook')) ready.push('AntiAnti_Hook');\n` +
    `dispatch(new Message('message', { source: window, data: { type: 'HOOK_CONFIG_READY', source: 'antidebug-extension', scriptIds: ready, revision: snapshot.revision } }));\n` +
    `if (errors.length) window.__ADB_OBSERVER__?.emit('adb_preload', 'error', { errors, revision: snapshot.revision });\n})();\n` +
    `//# sourceURL=antidebug-mcp://early/${scripts.join(',')}.js\n`;
  return prologue + source + epilogue;
}

/** CDP transport for a user-owned browser. Never launches Chrome or closes its tabs. */
export class BrowserController extends EventEmitter {
  constructor({ bridge, connect = options => puppeteer.connect(options), eventLimit = MAX_EVENTS } = {}) {
    super();
    if (!bridge?.request || !bridge?.status) throw new TypeError('An ExtensionBridge is required.');
    this.bridge = bridge; this.connector = connect; this.browser = null;
    this.connectionId = null; this.connectionGeneration = 0; this.disconnecting = null;
    this.transport = null; this.bound = new Map(); this.binding = new Map();
    this.events = []; this.nextCursor = 1; this.eventLimit = bounded(eventLimit, MAX_EVENTS, 10, 10000);
    this._bridgeDisconnected = () => { void this._clearBindings('extension_disconnected'); };
    this._bridgeConnected = () => { void this._clearBindings('extension_reconnected'); };
    this._bridgeEvent = envelope => {
      // Raw debugger events go straight to the corresponding session, which records
      // the bounded public event once. Avoid duplicating CDP payloads in the cache.
      if (envelope.event === 'debugger.event') return;
      const data = envelope.data;
      const tabId = Number.isInteger(data?.tabId) ? data.tabId : null;
      this._record(this.bound.get(tabId) || (tabId === null ? null : { tabId }), envelope.event,
        safeValue(data, 65536), 'extension');
    };
    bridge.on?.('disconnected', this._bridgeDisconnected);
    bridge.on?.('connected', this._bridgeConnected);
    bridge.on?.('event', this._bridgeEvent);
  }

  status() {
    return { connected: this._connected(), connectionId: this.connectionId, transport: this.transport,
      browserSessionId: this.bridge.status().browserSessionId ?? null,
      boundPages: [...this.bound.values()].map(state => this._describe(state)),
      capabilities: this._capabilities() };
  }

  _capabilities() {
    return { ...CAPABILITIES, transports: ['extension', 'remote'], defaultTransport: 'extension',
      newTabs: this.transport !== 'remote', newTabTransport: 'extension',
      ...(this.transport === 'remote' ? {} : { initialPairingRequiresRunningPage: false,
        targetBinding: 'chrome.debugger-tabId-session', devtoolsConcurrent: false,
        control: 'The extension owns each debugger session. Disabling control or cancelling the Chrome debugger banner blocks future commands until the user enables control again.' }) };
  }

  _connected() { return Boolean(this.browser && (this.browser.connected ?? this.browser.isConnected?.())); }

  async connect(params = {}) {
    const supplied = [params.browserURL, params.browserWSEndpoint || params.wsEndpoint, params.userDataDir].filter(Boolean);
    if (supplied.length > 1) throw new BrowserError('INVALID_CONNECTION', 'Choose one browserURL, browserWSEndpoint or userDataDir.');
    const transport = params.transport || (supplied.length || params.channel ? 'remote' : 'extension');
    if (!['extension', 'remote'].includes(transport) || (transport === 'extension' && (supplied.length || params.channel))) {
      throw new BrowserError('INVALID_CONNECTION', 'Use extension without remote endpoints, or choose remote with an endpoint/channel.');
    }
    const generation = ++this.connectionGeneration;
    await this._disconnectCurrent();
    if (this.connectionGeneration !== generation) throw new BrowserError('CONNECTION_CHANGED', 'The connection request was cancelled or replaced during cleanup.');
    let candidate;
    if (transport === 'extension') candidate = await ExtensionBrowser.connect(this.bridge);
    else {
      const options = { defaultViewport: null, handleDevToolsAsPage: true, protocolTimeout: 30000 };
      if (params.browserURL) options.browserURL = this._localEndpoint(params.browserURL, ['http:', 'https:']);
      else if (params.browserWSEndpoint || params.wsEndpoint) {
        options.browserWSEndpoint = this._localEndpoint(params.browserWSEndpoint || params.wsEndpoint, ['ws:', 'wss:']);
      } else if (params.userDataDir) {
        const activePort = await readFile(path.join(params.userDataDir, 'DevToolsActivePort'), 'utf8');
        const [port, endpoint] = activePort.trim().split(/\r?\n/);
        if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535 || !endpoint?.startsWith('/devtools/browser/')) {
          throw new BrowserError('INVALID_ACTIVE_PORT', 'DevToolsActivePort has an invalid port or browser endpoint.');
        }
        options.browserWSEndpoint = `ws://127.0.0.1:${port}${endpoint}`;
      } else {
        const channel = params.channel || 'stable';
        const channels = { stable: 'chrome', beta: 'chrome-beta', dev: 'chrome-dev', canary: 'chrome-canary',
          chrome: 'chrome', 'chrome-beta': 'chrome-beta', 'chrome-dev': 'chrome-dev', 'chrome-canary': 'chrome-canary' };
        if (!channels[channel]) throw new BrowserError('INVALID_CHANNEL', 'Use stable, beta, dev or canary.');
        options.channel = channels[channel];
      }
      candidate = await this.connector(options);
    }
    if (this.connectionGeneration !== generation) {
      if (candidate.kind === 'extension') candidate.closeConnection('connection_cancelled');
      else await candidate.disconnect();
      throw new BrowserError('CONNECTION_CHANGED', 'The browser connection was cancelled or replaced before it completed.');
    }
    this.browser = candidate;
    this.transport = transport;
    this.connectionId = randomUUID();
    const current = this.browser;
    current.on?.('disconnected', () => {
      if (this.browser !== current) return;
      this.browser = null; this.connectionId = null;
      void this._clearBindings('browser_disconnected');
      this._record(null, 'browser.disconnected', {});
    });
    this._record(null, 'browser.connected', { transport, capabilities: this._capabilities() });
    return this.status();
  }

  _localEndpoint(value, protocols) {
    let url;
    try { url = new URL(value); } catch { throw new BrowserError('INVALID_ENDPOINT', 'Invalid browser endpoint URL.'); }
    if (!protocols.includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) {
      throw new BrowserError('INVALID_ENDPOINT', 'The CDP endpoint must use a loopback host and an appropriate HTTP/WebSocket protocol.');
    }
    return url.href;
  }

  async disconnect() {
    this.connectionGeneration++;
    return this._disconnectCurrent();
  }

  async _disconnectCurrent() {
    if (this.disconnecting) return this.disconnecting;
    const current = this.browser;
    this.browser = null; this.connectionId = null;
    const cleanup = (async () => {
      await this._clearBindings('disconnected');
      if (current) await current.disconnect();
      return { disconnected: true, browserClosed: false };
    })();
    this.disconnecting = cleanup;
    try { return await cleanup; }
    finally { if (this.disconnecting === cleanup) this.disconnecting = null; }
  }

  async dispose() {
    this.bridge.off?.('disconnected', this._bridgeDisconnected);
    this.bridge.off?.('connected', this._bridgeConnected);
    this.bridge.off?.('event', this._bridgeEvent);
    return this.disconnect();
  }

  async _clearBindings(reason) {
    const states = [...this.bound.values()]; this.bound.clear(); this.binding.clear();
    await Promise.allSettled(states.map(state => this._dropState(state, reason)));
  }

  async _dropState(state, reason) {
    if (state.closed) return;
    state.closed = true;
    if (this.bound.get(state.tabId) === state) this.bound.delete(state.tabId);
    this._invalidateDocument(state, reason);
    state.emitter.emit('closed', reason);
    state.page.off?.('close', state.onClose);
    for (const [event, handler] of state.listeners) state.session.off?.(event, handler);
    try { await timed(state.session.detach(), 1500); } catch { /* The target may already be gone. */ }
    this._record(state, 'target.detached', { reason });
  }

  _bridgeIdentity() {
    const status = this.bridge.status();
    if (!status.connected || !status.browserSessionId) throw new BrowserError('EXTENSION_DISCONNECTED', 'Connect the extension bridge first.');
    return `${status.extensionId}:${status.browserSessionId}`;
  }

  async _extensionPages() {
    const result = await this.bridge.request('pages.list', {});
    const pages = Array.isArray(result) ? result : result?.pages || result?.tabs;
    if (!Array.isArray(pages)) throw new BrowserError('INVALID_PAGES', 'The extension returned an invalid pages list.');
    return pages;
  }

  async listPages() {
    const pages = await this._extensionPages();
    return { connected: this._connected(), pages: pages.map(page => {
      const tabId = page.tabId ?? page.id; const state = this.bound.get(tabId);
      return { ...page, tabId, binding: state ? this._describe(state) : null };
    }), capabilities: this._capabilities() };
  }

  async _requirePage(tabId) {
    if (!Number.isInteger(tabId) || tabId < 0) throw new BrowserError('INVALID_TAB', 'A non-negative extension tabId is required.');
    if (!this._connected()) throw new BrowserError('BROWSER_DISCONNECTED', 'Connect to the existing Chrome browser first.');
    const identity = this._bridgeIdentity();
    const pages = await this._extensionPages();
    if (this._bridgeIdentity() !== identity || !this._connected()) throw new BrowserError('CONNECTION_CHANGED', 'The browser or extension connection changed. Retry.');
    if (!pages.some(page => (page.tabId ?? page.id) === tabId)) throw new BrowserError('TAB_NOT_FOUND', 'The extension no longer has this tab.');
    const known = this.bound.get(tabId);
    if (known && known.identity === identity && !known.closed && !known.page.isClosed()) return known;
    if (known) await this._dropState(known, 'identity_changed');
    if (this.binding.has(tabId)) return this.binding.get(tabId);
    const promise = this._bind(tabId, identity);
    this.binding.set(tabId, promise);
    try { return await promise; } finally { if (this.binding.get(tabId) === promise) this.binding.delete(tabId); }
  }

  async _bind(tabId, identity) {
    const browser = this.browser; const connectionId = this.connectionId;
    if (browser.kind === 'extension') {
      const matched = await browser.attachTab(tabId);
      try { return await this._adoptTarget(matched, tabId, identity, browser, connectionId); }
      catch (error) { await matched.session.detach().catch(() => {}); throw error; }
    }
    const nonce = randomUUID(); const candidates = [];
    let matched;
    try {
      await this.bridge.request('page.mark', { tabId, nonce }, { timeoutMs: 7000 });
      for (const page of await browser.pages()) {
        if (page.isClosed()) continue;
        let session;
        try {
          session = await page.createCDPSession(); candidates.push(session);
          const result = await timed(session.send('Runtime.evaluate', {
            expression: '(() => { const v = Object.getOwnPropertyDescriptor(window, "__ADB_MCP_TARGET__")?.value; return typeof v === "string" ? v : v?.nonce; })()',
            returnByValue: true, silent: true, throwOnSideEffect: true, timeout: 1000,
          }), 1500, 'Timed out checking a browser target.');
          if (result.result?.value !== nonce) continue;
          if (matched) throw new BrowserError('AMBIGUOUS_TARGET', 'Multiple targets matched the extension challenge.');
          const { targetInfo } = await session.send('Target.getTargetInfo');
          matched = { page, session, targetId: targetInfo.targetId };
        } catch (error) {
          if (error instanceof BrowserError && error.code === 'AMBIGUOUS_TARGET') throw error;
          // Restricted pages and inaccessible targets are never guessed by URL/title.
        }
      }
      if (!matched) throw new BrowserError('TARGET_MISMATCH', 'No CDP page matched this extension tab. Ensure both connections use the same Chrome profile and the page is running.');
      return await this._adoptTarget(matched, tabId, identity, browser, connectionId);
    } finally {
      try {
        if (this.browser === browser && this.connectionId === connectionId && this._bridgeIdentity() === identity) {
          await this.bridge.request('page.mark', { tabId, nonce: null }, { timeoutMs: 2000 });
        }
      } catch { /* Navigation/closing can remove the marker before cleanup. */ }
      await Promise.allSettled(candidates.filter(session => ![...this.bound.values()].some(state => state.session === session)).map(session => timed(session.detach(), 1500)));
    }
  }

  async _adoptTarget(matched, tabId, identity, browser, connectionId) {
    if (this.browser !== browser || this.connectionId !== connectionId || this._bridgeIdentity() !== identity) {
      throw new BrowserError('CONNECTION_CHANGED', 'The browser or extension reconnected during target pairing. Retry.');
    }
    const state = { ...matched, tabId, identity, connectionId, epoch: 1, snapshotCount: 0,
      world: null, elementPrefix: null, paused: null, pauseEpoch: 0, scripts: new Map(),
      requests: new Map(), breakpoints: new Map(), contexts: new Map(), listeners: [],
      emitter: new EventEmitter(), closed: false, debuggerEnabled: false, loaderId: null };
    this.bound.set(tabId, state);
    try {
      await this._initialize(state);
      if (state.closed || this.browser !== browser || this.connectionId !== connectionId || this._bridgeIdentity() !== identity) {
        throw new BrowserError('CONNECTION_CHANGED', 'The browser or extension disconnected during target initialization. Retry.');
      }
    } catch (error) { await this._dropState(state, 'initialization_failed'); throw error; }
    this._record(state, 'target.bound', this._describe(state));
    return state;
  }

  async _initialize(state) {
    const events = ['Debugger.paused', 'Debugger.resumed', 'Debugger.scriptParsed', 'Debugger.scriptFailedToParse',
      'Runtime.executionContextCreated', 'Runtime.executionContextDestroyed', 'Runtime.executionContextsCleared',
      'Runtime.consoleAPICalled', 'Runtime.exceptionThrown', 'Runtime.bindingCalled',
      'Page.frameNavigated', 'Page.frameDetached', 'Page.navigatedWithinDocument', 'Page.loadEventFired', 'Page.lifecycleEvent',
      'Network.requestWillBeSent', 'Network.requestWillBeSentExtraInfo', 'Network.responseReceived',
      'Network.responseReceivedExtraInfo', 'Network.loadingFinished', 'Network.loadingFailed'];
    for (const event of events) {
      const handler = params => this._onEvent(state, event, params || {});
      state.session.on(event, handler); state.listeners.push([event, handler]);
    }
    state.onClose = () => { void this._dropState(state, 'tab_closed'); };
    state.page.on('close', state.onClose);
    for (const method of ['Runtime.enable', 'Page.enable', 'Network.enable']) await state.session.send(method);
    if (state.session.browser?.kind === 'extension') await state.session.send('Page.getFrameTree');
    await state.session.send('Page.setLifecycleEventsEnabled', { enabled: true });
    await state.session.send('Runtime.addBinding', { name: '__adbMcpEmit' });
    await state.session.send('Debugger.enable'); state.debuggerEnabled = true;
  }

  _documentId(state) { return `${state.connectionId}:${state.tabId}:${state.epoch}`; }

  _describe(state) {
    return { tabId: state.tabId, targetId: state.targetId, documentId: this._documentId(state),
      url: state.page.url(), paused: Boolean(state.paused), debuggerEnabled: state.debuggerEnabled,
      operationPending: Boolean(state.mutation), operationId: state.mutation?.id ?? null,
      pendingMethod: state.mutation?.method ?? null };
  }

  _invalidateDocument(state, reason, full = true, invalidatePause = full) {
    state.epoch++; state.world = null; state.elementPrefix = null;
    if (invalidatePause) { state.paused = null; state.pauseEpoch++; }
    if (full) { state.contexts.clear(); state.scripts.clear(); }
    state.emitter.emit('invalidated', reason);
  }

  _onEvent(state, event, params) {
    if (state.closed) return;
    if (event === 'Debugger.paused') { state.paused = params; state.pauseEpoch++; }
    else if (event === 'Debugger.resumed') { state.paused = null; state.pauseEpoch++; }
    else if (event === 'Debugger.scriptParsed' || event === 'Debugger.scriptFailedToParse') {
      remember(state.scripts, params.scriptId, { scriptId: params.scriptId, url: trim(params.url, 8192),
        startLine: params.startLine + 1, endLine: params.endLine + 1, executionContextId: params.executionContextId,
        hash: trim(params.hash, 128), sourceMapURL: trim(params.sourceMapURL, 8192), failedToParse: event.endsWith('scriptFailedToParse') }, MAX_SCRIPTS);
    } else if (event === 'Runtime.executionContextCreated') {
      remember(state.contexts, params.context.id, params.context, 200);
    } else if (event === 'Runtime.executionContextsCleared') this._invalidateDocument(state, event);
    else if (event === 'Runtime.executionContextDestroyed') {
      state.contexts.delete(params.executionContextId);
      // A late iframe context event must not hide the main frame's debugger pause.
      const pausedContextDestroyed = state.paused?.callFrames?.some(frame =>
        state.scripts.get(frame.location?.scriptId)?.executionContextId === params.executionContextId);
      this._invalidateDocument(state, event, false, Boolean(pausedContextDestroyed));
    } else if (event === 'Page.frameNavigated') {
      if (!params.frame.parentId) {
        if (state.loaderId !== params.frame.loaderId) this._invalidateDocument(state, event);
        state.loaderId = params.frame.loaderId;
      } else this._invalidateDocument(state, event, false);
    } else if (event === 'Page.frameDetached') this._invalidateDocument(state, event, false);
    else if (event === 'Page.navigatedWithinDocument') {
      state.elementPrefix = null; state.snapshotCount++;
    } else if (event.startsWith('Network.')) this._networkEvent(state, event, params);
    if (event === 'Runtime.bindingCalled') {
      if (params.name !== '__adbMcpEmit') return;
      let data;
      try {
        if (typeof params.payload !== 'string' || params.payload.length > 65536) return;
        data = JSON.parse(params.payload);
      } catch { return; }
      this._record(state, 'hook', { executionContextId: params.executionContextId, payload: safeValue(data, 65536) });
    } else {
      const data = event === 'Runtime.consoleAPICalled' ? { type: params.type, args: (params.args || []).map(remoteValue), stackTrace: safeValue(params.stackTrace) } : safeValue(params);
      this._record(state, event, data);
    }
    state.emitter.emit(event, params);
  }

  _networkEvent(state, event, params) {
    if (!params.requestId) return;
    const request = state.requests.get(params.requestId) || { requestId: params.requestId };
    if (event === 'Network.requestWillBeSent') {
      if (params.redirectResponse) {
        request.redirects ||= [];
        if (request.redirects.length < 20) request.redirects.push(safeValue(params.redirectResponse));
      }
      Object.assign(request, { url: params.request?.url, method: params.request?.method,
        headers: safeValue(params.request?.headers), postData: trim(params.request?.postData, 65536),
        type: params.type, frameId: params.frameId, loaderId: params.loaderId, timestamp: params.timestamp,
        wallTime: params.wallTime, initiator: safeValue(params.initiator), state: 'pending' });
    } else if (event === 'Network.requestWillBeSentExtraInfo') request.requestExtraInfo = safeValue(params);
    else if (event === 'Network.responseReceived') {
      Object.assign(request, { status: params.response?.status, statusText: params.response?.statusText,
        mimeType: params.response?.mimeType, response: safeValue(params.response), state: 'response' });
    } else if (event === 'Network.responseReceivedExtraInfo') request.responseExtraInfo = safeValue(params);
    else if (event === 'Network.loadingFinished') Object.assign(request, { state: 'finished', encodedDataLength: params.encodedDataLength });
    else if (event === 'Network.loadingFailed') Object.assign(request, { state: 'failed', errorText: params.errorText, canceled: params.canceled });
    remember(state.requests, params.requestId, request, MAX_REQUESTS);
  }

  _record(state, event, data, source = 'cdp') {
    const entry = { cursor: this.nextCursor++, timestamp: Date.now(), tabId: state?.tabId ?? null,
      targetId: state?.targetId ?? null, documentId: state?.connectionId ? this._documentId(state) : null, source, event, data };
    this.events.push(entry);
    if (this.events.length > this.eventLimit) this.events.splice(0, this.events.length - this.eventLimit);
    this.emit('event', entry);
  }

  readEvents({ cursor = 0, limit = 100, tabId } = {}) {
    const first = this.events[0]?.cursor ?? this.nextCursor;
    const last = this.nextCursor - 1;
    const selected = this.events.filter(event => event.cursor > Number(cursor) && (tabId === undefined || event.tabId === tabId));
    const page = selected.slice(0, bounded(limit, 100, 1, 250));
    return { events: page, nextCursor: page.length ? page.at(-1).cursor : last,
      latestCursor: last, oldestCursor: first, cursorExpired: Number(cursor) > 0 && Number(cursor) < first - 1,
      hasMore: selected.length > page.length };
  }

  async execute(method, params = {}) {
    if (method === 'events' || method === 'events.list') return this.readEvents(params);
    if (method === 'pages.list') return this.listPages();
    if (method === 'page.navigate' && params.action === 'new') return this._newTab(params);
    const state = await this._requirePage(params.tabId);
    if (params.documentId && params.documentId !== this._documentId(state)) {
      throw new BrowserError('STALE_DOCUMENT', 'The page document changed. Take a new snapshot.');
    }
    const commands = { 'page.navigate': this._navigate, 'page.snapshot': this._snapshot,
      'page.interact': this._interact, 'page.screenshot': this._screenshot,
      debug: this._debug, source: this._source, evaluate: this._evaluate, network: this._network };
    if (!commands[method]) throw new BrowserError('UNKNOWN_METHOD', `Unknown browser method: ${method}`);
    // Evaluation on an already paused frame must remain available while an input
    // or navigation operation waits for resume. It does not replace that owner.
    const controlsPage = ['page.navigate', 'page.interact', 'evaluate'].includes(method) && !(method === 'evaluate' && state.paused);
    if (controlsPage && state.mutation) throw new BrowserError('TARGET_BUSY', `A ${state.mutation.method} operation is still in progress. Debug pause/resume and paused-frame evaluation remain available.`,
      { operationPending: true, operationId: state.mutation.id, tabId: state.tabId });
    const operation = controlsPage ? { id: randomUUID(), method, pending: 0, wrapperSettled: false, reportedPending: false } : null;
    if (operation) state.mutation = operation;
    const task = Promise.resolve().then(() => commands[method].call(this, state, params));
    if (operation) task.then(() => this._finishOperation(state, operation), () => this._finishOperation(state, operation));
    try {
      const result = method === 'page.interact' ? await this._interruptible(state, task, 15000, operation) : await task;
      if (result && typeof result === 'object' && Object.hasOwn(result, 'operationPending')) {
        result.operationPending = Boolean(state.mutation);
        result.operationId = state.mutation?.id ?? null;
        result.pendingMethod = state.mutation?.method ?? null;
      }
      return result;
    } catch (error) {
      if (operation && (error.code === 'TIMEOUT' || /timed?\s*out/i.test(error.message))) {
        operation.reportedPending = true;
        error.details = { ...error.details, operationPending: state.mutation === operation,
          operationId: operation.id, tabId: state.tabId, mayHaveExecuted: true,
          guidance: 'Submitted browser work is not rolled back by a timeout. Do not retry while operationPending is true; debug controls remain available.' };
      }
      throw error;
    }
  }

  _finishOperation(state, operation) {
    operation.wrapperSettled = true;
    this._releaseOperation(state, operation);
  }

  _releaseOperation(state, operation) {
    if (!operation.wrapperSettled || operation.pending > 0 || state.mutation !== operation) return;
    state.mutation = null;
    if (operation.reportedPending) this._record(state, 'operation.settled', { operationId: operation.id, method: operation.method, operationPending: false });
  }

  _retainOperation(state, promise) {
    const operation = state.mutation;
    if (!operation) return promise;
    operation.pending++;
    const release = () => { operation.pending--; this._releaseOperation(state, operation); };
    promise.then(release, release);
    return promise;
  }

  _pendingOperation(state) {
    if (state.mutation) state.mutation.reportedPending = true;
    return { operationPending: Boolean(state.mutation), operationId: state.mutation?.id ?? null };
  }

  async _interruptible(state, task, timeout = 15000, operation = state.mutation) {
    let pausedHandler; let closedHandler;
    const interrupted = new Promise((resolve, reject) => {
      pausedHandler = () => resolve({ ...this._pauseStatus(state), status: 'paused', ...this._pendingOperation(state) });
      closedHandler = reason => reject(new BrowserError('TARGET_CLOSED', reason));
      state.emitter.once('Debugger.paused', pausedHandler); state.emitter.once('closed', closedHandler);
    });
    try { return await timed(Promise.race([task, interrupted]), timeout); }
    catch (error) {
      if (error.code === 'TIMEOUT' && operation) {
        operation.reportedPending = true;
        error.details = { ...error.details, ...this._pendingOperation(state), mayHaveExecuted: true };
      }
      throw error;
    }
    finally { state.emitter.off('Debugger.paused', pausedHandler); state.emitter.off('closed', closedHandler); }
  }

  _assertRunning(state) {
    if (state.paused) throw new BrowserError('TARGET_PAUSED', 'The page is paused. Resume or evaluate on a paused call frame first.', this._pauseStatus(state));
  }

  async _world(state) {
    if (state.world) return state.world;
    const { frameTree } = await state.session.send('Page.getFrameTree');
    const { executionContextId } = await state.session.send('Page.createIsolatedWorld', {
      frameId: frameTree.frame.id, worldName: 'antidebug-mcp-elements',
    });
    state.world = executionContextId; return executionContextId;
  }

  async _inPage(state, fn, args) {
    this._assertRunning(state);
    const documentId = this._documentId(state);
    const contextId = await this._world(state);
    const pending = this._retainOperation(state, state.session.send('Runtime.evaluate', {
      expression: `(${fn.toString()})(${JSON.stringify(args)})`, contextId,
      returnByValue: true, awaitPromise: false, timeout: 5000, objectGroup: 'antidebug-mcp',
    }));
    const result = await timed(pending, 7000);
    if (documentId !== this._documentId(state)) throw new BrowserError('STALE_DOCUMENT', 'The document changed during the operation.');
    if (result.exceptionDetails) throw new BrowserError('PAGE_EVALUATION', result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
  }

  async _snapshot(state, params) {
    const documentId = this._documentId(state);
    const prefix = `${documentId}:s${++state.snapshotCount}`;
    const result = await this._inPage(state, snapshotInPage, { prefix,
      maxElements: bounded(params.maxElements, 150, 1, 500), maxTextLength: bounded(params.maxTextLength, 12000, 100, 100000) });
    state.elementPrefix = prefix;
    return { tabId: state.tabId, documentId, ...result, coverage: 'top-level DOM; iframe contents and closed shadow roots are not included' };
  }

  async _interact(state, params) {
    this._assertRunning(state);
    const { action } = params;
    if (!['click', 'type', 'press', 'scroll'].includes(action)) throw new BrowserError('INVALID_ACTION', 'Use click, type, press or scroll.');
    let position = { x: Number(params.x) || 0, y: Number(params.y) || 0 };
    if (params.ref) {
      if (!state.elementPrefix || !params.ref.startsWith(`${state.elementPrefix}:e`)) throw new BrowserError('STALE_ELEMENT', 'Take a new snapshot and use its element reference.');
      position = await this._inPage(state, prepareElementInPage, { ref: params.ref, action, replace: Boolean(params.replace) });
    } else if (action === 'click' || action === 'type') throw new BrowserError('ELEMENT_REQUIRED', 'click/type require a reference from the latest snapshot.');
    if (action === 'click') {
      await state.session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: position.x, y: position.y, button: 'left', clickCount: 1 });
      await state.session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: position.x, y: position.y, button: 'left', clickCount: 1 });
    } else if (action === 'type') {
      if (typeof params.text !== 'string' || params.text.length > 100000) throw new BrowserError('INVALID_TEXT', 'text must be a string of at most 100000 characters.');
      await state.session.send('Input.insertText', { text: params.text });
    } else if (action === 'scroll') {
      await state.session.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: position.x, y: position.y,
        deltaX: Number(params.deltaX) || 0, deltaY: Number(params.deltaY) || 0 });
    } else await this._press(state, params.key);
    return { ...this._describe(state), action, accepted: true };
  }

  async _press(state, input) {
    if (typeof input !== 'string' || !input || input.length > 80) throw new BrowserError('INVALID_KEY', 'Provide a key or chord, for example Enter or Control+A.');
    const parts = input.split('+'); let modifiers = 0;
    for (const part of parts.slice(0, -1)) {
      const bit = { alt: 1, control: 2, ctrl: 2, meta: 4, command: 4, shift: 8 }[part.toLowerCase()];
      if (!bit) throw new BrowserError('INVALID_KEY', `Unknown modifier: ${part}`);
      modifiers |= bit;
    }
    const key = parts.at(-1);
    const keys = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46, ArrowLeft: 37, ArrowUp: 38,
      ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35, PageUp: 33, PageDown: 34, Space: 32 };
    const keyCode = keys[key] || (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
    if (!keyCode) throw new BrowserError('INVALID_KEY', `Unsupported key: ${key}`);
    const text = !modifiers && key.length === 1 ? key : key === 'Enter' ? '\r' : key === 'Space' ? ' ' : undefined;
    const details = { key: key === 'Space' ? ' ' : key, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers };
    await state.session.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...details, ...(text ? { text } : {}) });
    await state.session.send('Input.dispatchKeyEvent', { type: 'keyUp', ...details });
  }

  _navigationUrl(value) {
    let url; try { url = new URL(value); } catch { throw new BrowserError('INVALID_URL', 'An absolute URL is required.'); }
    if (!['https:', 'http:', 'file:'].includes(url.protocol) && url.href !== 'about:blank') throw new BrowserError('INVALID_URL', 'Navigation supports http, https, file and about:blank.');
    return url.href;
  }

  async _newTab(params) {
    const destination = this._navigationUrl(params.url);
    if (params.tabId !== undefined || (params.active !== undefined && typeof params.active !== 'boolean')) {
      throw new BrowserError('INVALID_ARGUMENT', 'New tabs accept url and optional active, without tabId.');
    }
    if (!this._connected()) throw new BrowserError('BROWSER_DISCONNECTED', 'Connect the default extension transport with adb_connect_browser before creating a tab.');
    if (this.transport !== 'extension' || this.browser.kind !== 'extension') {
      throw new BrowserError('UNSUPPORTED_TRANSPORT', 'Creating tabs requires the default extension transport. Reconnect with adb_connect_browser transport=extension.');
    }
    const identity = this._bridgeIdentity();
    const browser = this.browser, connectionId = this.connectionId;
    let created;
    try {
      // Create a blank tab first so first-page Hooks and Network observation are
      // installed before the requested website begins executing.
      try {
        created = await this.bridge.request('pages.create', { url: destination, active: params.active ?? true }, { timeoutMs: 15000 });
      } catch (error) {
        if (error.code === 'METHOD_NOT_FOUND') throw new BrowserError('EXTENSION_UPDATE_REQUIRED', 'Update and reload the extension to enable creating tabs.', { created: false });
        if (['TIMEOUT', 'REQUEST_TIMEOUT', 'EXTENSION_TIMEOUT', 'EXTENSION_DISCONNECTED', 'BRIDGE_STOPPED'].includes(error.code) && error.details?.created === undefined) {
          error.details = { ...error.details, created: 'unknown', mayHaveCreated: true,
            guidance: 'Check adb_list_pages and page.created events before retrying; a tab may already exist.' };
        }
        throw error;
      }
      if (created?.created !== true || !Number.isInteger(created.tabId) || created.tabId < 0) {
        throw new BrowserError('INVALID_CREATED_TAB', 'The extension did not identify the created tab.', { created: 'unknown', mayHaveCreated: true });
      }
      if (this.browser !== browser || this.connectionId !== connectionId || !this._connected() || this._bridgeIdentity() !== identity) {
        throw new BrowserError('CONNECTION_CHANGED', 'The connection changed after tab creation. Reconnect and inspect the returned tabId before continuing.');
      }
      const result = await this.execute('page.navigate', { tabId: created.tabId, action: 'navigate', url: destination, timeoutMs: params.timeoutMs });
      return { ...result, created: true, tabId: created.tabId, windowId: created.windowId, active: created.active, requestedUrl: destination };
    } catch (error) {
      if (created?.created === true && Number.isInteger(created.tabId)) {
        // Preserve the new tab on failure and identify it. Retrying action=new
        // would create duplicates, while the user may already be using this tab.
        error.details = { ...error.details, created: true, tabId: created.tabId, windowId: created.windowId,
          requestedUrl: destination, guidance: 'Inspect or navigate the existing tabId; do not repeat action=new automatically.' };
      }
      throw error;
    }
  }

  async _navigate(state, params) {
    this._assertRunning(state);
    const action = params.action || 'navigate';
    let command; let destination;
    if (action === 'navigate') {
      destination = this._navigationUrl(params.url);
      command = () => state.session.send('Page.navigate', { url: destination });
    } else if (action === 'reload') {
      destination = state.page.url();
      command = () => state.session.send('Page.reload', { ignoreCache: Boolean(params.ignoreCache) });
    }
    else if (action === 'back' || action === 'forward') {
      const history = await state.session.send('Page.getNavigationHistory');
      const entry = history.entries[history.currentIndex + (action === 'back' ? -1 : 1)];
      if (!entry) return { ...this._describe(state), status: 'no_history_entry', earlyHooks: { status: 'not_prepared', reason: 'history_navigation_not_covered' } };
      command = () => state.session.send('Page.navigateToHistoryEntry', { entryId: entry.id });
      destination = entry.url;
    } else throw new BrowserError('INVALID_ACTION', 'Use navigate, reload, back or forward.');
    const prepared = ['navigate', 'reload'].includes(action) ? await this._prepareNavigation(state, destination) :
      { earlyHooks: { status: 'not_prepared', reason: 'history_navigation_not_covered' } };
    let result;
    try {
      result = await this._waitForNavigation(state, command, bounded(params.timeoutMs, 15000, 100, 30000), { action, destination });
      result.earlyHooks = prepared.earlyHooks;
      return result;
    } finally {
      if (prepared.identifier) {
        try {
          await timed(state.session.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: prepared.identifier }), 3000);
          prepared.earlyHooks.futureInjectionRemoved = true;
        } catch (error) {
          prepared.earlyHooks.futureInjectionRemoved = false;
          prepared.earlyHooks.cleanupError = error.message;
          this._record(state, 'preload.cleanupFailed', { identifier: prepared.identifier, message: error.message });
        }
      }
    }
  }

  async _prepareNavigation(state, url) {
    const destination = new URL(url);
    if (!['http:', 'https:'].includes(destination.protocol)) return { earlyHooks: { status: 'not_applicable', reason: 'http_https_only' } };
    const snapshot = await this.bridge.request('scripts.prepare', { tabId: state.tabId, url });
    if (this._bridgeIdentity() !== state.identity || this.bound.get(state.tabId) !== state || state.closed) {
      throw new BrowserError('CONNECTION_CHANGED', 'The paired browser changed during navigation preparation.');
    }
    if (snapshot?.hostname !== destination.hostname) throw new BrowserError('PREPARATION_HOST_MISMATCH', 'The extension snapshot does not match the destination hostname.');
    const source = buildEarlyHookBundle(snapshot);
    const earlyHooks = { status: source ? 'prepared' : 'not_needed', hostname: snapshot.hostname,
      revision: snapshot.revision, enabledScripts: snapshot.enabledScripts,
      coverage: 'controlled navigation/reload, matching HTTP(S) hostname; redirects to other hosts are excluded' };
    if (!source) return { earlyHooks };
    const { identifier } = await state.session.send('Page.addScriptToEvaluateOnNewDocument', { source });
    if (!identifier) throw new BrowserError('PREPARATION_FAILED', 'Chrome did not register the early Hook bundle.');
    this._record(state, 'preload.prepared', earlyHooks);
    return { identifier, earlyHooks };
  }

  async _waitForNavigation(state, command, timeoutMs, { action = 'navigate', destination } = {}) {
    // Page.loadEventFired has no frame/loader identity. Use lifecycle events and
    // the navigate response instead, buffering events that precede that response.
    const { frameTree } = await state.session.send('Page.getFrameTree');
    const mainFrameId = frameTree.frame.id;
    const previousLoaderId = frameTree.frame.loaderId || state.loaderId;
    let lifecycleResolve;
    const lifecycle = new Promise(resolve => { lifecycleResolve = resolve; });
    this._retainOperation(state, lifecycle);
    return new Promise((resolve, reject) => {
      let settled = false; let terminal = false; let commandResult; let commandSettled = false; let timer;
      let observedLoaderId = null; let observedRestore = false;
      const loads = new Set(); const withinDocument = [];
      const cleanup = () => {
        clearTimeout(timer);
        for (const [name, handler] of listeners) state.emitter.off(name, handler);
      };
      const publish = (status, error) => {
        if (settled) return; settled = true; clearTimeout(timer);
        if (error) reject(error);
        else resolve({ ...this._describe(state), status, ...(commandResult ? { navigation: commandResult } : {}),
          ...(['paused', 'timeout'].includes(status) ? { loadPending: true, ...this._pendingOperation(state) } : {}),
          ...(status === 'paused' ? { pause: this._pauseStatus(state) } : {}) });
      };
      const finish = (status, error) => {
        if (terminal) return; terminal = true; cleanup();
        if (settled) this._record(state, 'navigation.settled', { status, error: error?.message, operationId: state.mutation?.id });
        publish(status, error); lifecycleResolve();
      };
      const inspect = () => {
        if (!commandSettled || terminal) return;
        if (commandResult?.errorText) return finish(null, new BrowserError('NAVIGATION_FAILED', commandResult.errorText));
        if (commandResult?.isDownload) return finish('download');
        const loaderId = commandResult?.loaderId || observedLoaderId;
        if (loaderId && loaderId !== previousLoaderId && loads.has(loaderId)) return finish('loaded');
        if (observedRestore && ['back', 'forward'].includes(action)) return finish('restored_from_cache');
        if (action !== 'reload' && !commandResult?.loaderId && withinDocument.some(event => event.url === destination)) return finish('same_document');
      };
      const listeners = [
        ['Debugger.paused', () => publish('paused')],
        ['Page.lifecycleEvent', event => {
          if (event.frameId !== mainFrameId || event.name !== 'load' || event.loaderId === previousLoaderId) return;
          if (loads.size < 32) loads.add(event.loaderId); inspect();
        }],
        ['Page.frameNavigated', event => {
          if (event.frame.id !== mainFrameId || event.frame.parentId) return;
          if (event.frame.loaderId !== previousLoaderId) observedLoaderId = event.frame.loaderId;
          observedRestore = event.type === 'BackForwardCacheRestore'; inspect();
        }],
        ['Page.navigatedWithinDocument', event => {
          if (event.frameId !== mainFrameId || event.url !== destination) return;
          if (withinDocument.length < 8) withinDocument.push(event); inspect();
        }],
        ['closed', reason => finish(null, new BrowserError('TARGET_CLOSED', reason))],
      ];
      for (const [name, handler] of listeners) state.emitter.on(name, handler);
      timer = setTimeout(() => publish('timeout'), timeoutMs);
      const pendingCommand = this._retainOperation(state, Promise.resolve().then(command));
      pendingCommand.then(result => {
        commandResult = result; commandSettled = true; inspect();
      }).catch(error => finish(null, error));
    });
  }

  async _screenshot(state, params) {
    const format = params.format || 'png';
    if (!['png', 'jpeg', 'webp'].includes(format)) throw new BrowserError('INVALID_FORMAT', 'Use png, jpeg or webp.');
    const options = { format, fromSurface: true };
    if (format !== 'png' && params.quality !== undefined) options.quality = bounded(params.quality, 80, 0, 100);
    if (params.fullPage) {
      const metrics = await state.session.send('Page.getLayoutMetrics');
      const size = metrics.cssContentSize || metrics.contentSize;
      options.captureBeyondViewport = true;
      options.clip = { x: 0, y: 0, width: Math.min(size.width, 16000), height: Math.min(size.height, 30000), scale: 1 };
    }
    const { data } = await timed(state.session.send('Page.captureScreenshot', options), 30000);
    return { data, mimeType: `image/${format}`, tabId: state.tabId, documentId: this._documentId(state),
      ...(options.clip ? { clip: options.clip } : {}) };
  }

  _pauseStatus(state) {
    return { ...this._describe(state), pauseId: state.paused ? `${this._documentId(state)}:p${state.pauseEpoch}` : null,
      reason: state.paused?.reason ?? null, hitBreakpoints: state.paused?.hitBreakpoints || [],
      callFrames: (state.paused?.callFrames || []).map(frame => ({ callFrameId: frame.callFrameId,
        functionName: frame.functionName, url: frame.url || state.scripts.get(frame.location.scriptId)?.url || '', location: { ...frame.location,
          lineNumber: frame.location.lineNumber + 1, columnNumber: frame.location.columnNumber + 1 },
        scopeChain: frame.scopeChain?.map((scope, index) => ({ index, type: scope.type, name: scope.name, object: remoteValue(scope.object) })) })),
      lineNumbers: '1-based', asyncStackTrace: safeValue(state.paused?.asyncStackTrace) };
  }

  _callFrame(state, callFrameId) {
    if (!state.paused) throw new BrowserError('NOT_PAUSED', 'The page is no longer paused.');
    const frame = callFrameId ? state.paused.callFrames.find(item => item.callFrameId === callFrameId) : state.paused.callFrames[0];
    if (!frame) throw new BrowserError('STALE_CALL_FRAME', 'Use a callFrameId from the current pause.');
    return frame;
  }

  async _debug(state, params) {
    const action = params.action || 'status';
    if (action === 'attach' || action === 'status') return this._pauseStatus(state);
    if (action === 'pause') {
      if (!state.paused) await state.session.send('Debugger.pause');
      return this._pauseStatus(state);
    }
    if (['resume', 'stepInto', 'stepOver', 'stepOut'].includes(action)) {
      this._callFrame(state, params.callFrameId);
      await state.session.send(`Debugger.${action}`);
      // Never overwrite a newer paused event produced by a fast single step.
      return { accepted: true, action, ...this._pauseStatus(state) };
    }
    if (action === 'setBreakpoint') {
      if (state.breakpoints.size >= 1000) throw new BrowserError('BREAKPOINT_LIMIT', 'Remove existing MCP breakpoints before adding more (limit 1000).');
      const line = params.lineNumber ?? params.line;
      if (!Number.isInteger(line) || line < 1) throw new BrowserError('INVALID_LINE', 'lineNumber must be a positive, 1-based integer.');
      const column = params.columnNumber ?? params.column ?? 1;
      if (!Number.isInteger(column) || column < 1) throw new BrowserError('INVALID_COLUMN', 'columnNumber must be a positive, 1-based integer.');
      let response;
      if (params.scriptId) {
        if (!state.scripts.has(params.scriptId)) throw new BrowserError('STALE_SCRIPT', 'This scriptId is not in the current document.');
        response = await state.session.send('Debugger.setBreakpoint', { location: { scriptId: params.scriptId, lineNumber: line - 1, columnNumber: column - 1 }, ...(params.condition ? { condition: params.condition } : {}) });
      } else {
        if ((!params.url && !params.urlRegex) || (params.url && params.urlRegex)) throw new BrowserError('INVALID_BREAKPOINT', 'Provide exactly one url or urlRegex, or a current scriptId.');
        response = await state.session.send('Debugger.setBreakpointByUrl', { lineNumber: line - 1, columnNumber: column - 1,
          ...(params.url ? { url: params.url } : { urlRegex: params.urlRegex }), ...(params.condition ? { condition: params.condition } : {}) });
      }
      const locations = (response.locations || (response.actualLocation ? [response.actualLocation] : [])).map(location => ({ ...location, lineNumber: location.lineNumber + 1, columnNumber: location.columnNumber + 1 }));
      const entry = { breakpointId: response.breakpointId, url: params.url, urlRegex: params.urlRegex,
        scriptId: params.scriptId, lineNumber: line, columnNumber: column, condition: params.condition, locations };
      state.breakpoints.set(entry.breakpointId, entry);
      return { ...entry, lineNumbers: '1-based' };
    }
    if (action === 'removeBreakpoint') {
      if (!state.breakpoints.has(params.breakpointId)) throw new BrowserError('UNKNOWN_BREAKPOINT', 'Only breakpoints created by this MCP session may be removed.');
      await state.session.send('Debugger.removeBreakpoint', { breakpointId: params.breakpointId });
      state.breakpoints.delete(params.breakpointId); return { removed: true };
    }
    if (action === 'listBreakpoints') return { breakpoints: [...state.breakpoints.values()], scope: 'breakpoints created by this MCP session' };
    if (action === 'variables') {
      const frame = this._callFrame(state, params.callFrameId); const pauseEpoch = state.pauseEpoch;
      const limit = bounded(params.limit, 100, 1, 500);
      const scopes = params.scopeIndex === undefined ? frame.scopeChain.map((scope, index) => ({ scope, index })) :
        [{ scope: frame.scopeChain[params.scopeIndex], index: params.scopeIndex }];
      if (scopes.some(item => !item.scope)) throw new BrowserError('INVALID_SCOPE', 'scopeIndex is outside the current frame scope chain.');
      const output = [];
      for (const { scope, index } of scopes) {
        if (!scope.object.objectId) continue;
        const response = await state.session.send('Runtime.getProperties', { objectId: scope.object.objectId, ownProperties: true, generatePreview: true });
        if (pauseEpoch !== state.pauseEpoch) throw new BrowserError('STALE_CALL_FRAME', 'Execution changed while reading variables.');
        output.push({ index, type: scope.type, name: scope.name,
          properties: response.result.slice(0, limit).map(property => ({ name: property.name, value: remoteValue(property.value),
            writable: property.writable, get: remoteValue(property.get), set: remoteValue(property.set) })),
          truncated: response.result.length > limit });
      }
      return { callFrameId: frame.callFrameId, scopes: output, pauseId: this._pauseStatus(state).pauseId };
    }
    throw new BrowserError('INVALID_ACTION', `Unknown debug action: ${action}`);
  }

  async _source(state, params) {
    const action = params.action || 'list';
    if (action === 'list') {
      const scripts = [...state.scripts.values()].filter(script => !params.query || script.url?.includes(params.query));
      const offset = bounded(params.offset, 0, 0, MAX_SCRIPTS); const limit = bounded(params.limit, 100, 1, 500);
      return { scripts: scripts.slice(offset, offset + limit), total: scripts.length, nextOffset: offset + limit < scripts.length ? offset + limit : null,
        documentId: this._documentId(state), lineNumbers: '1-based' };
    }
    if (!state.scripts.has(params.scriptId)) throw new BrowserError('STALE_SCRIPT', 'Use a scriptId from source.list for the current document.');
    if (action === 'get') {
      const { scriptSource } = await state.session.send('Debugger.getScriptSource', { scriptId: params.scriptId });
      const lines = (scriptSource || '').split('\n');
      const startLine = bounded(params.startLine, 1, 1, lines.length || 1); const maxLines = bounded(params.maxLines, 100, 1, 1000);
      let length = 0;
      const result = [];
      for (let index = startLine - 1; index < Math.min(lines.length, startLine - 1 + maxLines); index++) {
        const text = trim(lines[index], 10000);
        if (length + text.length > 200000 && result.length) break;
        length += text.length; result.push({ lineNumber: index + 1, text });
      }
      return { scriptId: params.scriptId, lines: result, totalLines: lines.length,
        nextLine: startLine - 1 + result.length < lines.length ? startLine + result.length : null, lineNumbers: '1-based' };
    }
    if (action === 'search') {
      if (typeof params.query !== 'string' || !params.query) throw new BrowserError('INVALID_QUERY', 'A non-empty query is required.');
      const { result } = await state.session.send('Debugger.searchInContent', { scriptId: params.scriptId, query: params.query,
        caseSensitive: Boolean(params.caseSensitive), isRegex: Boolean(params.isRegex) });
      const offset = bounded(params.offset, 0, 0, 1_000_000); const limit = bounded(params.limit, 100, 1, 500);
      return { matches: result.slice(offset, offset + limit).map(match => ({ lineNumber: match.lineNumber + 1, lineContent: trim(match.lineContent, 10000) })),
        total: result.length, nextOffset: offset + limit < result.length ? offset + limit : null, lineNumbers: '1-based' };
    }
    throw new BrowserError('INVALID_ACTION', 'Use source list, get or search.');
  }

  async _evaluate(state, params) {
    if (typeof params.expression !== 'string' || params.expression.length > 100000) throw new BrowserError('INVALID_EXPRESSION', 'expression must be a string of at most 100000 characters.');
    const timeout = bounded(params.timeoutMs, 5000, 100, 30000);
    const onFrame = Boolean(params.callFrameId || state.paused);
    const command = onFrame ? 'Debugger.evaluateOnCallFrame' : 'Runtime.evaluate';
    const args = { expression: params.expression, returnByValue: params.returnByValue !== false, objectGroup: 'antidebug-mcp',
      ...(onFrame ? { callFrameId: this._callFrame(state, params.callFrameId).callFrameId } : { awaitPromise: Boolean(params.awaitPromise), timeout }) };
    const pending = this._retainOperation(state, state.session.send(command, args));
    let handler;
    const paused = new Promise(resolve => { handler = () => resolve({ interrupted: true, reason: 'paused', pause: this._pauseStatus(state), ...this._pendingOperation(state) });
      if (!onFrame) state.emitter.once('Debugger.paused', handler); });
    try {
      const result = await timed(Promise.race([pending, paused]), timeout + 1500);
      if (result.interrupted) return result;
      return { result: remoteValue(result.result), exceptionDetails: safeValue(result.exceptionDetails),
        documentId: this._documentId(state), paused: Boolean(state.paused) };
    } finally { state.emitter.off('Debugger.paused', handler); }
  }

  async _network(state, params) {
    const action = params.action || 'list';
    if (action === 'list') {
      const requests = [...state.requests.values()].filter(request => !params.url || request.url?.includes(params.url));
      const offset = bounded(params.offset, 0, 0, MAX_REQUESTS); const limit = bounded(params.limit, 100, 1, 250);
      return { requests: requests.slice(offset, offset + limit).map(({ requestId, url, method, status, mimeType, type, state: requestState, errorText }) =>
        ({ requestId, url, method, status, mimeType, type, state: requestState, errorText })),
      total: requests.length, nextOffset: offset + limit < requests.length ? offset + limit : null, retainedLimit: MAX_REQUESTS };
    }
    if (action === 'get') {
      const entry = state.requests.get(params.requestId);
      if (!entry) throw new BrowserError('REQUEST_NOT_FOUND', 'This request is no longer in the bounded network buffer.');
      const result = { ...entry };
      if (params.includeBody) {
        try {
          const body = await state.session.send('Network.getResponseBody', { requestId: params.requestId });
          result.body = body.body.slice(0, MAX_TEXT); result.base64Encoded = body.base64Encoded;
          result.bodyTruncated = body.body.length > MAX_TEXT;
        } catch (error) { result.bodyError = error.message; }
      }
      return result;
    }
    throw new BrowserError('INVALID_ACTION', 'Use network list or get.');
  }
}
