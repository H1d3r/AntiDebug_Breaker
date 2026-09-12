(() => {
    'use strict';
    const form = document.getElementById('connection-form');
    const url = document.getElementById('url');
    const token = document.getElementById('token');
    const save = document.getElementById('save');
    const actions = document.getElementById('connection-actions');
    const stop = document.getElementById('stop-mcp');
    const feedback = document.getElementById('feedback');
    const controlStatus = document.getElementById('browser-permission-status');
    const defaultUrl = 'ws://127.0.0.1:19876/extension';
    const labels = { disabled: '尚未启用', connecting: '正在连接', connected: '已连接到本地 MCP',
        disconnected: '等待本地 MCP', error: '连接失败' };
    let settings = { enabled: false, url: defaultUrl, token: '' };
    let controlEnabled = false, nativePermission = null, initialized = false, busy = false;
    let fieldsLoaded = false, readRevision = 0, bridgeStopRevision = 0, controlStopRevision = 0;
    let bridgeStatus = { state: 'disabled' }, statusChanged = false;

    function render() {
        const active = settings.enabled === true;
        const allEnabled = active && controlEnabled;
        save.textContent = allEnabled ? '保存连接设置'
            : active ? '重新启用浏览器控制' : '启用 MCP 并允许 Agent 控制浏览器';
        save.disabled = busy || !initialized || (!allEnabled && nativePermission !== true);
        stop.hidden = !active && !controlEnabled;
        actions.hidden = stop.hidden;
        stop.disabled = busy || !initialized;
        const state = active ? bridgeStatus.state : 'disabled';
        document.getElementById('status').textContent = labels[state] || '等待连接';
        document.getElementById('status-dot').className = 'dot ' + state;
        document.getElementById('status-detail').textContent = !active
            ? '填写配对信息，点击下方启用按钮即可开始。'
            : bridgeStatus.message || (state === 'connected'
                ? allEnabled ? 'Agent 可以管理脚本、配置和路由，并控制浏览器页面。' : '插件功能已连接；浏览器控制已停用。'
                : '请确认本地 MCP 已启动，连接地址和配对密钥一致。');
        controlStatus.textContent = nativePermission === false
            ? 'Chrome 调试权限不可用，请重新加载扩展并确认权限。'
            : nativePermission === null ? '正在检查控制状态…'
                : allEnabled ? '已允许 Agent 控制浏览器，设置会在重启后保留。'
                    : active ? '浏览器控制已停用，点击上方按钮可重新启用。'
                        : '启用时会保存配对信息，并允许 Agent 控制浏览器。';
    }

    async function refresh() {
        const revision = ++readRevision;
        try {
            const [granted, saved] = await Promise.all([
                chrome.permissions.contains({ permissions: ['debugger'] }),
                chrome.storage.local.get(['adb_mcp', 'adb_browser_control'])
            ]);
            if (revision !== readRevision) return;
            settings = saved.adb_mcp || { enabled: false, url: defaultUrl, token: '' };
            controlEnabled = saved.adb_browser_control?.enabled === true;
            nativePermission = granted;
            initialized = true;
            if (!fieldsLoaded) {
                url.value = settings.url || defaultUrl;
                token.value = settings.token || '';
                fieldsLoaded = true;
            }
            render();
        } catch (error) {
            if (revision !== readRevision) return;
            initialized = false;
            nativePermission = null;
            render();
            controlStatus.textContent = '无法读取 MCP 设置，请重新打开面板后重试。';
            feedback.textContent = error.message;
        }
    }

    function pairing() {
        const address = new URL(url.value.trim());
        if (address.protocol !== 'ws:' || address.hostname !== '127.0.0.1' ||
            address.pathname !== '/extension' || address.username || address.password || address.search || address.hash) {
            throw new Error('请输入本机 WebSocket 地址，例如 ' + defaultUrl);
        }
        const value = token.value.trim();
        if (value.length < 32 || value.length > 256) throw new Error('请粘贴完整配对密钥（32–256 个字符）。');
        return { url: address.href, token: value };
    }

    async function update(action) {
        if (busy || !initialized) return;
        const restoringControl = action === 'enable' && settings.enabled === true && !controlEnabled;
        busy = true;
        render();
        feedback.textContent = '';
        const bridgeRevision = bridgeStopRevision, controlRevision = controlStopRevision;
        try {
            // Stopping uses saved credentials, even if the form contains invalid unsaved edits.
            const edited = action === 'stop' ? null : pairing();
            const saved = await chrome.storage.local.get(['adb_mcp', 'adb_browser_control']);
            const current = saved.adb_mcp || { enabled: false, url: defaultUrl, token: '' };
            const next = { ...current, ...edited, enabled: current.enabled === true };
            const value = { adb_mcp: next };
            if (action === 'enable') {
                if (!await chrome.permissions.contains({ permissions: ['debugger'] })) {
                    throw new Error('Chrome 调试权限不可用，请重新加载扩展并确认权限。');
                }
                next.enabled = true;
                value.adb_browser_control = { enabled: true };
            } else if (action === 'stop') {
                next.enabled = false;
                value.adb_browser_control = { enabled: false };
            }
            if (action !== 'stop' && (bridgeRevision !== bridgeStopRevision || controlRevision !== controlStopRevision)) {
                throw new Error('MCP 或浏览器控制刚刚被停用，本次操作已取消。');
            }
            await chrome.storage.local.set(value);
            // A stop from Chrome or another popup wins over a write already in flight.
            const stoppedBridge = action !== 'stop' && bridgeRevision !== bridgeStopRevision;
            const stoppedControl = action !== 'stop' && controlRevision !== controlStopRevision;
            if (stoppedBridge || stoppedControl) {
                const stopped = {};
                if (stoppedBridge) stopped.adb_mcp = { ...next, enabled: false };
                if (stoppedControl || stoppedBridge) stopped.adb_browser_control = { enabled: false };
                await chrome.storage.local.set(stopped);
                throw new Error('检测到停用操作，已保持停止状态。');
            }
            feedback.textContent = action === 'stop' ? 'MCP 已停止，配对信息已保留。'
                : action === 'enable' ? restoringControl ? '已保存连接设置并重新启用浏览器控制。'
                    : '已启用 MCP 和浏览器控制，正在连接本地服务。'
                    : '连接设置已保存。';
        } catch (error) { feedback.textContent = '设置失败：' + error.message; }
        finally {
            await refresh();
            busy = false;
            render();
        }
    }

    form.addEventListener('submit', event => {
        event.preventDefault();
        // Capture the visible button's meaning; a concurrent stop must not turn a save into an enable.
        return update(settings.enabled === true && controlEnabled ? 'save' : 'enable');
    });
    stop.addEventListener('click', () => update('stop'));
    const permissionChanged = change => {
        if (change.permissions?.includes('debugger')) void refresh();
    };
    chrome.permissions.onAdded.addListener(permissionChanged);
    chrome.permissions.onRemoved.addListener(permissionChanged);
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'session' && changes.adb_mcp_status) {
            statusChanged = true;
            bridgeStatus = changes.adb_mcp_status.newValue || { state: 'disabled' };
            render();
        }
        if (area !== 'local' || (!changes.adb_mcp && !changes.adb_browser_control)) return;
        if (changes.adb_mcp?.oldValue?.enabled === true && changes.adb_mcp.newValue?.enabled !== true) bridgeStopRevision++;
        if (changes.adb_browser_control?.oldValue?.enabled === true && changes.adb_browser_control.newValue?.enabled !== true) controlStopRevision++;
        void refresh();
    });
    chrome.storage.session.get('adb_mcp_status').then(saved => {
        if (!statusChanged) bridgeStatus = saved.adb_mcp_status || { state: 'disabled' };
        render();
    }).catch(() => {});
    render();
    void refresh();
})();
