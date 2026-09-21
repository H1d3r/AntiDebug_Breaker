// Avoid duplicate installation when CDP and extension document-start injection overlap.
if (!window.__ADB_OBSERVER__?.isInstalled?.("hook_log")) {
// ==UserScript==
// @name         hook log
// @namespace    http://tampermonkey.net/
// @version      2025-10-25
// @description  让console的部分属性只读，防止被重写
// @author       yousan
// @match        *://*/*
// @icon
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

    const readonlyProps = ['log', 'trace', 'groupCollapsed', 'groupEnd'];
    // 代理console对象，实现只读属性，防止方法被重写
    const readonlyConsole = new Proxy(console, {
        set(t, k, v, r) {
            if (readonlyProps.includes(k)) {
                console.groupCollapsed(adbLogText("log_console_method_overwrite_blocked", "%cBlocked an attempt to overwrite console.{0}", [`${k}`]),"color: #ff6348;", v);
                console.trace(); // hidden in collapsed group
                console.groupEnd();
                return true;
            }
            return Reflect.set(t, k, v, r);
        }
    });
    // 防止console被重新赋值，导致Proxy失效
    // 这里的描述符和原本的console不一致，这里使用get、set，而原本的是value和writable，
    // 区别在于这种方式重新赋值不会报错，而writable: false会报错，可能会影响到网页代码的正常运行，
    // 当然如果遇到属性描述符检测，这两种写法都一样会被检测出来，所以综合考虑选择get、set的写法
    Object.defineProperty(window, 'console', {
        configurable: true,
        enumerable: false,
        get: function () {
            return readonlyConsole;
        },
        set: function (v) {
            console.groupCollapsed(adbLogText("log_console_overwrite_blocked", "%cBlocked an attempt to overwrite console"), "color: #ff6348;", v);
            console.trace(); // hidden in collapsed group
            console.groupEnd();
        }
    });
})();
window.__ADB_OBSERVER__?.installed("hook_log");

}
