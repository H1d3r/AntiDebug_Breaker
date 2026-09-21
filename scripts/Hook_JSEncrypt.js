// Avoid duplicate installation when CDP and extension document-start injection overlap.
if (!window.__ADB_OBSERVER__?.isInstalled?.("Hook_JSEncrypt")) {
// ==UserScript==
// @name         Hook_JSEncrypt_RSA
// @namespace    https://github.com/0xsdeo/Hook_JS
// @version      2025-10-24
// @description  Hook JSEncrypt RSA
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


    // Shared with the combined RSA/SM Hook; never infer installation from translated log text.
    const adbEncryptMarker = Symbol.for('antidebug-breaker.hook.rsa.encrypt');
    const adbDecryptMarker = Symbol.for('antidebug-breaker.hook.rsa.decrypt');
    let u, c = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    function f(t) {
        let e, i, r = "";
        for (e = 0; e + 3 <= t.length; e += 3)
            i = parseInt(t.substring(e, e + 3), 16),
                r += c.charAt(i >> 6) + c.charAt(63 & i);
        for (e + 1 == t.length ? (i = parseInt(t.substring(e, e + 1), 16),
            r += c.charAt(i << 2)) : e + 2 == t.length && (i = parseInt(t.substring(e, e + 2), 16),
            r += c.charAt(i >> 2) + c.charAt((3 & i) << 4)); (3 & r.length) > 0; )
            r += "=";
        return r
    }

    function hasRSAProp(obj) {
        const requiredProps = [
            'constructor',
            'getPrivateBaseKey',
            'getPrivateBaseKeyB64',
            'getPrivateKey',
            'getPublicBaseKey',
            'getPublicBaseKeyB64',
            'getPublicKey',
            'parseKey',
            'parsePropertiesFrom'
        ];

        // 检查对象是否存在且为对象类型
        if (!obj || typeof obj !== 'object') {
            return false;
        }

        // 检查所有必需属性是否存在
        for (const prop of requiredProps) {
            if (!(prop in obj)) {
                return false;
            }
        }

        return true;
    }

    let temp_call = Function.prototype.call;

    Function.prototype.call = function () {
        if (arguments.length === 1 && arguments[0] && arguments[0].__proto__ && typeof arguments[0].__proto__ === 'object' && hasRSAProp(arguments[0].__proto__)) {
            if ("__proto__" in arguments[0].__proto__ && arguments[0].__proto__.__proto__ && Object.hasOwn(arguments[0].__proto__.__proto__, "encrypt") && Object.hasOwn(arguments[0].__proto__.__proto__, "decrypt")) {
                if (!arguments[0].__proto__.__proto__.encrypt[adbEncryptMarker]) {

                    let temp_encrypt = arguments[0].__proto__.__proto__.encrypt;

                    arguments[0].__proto__.__proto__.encrypt = function () {
                        let encrypt_text = temp_encrypt.bind(this, ...arguments)();

                        const adbPublicKey = this.getPublicKey();
                        window.__ADB_OBSERVER__?.emit("Hook_JSEncrypt", "crypto", { library: "JSEncrypt", algorithm: "RSA", operation: "encrypt", input: arguments[0], key: adbPublicKey, output: encrypt_text, outputEncoding: "hex" });
                        console.log(adbLogText("log_rsa_public_key", "RSA public key:\n"), adbPublicKey);
                        console.log(adbLogText("log_rsa_encrypt_input", "RSA encryption input:"), ...arguments);
                        console.log(adbLogText("log_rsa_encrypt_output", "RSA encryption ciphertext (Base64):"), f(encrypt_text));
                        console.log("%c---------------------------------------------------------------------", "color: green;");
                        return encrypt_text;
                    }
                    Object.defineProperty(arguments[0].__proto__.__proto__.encrypt, adbEncryptMarker, { value: true });
                }

                if (!arguments[0].__proto__.__proto__.decrypt[adbDecryptMarker]) {

                    let temp_decrypt = arguments[0].__proto__.__proto__.decrypt;

                    arguments[0].__proto__.__proto__.decrypt = function () {
                        let decrypt_text = temp_decrypt.bind(this, ...arguments)();

                        const adbPrivateKey = this.getPrivateKey();
                        window.__ADB_OBSERVER__?.emit("Hook_JSEncrypt", "crypto", { library: "JSEncrypt", algorithm: "RSA", operation: "decrypt", input: arguments[0], key: adbPrivateKey, output: decrypt_text });
                        console.log(adbLogText("log_rsa_private_key", "RSA private key:\n"), adbPrivateKey);
                        console.log(adbLogText("log_rsa_decrypt_input", "RSA decryption input (Base64):"), f(...arguments));
                        console.log(adbLogText("log_rsa_decrypt_output", "RSA decryption plaintext:"), decrypt_text);
                        console.log("%c---------------------------------------------------------------------", "color: green;");
                        return decrypt_text;
                    }
                    Object.defineProperty(arguments[0].__proto__.__proto__.decrypt, adbDecryptMarker, { value: true });
                }
            }
        }
        return temp_call.bind(this, ...arguments)();
    }
})();
window.__ADB_OBSERVER__?.installed("Hook_JSEncrypt");

}
