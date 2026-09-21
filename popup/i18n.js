(() => {
    'use strict';
    const I = globalThis.ADB_I18N;
    const bindings = new Map();
    const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);

    function apply(root = document) {
        const nodes = root.querySelectorAll('[data-i18n], [data-i18n-title], [data-i18n-placeholder], [data-i18n-aria-label]');
        for (const node of nodes) {
            if (node.dataset.i18n) {
                let params = [];
                try { params = JSON.parse(node.dataset.i18nParams || '[]'); } catch (_) {}
                node.textContent = I.t(node.dataset.i18n, params);
            }
            for (const attr of ['title', 'placeholder', 'aria-label']) {
                const key = node.getAttribute('data-i18n-' + attr);
                if (key) node.setAttribute(attr, I.t(key));
            }
        }
    }

    // Bind only product labels explicitly. No scanning/replacement of user data,
    // DOM observers, or element recreation is needed when the language changes.
    function bind(node, render, property = 'textContent') {
        if (!node) return;
        node.removeAttribute(property === 'textContent' ? 'data-i18n' : 'data-i18n-' + property);
        let entry = bindings.get(node);
        if (!entry) bindings.set(node, entry = new Map());
        entry.set(property, render);
        const value = render();
        if (property === 'aria-label') node.setAttribute(property, value);
        else node[property] = value;
        return value;
    }
    function text(node, value) {
        const descriptor = I.describe(value);
        if (descriptor) return bind(node, () => I.t(descriptor.messageKey, descriptor.messageParams));
        bindings.get(node)?.delete('textContent');
        node.removeAttribute('data-i18n');
        node.textContent = value;
        return value;
    }
    function raw(node, value, property = 'textContent') {
        bindings.get(node)?.delete(property);
        node.removeAttribute(property === 'textContent' ? 'data-i18n' : 'data-i18n-' + property);
        node[property] = value;
        return value;
    }
    function span(key, params = []) {
        return `<span data-i18n="${escape(key)}" data-i18n-params="${escape(JSON.stringify(params))}">${escape(I.t(key, params))}</span>`;
    }
    function catalogSpan(script, field) {
        const key = `catalog_${script.id}_${field}`;
        const value = I.t(key);
        return value === key ? escape(script[field] || '') : span(key);
    }
    function matchesScript(script, term, descriptions = false) {
        const keys = [`catalog_${script.id}_name`];
        if (descriptions) keys.push(`catalog_${script.id}_description`);
        const names = [script.id, script.name, ...keys.flatMap(key => [I.t(key, [], 'en'), I.t(key, [], 'zh_CN')])];
        if (descriptions) names.push(script.description);
        return names.some(value => String(value || '').toLowerCase().includes(term));
    }
    function update() {
        document.documentElement.lang = I.locale === 'zh_CN' ? 'zh-CN' : 'en';
        apply();
        for (const [node, entries] of bindings) {
            if (!node.isConnected) { bindings.delete(node); continue; }
            for (const [property, render] of entries) {
                const value = render();
                if (property === 'aria-label') node.setAttribute(property, value);
                else node[property] = value;
            }
        }
        const select = document.getElementById('language-select');
        if (select) select.value = I.preference;
        document.dispatchEvent(new CustomEvent('adb:languagechange', { detail: { locale: I.locale } }));
    }
    globalThis.ADB_UI = Object.freeze({ apply, bind, text, raw, span, catalogSpan, matchesScript, escape });
    I.onChange(update);
    const ready = I.init(chrome);
    document.addEventListener('DOMContentLoaded', async () => {
        await ready;
        update();
        const select = document.getElementById('language-select');
        const feedback = document.getElementById('language-feedback');
        select.addEventListener('change', async () => {
            const preference = select.value;
            select.disabled = true;
            feedback.hidden = true;
            try {
                await chrome.storage.local.set({ adb_language: preference });
                I.setLocale(preference);
            } catch (_) {
                select.value = I.preference;
                bind(feedback, () => I.t('ui_could_not_save_the_language_preference_please_retry'));
                feedback.hidden = false;
            } finally { select.disabled = false; }
        });
    });
})();
