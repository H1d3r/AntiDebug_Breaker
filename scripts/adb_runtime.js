// Shared observation runtime, registered before the enabled scripts.
(() => {
    'use strict';
    if (window.__ADB_OBSERVER__) return;
    const native = {
        apply: Reflect.apply, stringify: JSON.stringify, descriptors: Object.getOwnPropertyDescriptors,
        descriptor: Object.getOwnPropertyDescriptor,
        keys: Object.keys, isArray: Array.isArray, now: Date.now, Error, post: window.postMessage,
        isView: ArrayBuffer.isView,
        typedArrayByteLength: Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength').get,
        dataViewByteLength: Object.getOwnPropertyDescriptor(DataView.prototype, 'byteLength').get
    };
    let busy = false;
    let sequence = 0;
    let revision = null;
    let windowStart = 0;
    let windowCount = 0;
    let dropped = 0;
    const installed = new Set();

    function snapshot(value, depth = 0, seen = new WeakSet(), budget = { nodes: 256 }) {
        if (--budget.nodes < 0) return '[Size limit]';
        if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
        if (typeof value === 'string') return value.length > 4096 ? value.slice(0, 4096) + '…' : value;
        if (typeof value === 'undefined') return { type: 'undefined' };
        if (typeof value === 'bigint' || typeof value === 'symbol') return String(value);
        if (typeof value === 'function') return '[Function]';
        if (depth >= 3) return '[Depth limit]';
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
        try {
            if (native.isView(value)) {
                let byteLength;
                try { byteLength = native.apply(native.typedArrayByteLength, value, []); }
                catch (_) { byteLength = native.apply(native.dataViewByteLength, value, []); }
                return { type: 'ArrayBufferView', byteLength };
            }
            const descriptors = native.descriptors(value);
            const out = native.isArray(value) ? [] : Object.create(null);
            let count = 0;
            for (const key of native.keys(descriptors)) {
                if (!descriptors[key].enumerable) continue;
                if (++count > 24) { if (native.isArray(out)) out[out.length] = '[Truncated]'; else out._truncated = true; break; }
                // Do not copy a sparse array's enormous index into the output array.
                if (native.isArray(out) && (!/^\d+$/.test(key) || Number(key) >= 24)) {
                    out[out.length] = '[Sparse index omitted]';
                    continue;
                }
                out[key] = 'value' in descriptors[key]
                    ? snapshot(descriptors[key].value, depth + 1, seen, budget) : '[Accessor]';
            }
            return out;
        } catch (_) { return '[Unavailable]'; }
    }

    function emit(scriptId, kind, data) {
        // A binding is installed only for a page being observed by the local MCP.
        if (busy) return;
        busy = true;
        try {
            const binding = native.descriptor(window, '__adbMcpEmit')?.value;
            if (typeof binding !== 'function') return;
            const timestamp = native.now();
            if (timestamp - windowStart > 1000) { windowStart = timestamp; windowCount = 0; }
            if (++windowCount > 100) { dropped++; return; }
            const event = { schemaVersion: 1, sequence: ++sequence, scriptId, kind, revision,
                timestamp, dropped, data: snapshot(data), stack: String(new native.Error().stack || '').slice(0, 8192) };
            let encoded = native.stringify(event);
            if (encoded.length > 60000) {
                event.data = { truncated: true, preview: native.stringify(event.data).slice(0, 16000) };
                encoded = native.stringify(event);
            }
            native.apply(binding, window, [encoded]);
            dropped = 0;
        } catch (_) { /* Observation must never change the intercepted call's result. */ }
        finally { busy = false; }
    }

    function post(message) {
        try { native.apply(native.post, window, [{ source: 'antidebug-runtime', ...message }, '*']); } catch (_) {}
    }
    function markInstalled(scriptId) {
        installed.add(scriptId);
        post({ type: 'ADB_HOOK_INSTALLED', scriptId });
        emit(scriptId, 'installed', {});
    }
    Object.defineProperty(window, '__ADB_OBSERVER__', {
        value: Object.freeze({ emit, installed: markInstalled, isInstalled: scriptId => installed.has(scriptId) }), configurable: false, writable: false
    });
    window.addEventListener('message', event => {
        if (event.source !== window || event.data?.source !== 'antidebug-extension') return;
        if (event.data.type === 'HOOK_CONFIG_READY') revision = event.data.revision ?? null;
        if (event.data.type === 'ADB_RUNTIME_STATUS_REQUEST') {
            post({ type: 'ADB_RUNTIME_STATUS', scriptIds: [...installed] });
        }
    });
})();
