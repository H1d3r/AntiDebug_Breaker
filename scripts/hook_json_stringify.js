// Avoid duplicate installation when CDP and extension document-start injection overlap.
if (!window.__ADB_OBSERVER__?.isInstalled?.("hook_json_stringify")) {
// ==UserScript==
// @name         hook_JSON
// @namespace    https://github.com/0xsdeo/Hook_JS
// @version      2024-10-29
// @description  重写parse和stringify方法，以此来获取调用这个方法所传入的内容以及堆栈信息。
// @author       0xsdeo
// @match        http://*/*
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // Keep a standalone English fallback when this script is copied without the extension runtime.
    const adbI18nKey = Symbol.for('antidebug-breaker.i18n');
    function adbLogText(key, fallback, params = []) {
        try {
            const text = globalThis[adbI18nKey]?.t(key, params);
            if (typeof text === 'string' && text !== key) return text;
        } catch (_) { /* Translation must not interrupt an intercepted call. */ }
        return fallback.replace(/\{(\d+)\}/g, (_, index) => params[index] === undefined ? '' : String(params[index]));
    }


    const SCRIPT_ID = 'hook_json_stringify';

    function clear_Antidebug(id) {
        localStorage.removeItem("Antidebug_breaker_" + id + "_flag");
        localStorage.removeItem("Antidebug_breaker_" + id + "_debugger");
        localStorage.removeItem("Antidebug_breaker_" + id + "_stack");
    }

    let adbInitialized = false;
    function initHook() {
        if (adbInitialized || window.__ADB_OBSERVER__?.isInstalled?.("hook_json_stringify")) return;
        let flag = localStorage.getItem("Antidebug_breaker_" + SCRIPT_ID + "_flag");
        let is_debugger = localStorage.getItem("Antidebug_breaker_" + SCRIPT_ID + "_debugger");
        let is_stack = localStorage.getItem("Antidebug_breaker_" + SCRIPT_ID + "_stack");

        let json_s = JSON.stringify;
        JSON.stringify = function () {
            if (flag === "0") {
                console.log(adbLogText("log_json_stringify", "JSON.stringify called with arguments:\n"), ...arguments);
                window.__ADB_OBSERVER__?.emit(SCRIPT_ID, "call", { arguments });
                if (is_debugger === "1") {
                    debugger;
                }
                if (is_stack === "1") {
                    console.log(new Error().stack);
                }
            }
            return json_s(...arguments);
        }
        clear_Antidebug(SCRIPT_ID);
        adbInitialized = true;
        window.__ADB_OBSERVER__?.installed(SCRIPT_ID);
    }

    function setupConfigListener() {
        window.addEventListener('message', function (event) {
            // 只接受来自扩展的消息
            if (event.source !== window ||
                !event.data ||
                event.data.source !== 'antidebug-extension' ||
                event.data.type !== 'HOOK_CONFIG_READY') {
                return;
            }

            // 检查是否包含当前脚本ID
            const scriptIds = event.data.scriptIds || [];
            if (scriptIds.includes(SCRIPT_ID)) {
                // 配置已就绪，初始化Hook
                initHook();
            }
        });
    }

    // 立即设置监听器
    setupConfigListener();
})();
}
