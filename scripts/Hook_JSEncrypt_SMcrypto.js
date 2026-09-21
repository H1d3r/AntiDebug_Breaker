// Avoid duplicate installation when CDP and extension document-start injection overlap.
if (!window.__ADB_OBSERVER__?.isInstalled?.("Hook_JSEncrypt_SMcrypto")) {
// ==UserScript==
// @name         Hook_JSEncrypt_SM
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

    const adbEncryptMarker = Symbol.for('antidebug-breaker.hook.rsa.encrypt');
    const adbDecryptMarker = Symbol.for('antidebug-breaker.hook.rsa.decrypt');

    // Keep a standalone English fallback when this script is copied without the extension runtime.
    const adbI18nKey = Symbol.for('antidebug-breaker.i18n');
    function adbLogText(key, fallback, params = []) {
        try {
            const text = globalThis[adbI18nKey]?.t(key, params);
            if (typeof text === 'string' && text !== key) return text;
        } catch (_) { /* Translation must not interrupt an intercepted call. */ }
        return fallback.replace(/\{(\d+)\}/g, (_, index) => params[index] === undefined ? '' : String(params[index]));
    }


    function sm3_encrypt_test(func) {
        try {
            return func("123456");

        } catch (err) {
            return false;
        }
    }

    function has_SM2_Prop(obj) {
        const requiredProps = [
            'doDecrypt',
            'doEncrypt',
            'doSignature',
            'doVerifySignature',
            'generateKeyPairHex',
            'getPoint'
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

    function sm4_encrypt_test(func) {
        try {
            let sm4Key = "0123456789abcdeffedcba9876543210"; // 32位hex = 16字节
            let sm4Iv  = "000102030405060708090a0b0c0d0e0f";

            let sm4EncryptData = func("123456", sm4Key, {
                mode: 'cbc',
                iv: sm4Iv,
                cipherType: 'hex'
            });

            return sm4EncryptData;

        } catch (err) {
            return false;
        }
    }

    function sm4_decrypt_test(func) {
        try {
            let sm4Key = "0123456789abcdeffedcba9876543210"; // 32位hex = 16字节
            let sm4Iv  = "000102030405060708090a0b0c0d0e0f";

            let sm4DecryptData = func("1b96f27b7f523118539b416810c91d4d", sm4Key, {
                mode: 'cbc',
                iv: sm4Iv,
                cipherType: 'hex'
            });

            return sm4DecryptData;

        } catch (err) {
            return false;
        }
    }


// 记录 SM2 doEncrypt
    let raw_doEncrypt;

// 替换 SM2 doEncrypt 的方法
    function my_doEncrypt() {
        let result = Reflect.apply(raw_doEncrypt, this, arguments);
        window.__ADB_OBSERVER__?.emit("Hook_JSEncrypt_SMcrypto", "crypto", { library: "sm-crypto", algorithm: "SM2", operation: "encrypt", input: arguments[0], key: arguments[1], options: arguments[2], output: result });
        console.log(adbLogText("log_sm2_encrypt_input", "SM2 encryption plaintext:"), arguments[0]);
        console.log(adbLogText("log_sm2_encrypt_key", "SM2 encryption public key:"), arguments[1]);
        console.log(adbLogText("log_sm2_encrypt_output", "SM2 encryption ciphertext:"), result);
        return result;
    }

    // 记录 SM2 doDecrypt
    let raw_doDecrypt;

// 替换 SM2 doDecrypt 的方法
    function my_doDecrypt() {
        let result = Reflect.apply(raw_doDecrypt, this, arguments);
        window.__ADB_OBSERVER__?.emit("Hook_JSEncrypt_SMcrypto", "crypto", { library: "sm-crypto", algorithm: "SM2", operation: "decrypt", input: arguments[0], key: arguments[1], options: arguments[2], output: result });
        console.log(adbLogText("log_sm2_decrypt_input", "SM2 decryption ciphertext:"), arguments[0]);
        console.log(adbLogText("log_sm2_decrypt_key", "SM2 decryption private key:"), arguments[1]);
        console.log(adbLogText("log_sm2_decrypt_output", "SM2 decryption plaintext:"), result);
        return result;
    }

    // 记录 SM4 doDecrypt
    let raw_sm4_encrypt;

// 替换 SM4 doDecrypt 的方法
    function my_sm4_encrypt() {
        let result = Reflect.apply(raw_sm4_encrypt, this, arguments);
        window.__ADB_OBSERVER__?.emit("Hook_JSEncrypt_SMcrypto", "crypto", { library: "sm-crypto", algorithm: "SM4", operation: "encrypt", input: arguments[0], key: arguments[1], options: arguments[2], output: result });
        console.log(adbLogText("log_sm4_encrypt_input", "SM4 encryption plaintext:"), arguments[0]);
        console.log(adbLogText("log_sm4_encrypt_key", "SM4 encryption key:"), arguments[1]);
        if (arguments[2] && typeof arguments[2] === "object") {
            if (arguments[2].cipherType) {
                console.log(adbLogText("log_sm4_encrypt_format", "SM4 encryption data format:"), arguments[2].cipherType);
            }
            if (arguments[2].iv) {
                console.log(adbLogText("log_sm4_encrypt_iv", "SM4 encryption IV:"), arguments[2].iv);
            }
            if (arguments[2].mode) {
                console.log(adbLogText("log_sm4_encrypt_mode", "SM4 encryption mode:"), arguments[2].mode);
            }
        }
        console.log(adbLogText("log_sm4_encrypt_output", "SM4 encryption ciphertext:"),result);
        return result;
    }

    // 记录 SM4 doDecrypt
    let raw_sm4_decrypt;

// 替换 SM4 doDecrypt 的方法
    function my_sm4_decrypt() {
        let result = Reflect.apply(raw_sm4_decrypt, this, arguments);
        window.__ADB_OBSERVER__?.emit("Hook_JSEncrypt_SMcrypto", "crypto", { library: "sm-crypto", algorithm: "SM4", operation: "decrypt", input: arguments[0], key: arguments[1], options: arguments[2], output: result });
        console.log(adbLogText("log_sm4_decrypt_input", "SM4 decryption ciphertext:"), arguments[0]);
        console.log(adbLogText("log_sm4_decrypt_key", "SM4 decryption key:"), arguments[1]);
        if (arguments[2] && typeof arguments[2] === "object") {
            if (arguments[2].cipherType) {
                console.log(adbLogText("log_sm4_decrypt_format", "SM4 decryption data format:"), arguments[2].cipherType);
            }
            if (arguments[2].iv) {
                console.log(adbLogText("log_sm4_decrypt_iv", "SM4 decryption IV:"), arguments[2].iv);
            }
            if (arguments[2].mode) {
                console.log(adbLogText("log_sm4_decrypt_mode", "SM4 decryption mode:"), arguments[2].mode);
            }
        }
        console.log(adbLogText("log_sm4_decrypt_output", "SM4 decryption plaintext:"),result);
        return result;
    }

    // 记录 SM3 encrypt
    let raw_sm3;

// 替换 SM3 encrypt 的方法
    function my_SM3() {
        let result = Reflect.apply(raw_sm3, this, arguments);
        window.__ADB_OBSERVER__?.emit("Hook_JSEncrypt_SMcrypto", "crypto", { library: "sm-crypto", algorithm: "SM3", operation: "digest", input: arguments[0], key: arguments[1], options: arguments[2], output: result });
        console.log(adbLogText("log_sm3_input", "SM3 input:"), arguments[0]);
        console.log(adbLogText("log_sm3_output", "SM3 output:"), result);
        return result;
    }

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
                        window.__ADB_OBSERVER__?.emit("Hook_JSEncrypt_SMcrypto", "crypto", { library: "JSEncrypt", algorithm: "RSA", operation: "encrypt", input: arguments[0], key: adbPublicKey, output: encrypt_text, outputEncoding: "hex" });
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
                        window.__ADB_OBSERVER__?.emit("Hook_JSEncrypt_SMcrypto", "crypto", { library: "JSEncrypt", algorithm: "RSA", operation: "decrypt", input: arguments[0], key: adbPrivateKey, output: decrypt_text });
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

        const result = Reflect.apply(temp_call, this, arguments);

        // 判断参数是否满足 webpack 的加载条件
        if (arguments.length === 4 && arguments[1]?.exports) {
            const exports = arguments[1].exports;

            if (exports.doEncrypt && has_SM2_Prop(exports)) {
                raw_doEncrypt = exports.doEncrypt;
                exports.doEncrypt = my_doEncrypt;
            }
            if (exports.doDecrypt && has_SM2_Prop(exports)) {
                raw_doDecrypt = exports.doDecrypt;
                exports.doDecrypt = my_doDecrypt;
            }
            if (exports.encrypt) {
                if (sm4_encrypt_test(exports.encrypt) === "1b96f27b7f523118539b416810c91d4d"){
                    raw_sm4_encrypt = exports.encrypt;
                    exports.encrypt = my_sm4_encrypt;
                }
            }
            if (exports.decrypt) {
                if (sm4_decrypt_test(exports.decrypt) === "123456"){
                    raw_sm4_decrypt = exports.decrypt;
                    exports.decrypt = my_sm4_decrypt;
                }
            }
            if (typeof exports === "function" && exports.toString().includes('invalid mode') && sm3_encrypt_test(exports) === "207cf410532f92a47dee245ce9b11ff71f578ebd763eb3bbea44ebd043d018fb") {
                raw_sm3 = exports;
                arguments[1].exports = my_SM3;
            }
        }
        return result;
    }
})();
window.__ADB_OBSERVER__?.installed("Hook_JSEncrypt_SMcrypto");

}
