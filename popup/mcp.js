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
    const getLabels = () => ({ disabled: ADB_I18N.t("ui_not_enabled"), connecting: ADB_I18N.t("ui_connecting"), connected: ADB_I18N.t("ui_connected_to_local_mcp"),
        disconnected: ADB_I18N.t("ui_waiting_for_local_mcp"), error: ADB_I18N.t("ui_connection_failed") });
    let settings = { enabled: false, url: defaultUrl, token: '' };
    let controlEnabled = false, nativePermission = null, initialized = false, busy = false;
    let fieldsLoaded = false, readRevision = 0, bridgeStopRevision = 0, controlStopRevision = 0;
    let bridgeStatus = { state: 'disabled' }, statusChanged = false;

    function render() {
        const active = settings.enabled === true;
        const allEnabled = active && controlEnabled;
        ADB_UI.bind(save, () => allEnabled ? ADB_I18N.t("ui_save_connection_settings")
            : active ? ADB_I18N.t("ui_re_enable_browser_control") : ADB_I18N.t("ui_enable_mcp_and_allow_browser_control"), "textContent");
        save.disabled = busy || !initialized || (!allEnabled && nativePermission !== true);
        stop.hidden = !active && !controlEnabled;
        actions.hidden = stop.hidden;
        stop.disabled = busy || !initialized;
        const state = active ? bridgeStatus.state : 'disabled';
        ADB_UI.bind(document.getElementById('status'), () => getLabels()[state] || ADB_I18N.t("ui_waiting_to_connect"), "textContent");
        document.getElementById('status-dot').className = 'dot ' + state;
        ADB_UI.bind(document.getElementById('status-detail'), () => !active
            ? ADB_I18N.t("ui_enter_the_pairing_details_then_use_the_enable_button_below")
            : ADB_I18N.error(bridgeStatus) || (state === 'connected'
                ? allEnabled ? ADB_I18N.t("ui_your_agent_can_manage_scripts_settings_and_routes_and_control_bro") : ADB_I18N.t("ui_extension_tools_are_connected_browser_control_is_disabled")
                : ADB_I18N.t("ui_check_that_local_mcp_is_running_and_the_connection_address_and_pa")), "textContent");
        ADB_UI.bind(controlStatus, () => nativePermission === false
            ? ADB_I18N.t("ui_chrome_debugger_permission_is_unavailable_reload_the_extension_an")
            : nativePermission === null ? ADB_I18N.t("ui_checking_browser_control")
                : allEnabled ? ADB_I18N.t("ui_agent_browser_control_is_allowed_and_remains_enabled_after_restar")
                    : active ? ADB_I18N.t("ui_browser_control_is_disabled_use_the_button_above_to_enable_it_aga")
                        : ADB_I18N.t("ui_enabling_saves_pairing_details_and_allows_your_agent_to_control_t"), "textContent");
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
            ADB_UI.bind(controlStatus, () => ADB_I18N.t("ui_could_not_read_mcp_settings_reopen_the_popup_and_retry"), "textContent");
            ADB_UI.raw(feedback, error.message, "textContent");
        }
    }

    function pairing() {
        const address = new URL(url.value.trim());
        if (address.protocol !== 'ws:' || address.hostname !== '127.0.0.1' ||
            address.pathname !== '/extension' || address.username || address.password || address.search || address.hash) {
            throw new Error(ADB_I18N.t("ui_enter_the_local_websocket_address_e_g") + defaultUrl);
        }
        const value = token.value.trim();
        if (value.length < 32 || value.length > 256) throw new Error(ADB_I18N.t("ui_paste_the_complete_pairing_key_32_256_characters"));
        return { url: address.href, token: value };
    }

    async function update(action) {
        if (busy || !initialized) return;
        const restoringControl = action === 'enable' && settings.enabled === true && !controlEnabled;
        busy = true;
        render();
        ADB_UI.raw(feedback, '', "textContent");
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
                    throw new Error(ADB_I18N.t("ui_chrome_debugger_permission_is_unavailable_reload_the_extension_an"));
                }
                next.enabled = true;
                value.adb_browser_control = { enabled: true };
            } else if (action === 'stop') {
                next.enabled = false;
                value.adb_browser_control = { enabled: false };
            }
            if (action !== 'stop' && (bridgeRevision !== bridgeStopRevision || controlRevision !== controlStopRevision)) {
                throw new Error(ADB_I18N.t("ui_mcp_or_browser_control_was_just_disabled_this_operation_was_cance"));
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
                throw new Error(ADB_I18N.t("ui_a_stop_action_was_detected_mcp_remains_stopped"));
            }
            ADB_UI.bind(feedback, () => action === 'stop' ? ADB_I18N.t("ui_mcp_stopped_pairing_details_are_retained")
                : action === 'enable' ? restoringControl ? ADB_I18N.t("ui_connection_settings_saved_and_browser_control_re_enabled")
                    : ADB_I18N.t("ui_mcp_and_browser_control_enabled_connecting_to_the_local_service")
                    : ADB_I18N.t("ui_connection_settings_saved"), "textContent");
        } catch (error) { ADB_UI.bind(feedback, () => ADB_I18N.t("ui_settings_failed") + ADB_I18N.error(error), "textContent"); }
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
