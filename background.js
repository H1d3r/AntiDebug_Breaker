/* The background owns configuration rules; popup and the local MCP bridge use the same API. */
importScripts('extension/policy.js', 'extension/user-scripts.js', 'extension/service.js', 'extension/bridge.js', 'extension/debugger.js');

let bridge;
// Register debugger lifecycle listeners synchronously when the MV3 worker starts.
const debuggerController = new ADBDebugger.DebuggerController(chrome, {
    isConnected: () => Boolean(bridge?.connected),
    emit: (event, data) => bridge?.event(event, data)
});
const serviceReady = fetch(chrome.runtime.getURL('scripts.json')).then(response => {
    if (!response.ok) throw new Error('Could not load the extension script catalog.');
    return response.json();
}).then(async catalog => {
    const service = new ADBService.ControlService(chrome, catalog, {
        debuggerController,
        emit(event, data) {
            if (bridge) bridge.event(event, data);
            if (event === 'routes.updated') {
                chrome.runtime.sendMessage({
                    type: data.framework === 'vue' ? 'VUE_ROUTER_DATA_UPDATE' : 'REACT_ROUTER_DATA_UPDATE',
                    hostname: (() => { try { return new URL(data.href).hostname; } catch (_) { return ''; } })(),
                    tabId: data.tabId, documentId: data.documentId, data: data.data
                }).catch(() => {});
            }
            chrome.runtime.sendMessage({ type: 'ADB_EVENT', event, data }).catch(() => {});
        }
    });
    await service.ready;
    bridge = new ADBBridge.LocalBridge(chrome, service, {
        serializeError: ADBPolicy.serializeError,
        onDisconnect: reason => debuggerController.detachAll(reason)
    });
    await bridge.configure();
    return service;
});

function isExtensionPage(sender) {
    return sender.id === chrome.runtime.id && typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL(''));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object') return false;
    const command = message.type === 'ADB_COMMAND';
    const legacyCommand = ['clear_mode_scripts', 'update_scripts_registration', 'tab_updated'].includes(message.type);
    const contentMessage = ['ADB_DOCUMENT_READY', 'ADB_ROUTE_DATA', 'ADB_CONFIG_APPLIED', 'ADB_HOOK_EVENT', 'VUE_ROUTER_DATA', 'REACT_ROUTER_DATA'].includes(message.type);
    if (!command && !legacyCommand && !contentMessage) return false;
    if ((command || legacyCommand) && !isExtensionPage(sender)) {
        sendResponse({ ok: false, error: { code: 'FORBIDDEN', message: 'Control commands are accepted only from extension pages.' } });
        return false;
    }
    if (contentMessage && (sender.id !== chrome.runtime.id || !sender.tab)) {
        sendResponse({ ok: false, error: { code: 'FORBIDDEN', message: 'A trusted extension content sender is required.' } });
        return false;
    }
    serviceReady.then(async service => {
        if (command) {
            const result = await service.execute(message.method, message.params || {}, { source: 'extension' });
            if (message.method === 'capabilities') result.bridge = bridge.status();
            return { ok: true, result };
        }
        if (legacyCommand) {
            if (message.type === 'tab_updated') await service.updateBadges(await chrome.storage.local.get(null));
            else await service.legacyRegistration(message);
            return { ok: true, success: true };
        }
        if (message.type === 'ADB_DOCUMENT_READY') return { ok: true, result: await service.documentReady(sender, message) };
        if (message.type === 'ADB_ROUTE_DATA' || message.type === 'VUE_ROUTER_DATA' || message.type === 'REACT_ROUTER_DATA') {
            await service.receiveRoutes(sender, { ...message, framework: message.framework || (message.type === 'VUE_ROUTER_DATA' ? 'vue' : 'react') });
        } else if (message.type === 'ADB_CONFIG_APPLIED') await service.receiveApplied(sender, message);
        else if (message.type === 'ADB_HOOK_EVENT') await service.receiveHookEvent(sender, message);
        return { ok: true };
    }).then(sendResponse, error => sendResponse({ ok: false, error: ADBPolicy.serializeError(error) }));
    return true;
});

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'local') return;
    serviceReady.then(async service => {
        if (Object.prototype.hasOwnProperty.call(changes, 'adb_mcp')) await bridge.configure();
        await service.reconcileExternal(changes);
    }).catch(error => console.warn('[AntiDebug] Configuration update failed:', error.message));
});
chrome.alarms.onAlarm.addListener(alarm => { serviceReady.then(() => bridge.alarm(alarm)).catch(() => {}); });
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => { serviceReady.then(service => service.tabUpdated(tabId, changeInfo)).catch(() => {}); });
chrome.tabs.onRemoved.addListener(tabId => {
    serviceReady.then(async service => { service.invalidate(tabId, 'TAB_CLOSED'); await service.persistDocuments(); }).catch(() => {});
});
chrome.tabs.onActivated.addListener(() => {
    serviceReady.then(async service => service.updateBadges(await chrome.storage.local.get(null))).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => { serviceReady.catch(() => {}); });
chrome.runtime.onInstalled.addListener(async () => {
    // Chrome clears user-script registrations on extension updates. Rebuild them
    // from the independent library, even when the MCP bridge is disabled.
    try { await (await serviceReady).scriptLibrary.reconcile(); }
    catch (error) { console.warn('[AntiDebug] Script library restore failed:', error.message); }
    try {
        const key = 'Antidebug_breaker_welcome_redirected';
        const result = await chrome.storage.local.get(key);
        if (!result[key]) { await chrome.storage.local.set({ [key]: true }); await chrome.tabs.create({ url: 'https://antidebug-breaker.com/' }); }
    } catch (error) { console.warn('[AntiDebug] Welcome redirect failed:', error.message); }
});
serviceReady.catch(error => console.error('[AntiDebug] Background initialization failed:', error.message));
