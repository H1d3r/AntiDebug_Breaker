// Avoid duplicate installation when CDP and extension document-start injection overlap.
if (!window.__ADB_OBSERVER__?.isInstalled?.("Clear_vue_Navigation_Guards")) {
// ==UserScript==
// @name         Clear_vue_Navigation_Guards
// @namespace    https://github.com/0xsdeo/Hook_JS
// @version      v1.0
// @description  清除vue的全局前置守卫和全局解析守卫
// @author       0xsdeo
// @run-at       document-start
// @match        *
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


    // let temp_toString = Function.prototype.toString;
    //
    // Function.prototype.toString = function () {
    //     if (this === Function.prototype.toString) {
    //         return 'function toString() { [native code] }';
    //     } else if (this === xxx) { // 将xxx修改为要hook的方法
    //         return ''; // 在控制台执行xxx.toString()，将输出的内容替换掉空字符串
    //     }
    //     return temp_toString.apply(this, arguments);
    // }

    let temp_push = Array.prototype.push; // 将xxx修改为要hook的方法，temp_xxx变量名可以根据需要进行修改命名

    Array.prototype.push = function () { // 将xxx修改为要hook的方法
        if (arguments.length === 0) {
            return temp_push.call(this, ...arguments);
        }

        // 检查第一个参数是否是函数
        if (typeof arguments[0] !== 'function') {
            return temp_push.call(this, ...arguments);
        }

        let stack = new Error().stack;
        if (stack.includes('beforeEach') || stack.includes('beforeResolve')) {
            // console.log(stack)
            let temp_array = stack.split('\n');
            if (temp_array < 4) {
                return temp_push.call(this, ...arguments);
            }
            else if (temp_array[3].includes('beforeEach') || temp_array[2].includes('beforeEach')) {
                console.log(...arguments);
                console.log(adbLogText("log_vue_before_guard_removed", "%cGlobal beforeEach navigation guard detected and removed"), "color: green;");
                return temp_push.call(this); // 将网站js调用目标方法时所传入的内容传给原方法执行并返回结果
            }
            else if (temp_array[3].includes('beforeResolve') || temp_array[2].includes('beforeResolve')) {
                console.log(...arguments);
                console.log(adbLogText("log_vue_resolve_guard_removed", "%cGlobal beforeResolve navigation guard detected and removed"), "color: green;");
                return temp_push.call(this); // 将网站js调用目标方法时所传入的内容传给原方法执行并返回结果
            }
        }
        return temp_push.call(this, ...arguments); // 将网站js调用目标方法时所传入的内容传给原方法执行并返回结果
    }
})();
window.__ADB_OBSERVER__?.installed("Clear_vue_Navigation_Guards");

}
