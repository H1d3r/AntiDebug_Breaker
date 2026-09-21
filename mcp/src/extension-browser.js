import { EventEmitter } from 'node:events';

const failure = (code, message) => Object.assign(new Error(message), { code });

class ExtensionPage extends EventEmitter {
  constructor(tabId, url) { super(); this.tabId = tabId; this.currentUrl = url; this.closed = false; }
  url() { return this.currentUrl; }
  isClosed() { return this.closed; }
  closeTarget(reason) {
    if (this.closed) return;
    this.closed = true;
    this.emit('close', reason);
  }
}

class ExtensionSession extends EventEmitter {
  constructor(browser, attached, page) {
    super(); this.browser = browser; this.tabId = attached.tabId; this.id = attached.sessionId;
    this.page = page; this.closed = false; this.pending = new Set(); this.mainFrameId = null;
  }
  send(method, params = {}) {
    if (this.closed || !this.browser.connected) return Promise.reject(failure('DEBUGGER_DETACHED', 'This extension debugger session has ended. Connect or attach again.'));
    return new Promise((resolve, reject) => {
      this.pending.add(reject);
      this.browser.bridge.request('debugger.command', { tabId: this.tabId, sessionId: this.id, method, params }, { timeoutMs: 35000 })
        .then(result => {
          if (this.closed) return;
          if (method === 'Page.getFrameTree' && result?.frameTree?.frame?.id) this.mainFrameId = result.frameTree.frame.id;
          resolve(result);
        }, reject)
        .finally(() => this.pending.delete(reject));
    });
  }
  receive(method, params) {
    if (this.closed) return;
    if (method === 'Page.frameNavigated' && !params.frame?.parentId && params.frame?.url) {
      this.mainFrameId = params.frame.id;
      this.page.currentUrl = params.frame.url;
    }
    if (method === 'Page.navigatedWithinDocument' && params.frameId === this.mainFrameId && params.url) this.page.currentUrl = params.url;
    this.emit(method, params);
  }
  closeSession(reason) {
    if (this.closed) return;
    this.closed = true;
    if (this.browser.sessions.get(this.tabId) === this) this.browser.sessions.delete(this.tabId);
    const error = failure('DEBUGGER_DETACHED', `The extension debugger detached: ${reason}.`);
    for (const reject of this.pending) reject(error);
    this.pending.clear();
    this.page.closeTarget(reason);
  }
  async detach() {
    if (this.closed) return;
    this.closeSession('detached');
    if (this.browser.connected) await this.browser.bridge.request('debugger.detach', { tabId: this.tabId, sessionId: this.id }, { timeoutMs: 7000 });
  }
}

/** Uses only the authenticated extension connection, with browser-supplied tab IDs. */
export class ExtensionBrowser extends EventEmitter {
  static async connect(bridge) {
    const before = bridge.status();
    if (!before.connected) throw failure('EXTENSION_NOT_CONNECTED', 'Connect the extension MCP bridge first.');
    let changed = false;
    const invalidate = () => { changed = true; };
    bridge.on('connected', invalidate);
    bridge.on('disconnected', invalidate);
    try {
      let status;
      try { status = await bridge.request('debugger.status', {}); }
      catch (error) {
        if (error.code === 'METHOD_NOT_FOUND') throw failure('DEBUGGER_UNAVAILABLE', 'Update and reload the paired extension to use browser control.');
        throw error;
      }
      const after = bridge.status();
      if (changed || !after.connected || before.extensionId !== after.extensionId || before.browserSessionId !== after.browserSessionId) {
        throw failure('CONNECTION_CHANGED', 'The paired extension changed while browser control was connecting. Retry.');
      }
      if (!status?.available) throw failure('DEBUGGER_UNAVAILABLE', 'Update the paired extension to a version with browser control.');
      if (!status.permissionGranted) throw failure('DEBUGGER_PERMISSION_REQUIRED', 'Reload or re-enable the updated extension in Chrome to accept its debugger permission.');
      if (!status.controlEnabled) throw failure('DEBUGGER_CONTROL_DISABLED', 'Open the extension MCP panel and click "Re-enable browser control", or "Enable MCP and allow browser control" if MCP is stopped. Only the user can enable this setting.');
      return new ExtensionBrowser(bridge);
    } finally {
      bridge.off('connected', invalidate);
      bridge.off('disconnected', invalidate);
    }
  }
  constructor(bridge) {
    super(); this.bridge = bridge; this.kind = 'extension'; this.connected = true; this.sessions = new Map();
    this.onBridgeEvent = envelope => {
      const data = envelope.data;
      if (!data || !['debugger.event', 'debugger.detached'].includes(envelope.event)) return;
      const session = this.sessions.get(data.tabId);
      if (!session || session.id !== data.sessionId) return;
      if (envelope.event === 'debugger.detached') session.closeSession(data.reason || 'detached');
      else session.receive(data.method, data.params || {});
    };
    this.onBridgeDisconnected = () => this.closeConnection('extension_disconnected');
    bridge.on('event', this.onBridgeEvent);
    bridge.on('disconnected', this.onBridgeDisconnected);
  }
  async attachTab(tabId) {
    if (!this.connected) throw failure('BROWSER_DISCONNECTED', 'Reconnect the extension browser control.');
    // The extension must cancel an abandoned attach before the bridge request expires.
    const attached = await this.bridge.request('debugger.attach', { tabId, timeoutMs: 12000 }, { timeoutMs: 15000 });
    if (!this.connected) throw failure('CONNECTION_CHANGED', 'The extension disconnected while attaching the tab.');
    if (attached?.tabId !== tabId || typeof attached.sessionId !== 'string' || !attached.sessionId) {
      throw failure('INVALID_DEBUGGER_SESSION', 'The extension did not identify the attached tab and session.');
    }
    const existing = this.sessions.get(tabId);
    if (existing && existing.id === attached.sessionId) return { page: existing.page, session: existing, targetId: `tab:${tabId}` };
    existing?.closeSession('session_replaced');
    const page = new ExtensionPage(tabId, attached.url || 'about:blank');
    const session = new ExtensionSession(this, attached, page);
    this.sessions.set(tabId, session);
    return { page, session, targetId: `tab:${tabId}` };
  }
  closeConnection(reason) {
    if (!this.connected) return;
    this.connected = false;
    this.bridge.off('event', this.onBridgeEvent);
    this.bridge.off('disconnected', this.onBridgeDisconnected);
    for (const session of [...this.sessions.values()]) session.closeSession(reason);
    this.emit('disconnected');
  }
  async disconnect() {
    if (!this.connected) return;
    this.closeConnection('disconnected');
    if (this.bridge.status().connected) await this.bridge.request('debugger.detachAll', {}, { timeoutMs: 7000 });
  }
}
