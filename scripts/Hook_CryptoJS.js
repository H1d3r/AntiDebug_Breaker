// Avoid duplicate installation when CDP and extension document-start injection overlap.
if (!window.__ADB_OBSERVER__?.isInstalled?.("Hook_CryptoJS")) {
// ==UserScript==
// @name         Hook_CryptoJS
// @namespace    https://github.com/0xsdeo/Hook_JS
// @version      2025-10-17
// @description  Hook CryptoJS 对称&哈希&HMAC 所有算法
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


    const adbFinalizeMarker = Symbol.for('antidebug-breaker.hook.cryptojs.finalize');
    let time = 0;

    function hasEncryptProp(obj) {
        const requiredProps = [
            'ciphertext',
            'key',
            'iv',
            'algorithm',
            'mode',
            'padding',
            'blockSize',
            'formatter'
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

    function hasDecryptProp(obj) {
        const requiredProps = [
            'sigBytes',
            'words'
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

    function get_sigBytes(size) {
        switch (size) {
            case 8:
                return "64bits";
            case 16:
                return "128bits";
            case 24:
                return "192bits";
            case 32:
                return "256bits";
            default:
                return adbLogText("log_unavailable", "Unavailable");
        }
    }

    let temp_apply = Function.prototype.apply;

    Function.prototype.apply = function () {
        // CryptoJS 对称加密
        if (arguments.length === 2 && arguments[0] && arguments[1] && typeof arguments[1] === 'object' && arguments[1].length === 1 && hasEncryptProp(arguments[1][0])) {
            if (Object.hasOwn(arguments[0], "$super") && Object.hasOwn(arguments[1], "callee")) {
                if (this.toString().indexOf('function()') !== -1 || /^\s*function(?:\s*\*)?\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/.test(this.toString()) || /^\s*function\s*\(\s*\)\s*\{/.test(this.toString())) {
                    console.log(...arguments);

                    let encrypt_text = arguments[0].$super.toString.call(arguments[1][0]);
                    if (encrypt_text !== "[object Object]") {
                        console.log(adbLogText("log_symmetric_encrypt_output", "Symmetric encryption ciphertext:"), encrypt_text);
                    } else {
                        console.log(adbLogText("log_symmetric_encrypt_output_unavailable", "Symmetric encryption ciphertext: toString was unavailable. Call toString on the object logged above to obtain the ciphertext."));
                    }

                    let key = arguments[1][0]["key"].toString();
                    window.__ADB_OBSERVER__?.emit("Hook_CryptoJS", "crypto", { library: "CryptoJS", algorithm: "symmetric", operation: "encrypt", output: encrypt_text, key, iv: arguments[1][0].iv, evidence: "CipherParams shape" });
                    if (key !== "[object Object]") {
                        console.log(adbLogText("log_symmetric_encrypt_key", "Symmetric encryption key (Hex):"), key);
                    } else {
                        console.log(adbLogText("log_symmetric_encrypt_key_unavailable", "Symmetric encryption key (Hex): toString was unavailable. Call toString on the object logged above to obtain the key."));
                    }

                    let iv = arguments[1][0]["iv"];

                    if (iv) {
                        if (iv.toString() !== "[object Object]") {
                            console.log(adbLogText("log_symmetric_encrypt_iv", "Symmetric encryption IV (Hex):"), iv.toString());
                        } else {
                            console.log(adbLogText("log_symmetric_encrypt_iv_unavailable", "Symmetric encryption IV (Hex): toString was unavailable. Call toString on the object logged above to obtain the IV."));
                        }
                    } else {
                        console.log(adbLogText("log_symmetric_encrypt_no_iv", "Symmetric encryption did not use an IV"))
                    }
                    if (arguments[1][0]["padding"]) {
                        console.log(adbLogText("log_symmetric_encrypt_padding", "Symmetric encryption padding:"), arguments[1][0]["padding"]);
                    }
                    if (arguments[1][0]["mode"] && Object.hasOwn(arguments[1][0]["mode"], "Encryptor")) {
                        console.log(adbLogText("log_symmetric_encrypt_mode", "Symmetric encryption mode:"), arguments[1][0]["mode"]["Encryptor"]["processBlock"]);
                    }
                    if (arguments[1][0]["key"] && Object.hasOwn(arguments[1][0]["key"], "sigBytes")) {
                        console.log(adbLogText("log_symmetric_encrypt_key_length", "Symmetric encryption key length:"), get_sigBytes(arguments[1][0]["key"]["sigBytes"]));
                    }
                    console.log("%c---------------------------------------------------------------------", "color: green;");
                } else {
                    console.groupCollapsed(adbLogText("log_symmetric_parameters_fallback_title", "Ignore this message if the key, IV and other encryption parameters were printed above."));
                    console.log(...arguments);
                    console.log(adbLogText("log_symmetric_parameters_fallback", "Symmetric encryption: the key, IV or other parameters could not be printed. Call toString on the objects logged above to inspect the parameters."));
                    console.log("%c---------------------------------------------------------------------", "color: green;");
                    console.groupEnd();
                }
            }
            // CryptoJS 对称解密
        } else if (arguments.length === 2 && arguments[0] && arguments[1] && typeof arguments[1] === 'object' && arguments[1].length === 3 && hasDecryptProp(arguments[1][1])) {
            if (Object.hasOwn(arguments[0], "$super") && Object.hasOwn(arguments[1], "callee")) {
                if (this.toString().indexOf('function()') === -1 && arguments[1][0] === 2) {
                    console.log(...arguments);

                    let key = arguments[1][1].toString();
                    window.__ADB_OBSERVER__?.emit("Hook_CryptoJS", "crypto", { library: "CryptoJS", algorithm: "symmetric", operation: "decrypt", key, options: arguments[1][2], evidence: "decrypt configuration shape" });
                    if (key !== "[object Object]") {
                        console.log(adbLogText("log_symmetric_decrypt_key", "Symmetric decryption key (Hex):"), key);
                    } else {
                        console.log(adbLogText("log_symmetric_decrypt_key_unavailable", "Symmetric decryption key (Hex): toString was unavailable. Call toString on the object logged above to obtain the key."));
                    }

                    if (Object.hasOwn(arguments[1][2], "iv") && arguments[1][2]["iv"]) {
                        let iv = arguments[1][2]["iv"].toString();
                        if (iv !== "[object Object]") {
                            console.log(adbLogText("log_symmetric_decrypt_iv", "Symmetric decryption IV (Hex):"), iv);
                        } else {
                            console.log(adbLogText("log_symmetric_decrypt_iv_unavailable", "Symmetric decryption IV (Hex): toString was unavailable. Call toString on the object logged above to obtain the IV."));
                        }
                    } else {
                        console.log(adbLogText("log_symmetric_decrypt_no_iv", "Symmetric decryption did not use an IV"))
                    }

                    if (Object.hasOwn(arguments[1][2], "padding") && arguments[1][2]["padding"]) {
                        console.log(adbLogText("log_symmetric_decrypt_padding", "Symmetric decryption padding:"), arguments[1][2]["padding"]);
                    }
                    if (Object.hasOwn(arguments[1][2], "mode") && arguments[1][2]["mode"]) {
                        console.log(adbLogText("log_symmetric_decrypt_mode", "Symmetric decryption mode:"), arguments[1][2]["mode"]["Encryptor"]["processBlock"]);
                    }
                    if (time === 0) {
                        console.log(adbLogText("log_crypto_fuzz_reference", "A script for testing encryption/decryption parameters (algorithm, mode, padding, etc.): https://github.com/0xsdeo/Fuzz_Crypto_Algorithms"));
                        time += 1;
                    }
                    console.log("%c---------------------------------------------------------------------", "color: green;");
                }
            }
            // CryptoJS 哈希 / HMAC
        } else if (arguments.length === 2 && arguments[0] && arguments[1] && typeof arguments[0] === 'object' && typeof arguments[1] === 'object') {
            if (arguments[0].__proto__ && Object.hasOwn(arguments[0].__proto__, "$super") && Object.hasOwn(arguments[0].__proto__, "_doFinalize") && arguments[0].__proto__.__proto__ && Object.hasOwn(arguments[0].__proto__.__proto__, "finalize")) {
                if (!arguments[0].__proto__.__proto__.finalize[adbFinalizeMarker]) {
                    let temp_finalize = arguments[0].__proto__.__proto__.finalize;

                    arguments[0].__proto__.__proto__.finalize = function () {
                        if (!(Object.hasOwn(this, "init"))) {
                            let hash = temp_finalize.call(this, ...arguments);
                            window.__ADB_OBSERVER__?.emit("Hook_CryptoJS", "crypto", { library: "CryptoJS", algorithm: "hash/HMAC", operation: "finalize", input: arguments[0], output: hash.toString(), keyAvailable: false });
                            console.log(adbLogText("log_hash_input", "Hash/HMAC input:"), ...arguments);
                            console.log(adbLogText("log_hash_output", "Hash/HMAC output:"), hash.toString());
                            console.log(adbLogText("log_hash_output_length", "Hash/HMAC output length:"), hash.toString().length);
                            console.log(adbLogText("log_hmac_key_unavailable", "Note: This Hook does not capture the HMAC key; locate the key separately."))
                            console.log("%c---------------------------------------------------------------------", "color: green;");
                            return hash;
                        }
                        return temp_finalize.call(this, ...arguments)
                    }
                    Object.defineProperty(arguments[0].__proto__.__proto__.finalize, adbFinalizeMarker, { value: true });
                }
            }
        }
        return temp_apply.call(this, ...arguments);
    }
})();
window.__ADB_OBSERVER__?.installed("Hook_CryptoJS");

}
