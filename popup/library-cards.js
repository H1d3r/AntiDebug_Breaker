(() => {
    'use strict';

    const states = new Map();
    const fields = ['name', 'matches'];
    const prefix = 'adb_library_card_draft:';
    const sourcePrefix = 'adb_library_editor_draft:';
    let externalBusy = false;
    let storageWrites = Promise.resolve();
    const key = (id, field) => `${prefix}${id}:${field}`;
    const valueOf = (script, field) => field === 'name' ? script.name : script.matches.join('\n');
    const validDraft = value => value && typeof value.baseValue === 'string' && typeof value.value === 'string' &&
        Number.isSafeInteger(value.revision) && value.revision >= 0;

    function storageTask(callback) {
        const operation = storageWrites.then(callback);
        storageWrites = operation.catch(() => {});
        return operation;
    }

    // Keep metadata drafts separate from source drafts. A cleared marker prevents
    // stale metadata in an old source draft from being restored a second time.
    function migrateLegacyDraft(id) {
        return storageTask(async () => {
            const keys = [sourcePrefix + id, ...fields.map(field => key(id, field))];
            const saved = await chrome.storage.session.get(keys);
            const legacy = saved[sourcePrefix + id];
            if (!legacy || !Number.isSafeInteger(legacy.revision) || legacy.revision < 0) return;
            const updates = {};
            for (const field of fields) {
                const baseValue = legacy[field === 'name' ? 'baseName' : 'baseMatches'];
                const value = legacy[field];
                if (saved[key(id, field)] === undefined && typeof baseValue === 'string' &&
                    typeof value === 'string' && value !== baseValue) {
                    updates[key(id, field)] = { revision: legacy.revision, baseValue, value };
                }
            }
            if (Object.keys(updates).length) await chrome.storage.session.set(updates);
        });
    }

    function element(tag, className, text) {
        const node = document.createElement(tag);
        node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }
    function button(className, label, handler) {
        const node = element('button', className, label);
        node.type = 'button';
        node.addEventListener('click', handler);
        return node;
    }
    function feedback(state, text, error = false) {
        state.feedback = { text, error };
        if (!state.view) return;
        state.view.feedback.textContent = text;
        state.view.feedback.hidden = !text;
        state.view.feedback.classList.toggle('library-card-error', error);
    }
    function controls(state) {
        if (!state.view) return;
        const busy = externalBusy || state.busy || state.loading || state.restoreFailed || state.deleted;
        for (const control of state.view.card.querySelectorAll('button, input, textarea')) control.disabled = !!busy;
        if (state.view.save) {
            const draft = state.drafts[state.active];
            state.view.save.disabled = !!busy || !!state.confirmation || !draft || draft.value === draft.baseValue;
        }
    }
    function persist(state, field, draft) {
        const value = draft ? { ...draft } : { cleared: true };
        return storageTask(() => chrome.storage.session.set({ [key(state.id, field)]: value })).catch(error => {
            feedback(state, '草稿暂存失败，请先复制修改内容，再关闭面板。', true);
            throw error;
        });
    }
    function focusInput(state, selection) {
        const input = state.view?.input;
        if (!input) return;
        queueMicrotask(() => {
            if (state.view?.input !== input || state.deleted) return;
            input.focus();
            if (selection) input.setSelectionRange(selection[0], selection[1]);
        });
    }
    function openField(state, field) {
        if (externalBusy || state.busy || state.loading || state.restoreFailed || state.deleted) return;
        state.confirmation = null;
        state.active = field;
        if (!state.drafts[field]) {
            const value = valueOf(state.script, field);
            state.drafts[field] = { revision: state.revision, baseValue: value, value };
        }
        feedback(state, state.drafts[field].revision !== state.revision
            ? '草稿保留了旧版本。请复制需要的修改后取消编辑，再重新打开以编辑最新版本。'
            : '修改后点击保存；取消将丢弃此项草稿。', state.drafts[field].revision !== state.revision);
        renderTransient(state);
        focusInput(state);
    }
    async function cancelField(state) {
        if (externalBusy || state.busy || state.loading || state.restoreFailed || !state.active) return;
        const field = state.active;
        state.busy = true;
        controls(state);
        try {
            await persist(state, field, null);
            state.drafts[field] = null;
            state.active = null;
            feedback(state, '已取消本次编辑。');
        } catch (_) { /* Preserve the input if its persisted draft could not be cleared. */ }
        finally { state.busy = false; renderTransient(state); }
    }
    async function saveField(state) {
        if (externalBusy || state.busy || state.loading || state.restoreFailed || state.confirmation || !state.active) return;
        const field = state.active;
        const draft = state.drafts[field];
        if (!draft || draft.value === draft.baseValue) return;
        const value = field === 'name' ? draft.value.trim()
            : draft.value.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
        if (field === 'name' && (!value || value.length > 200)) {
            feedback(state, '脚本名称不能为空，且不得超过 200 个字符。', true);
            focusInput(state);
            return;
        }
        if (field === 'matches' && (!value.length || value.length > 20)) {
            feedback(state, '请填写 1–20 个匹配网站规则，每行一个。', true);
            focusInput(state);
            return;
        }
        state.busy = true;
        controls(state);
        feedback(state, '正在保存…');
        try {
            const result = await state.options.command('library.update', {
                id: state.id, [field]: value, expectedRevision: draft.revision
            });
            if (result?.saved !== true || result.script?.id !== state.id || !Number.isSafeInteger(result.revision) ||
                typeof result.script.name !== 'string' || !Array.isArray(result.script.matches)) {
                throw new Error('无法确认保存结果，草稿已保留。请刷新列表核对。');
            }
            state.script = result.script;
            state.revision = result.revision;
            state.drafts[field] = null;
            state.active = null;
            try { await persist(state, field, null); }
            catch (_) { state.options.showToast('修改已保存，但暂存草稿未清除，重新打开时请核对。'); }
            const text = result.registrationUpdated
                ? field === 'name' ? '脚本名称已保存。' : '匹配网站已保存，刷新相关网页后生效。'
                : `修改已保存，但自动注入尚未同步。${result.status?.guidance || '请查看脚本库中的错误提示。'}`;
            feedback(state, text, !result.registrationUpdated);
            state.options.showToast(text);
            state.options.onSaved();
        } catch (error) {
            feedback(state, error.code === 'REVISION_CONFLICT'
                ? '脚本库已被更新，本次未覆盖。草稿已保留；请复制修改后取消编辑，再重新打开。'
                : error.code === 'SCRIPT_NOT_FOUND' ? '脚本已被删除，本次未保存。请复制需保留的修改。'
                : error.message || '保存失败，草稿已保留。', true);
            if (error.code === 'REVISION_CONFLICT') state.options.onSaved();
        } finally { state.busy = false; renderTransient(state); }
    }
    function requestDelete(state) {
        if (externalBusy || state.busy || state.loading || state.restoreFailed || state.deleted) return;
        state.confirmation = { revision: state.revision, name: state.script.name };
        renderTransient(state);
        state.view.cancelDelete?.focus();
    }
    async function deleteScript(state) {
        if (externalBusy || state.busy || state.loading || !state.confirmation || state.deleted) return;
        const revision = state.confirmation.revision;
        state.busy = true;
        controls(state);
        feedback(state, '正在删除…');
        try {
            const result = await state.options.command('library.delete', { id: state.id, expectedRevision: revision });
            if (result?.saved !== true || result.deletedId !== state.id) {
                throw new Error('无法确认删除结果，请刷新脚本库检查。');
            }
            state.deleted = true;
            state.drafts = {};
            state.active = null;
            try {
                await storageTask(() => chrome.storage.session.remove([sourcePrefix + state.id, ...fields.map(field => key(state.id, field))]));
            } catch (_) { state.options.showToast('脚本已删除，但暂存草稿未清除。'); }
            const text = result.registrationUpdated ? '已删除脚本。已打开页面中的效果需刷新后清除。'
                : `已从脚本库删除，但尚未确认停止后续注入。${result.status?.guidance || '请重新加载扩展以同步删除结果。'}`;
            feedback(state, text, !result.registrationUpdated);
            state.options.showToast(text);
            state.options.onSaved();
        } catch (error) {
            const text = error.code === 'REVISION_CONFLICT' ? '脚本库已被更新，本次未删除。请查看最新内容后重新确认。'
                : error.code === 'SCRIPT_NOT_FOUND' ? '脚本已被其他操作删除，请刷新列表。'
                : error.message || '删除失败，请重试。';
            feedback(state, text, true);
            state.options.showToast(text);
            if (error.code === 'REVISION_CONFLICT') state.options.onSaved();
        } finally { state.confirmation = null; state.busy = false; renderTransient(state); }
    }

    function renderTransient(state) {
        const view = state.view;
        if (!view) return;
        for (const node of view.card.querySelectorAll('.library-quick-editor, .library-delete-confirmation')) node.remove();
        view.input = view.save = view.cancelDelete = null;
        const editing = state.active && state.drafts[state.active] && !state.deleted ? state.active : null;
        view.nameGroup.querySelector('.library-script-name').hidden = editing === 'name';
        view.nameGroup.querySelector('.library-name-edit').hidden = editing === 'name';
        view.matchGroup.querySelector('.library-matches').hidden = editing === 'matches';
        view.matchGroup.querySelector('.library-matches-edit').hidden = editing === 'matches';
        if (editing) {
            const field = state.active;
            const editor = element('div', 'library-quick-editor');
            editor.dataset.field = field;
            const input = element(field === 'name' ? 'input' : 'textarea', `library-${field}-input`);
            input.value = state.drafts[field].value;
            input.setAttribute('aria-label', field === 'name' ? '脚本名称' : '匹配网站，每行一个规则');
            if (field === 'name') { input.type = 'text'; input.maxLength = 200; input.autocomplete = 'off'; }
            else {
                input.rows = Math.min(6, Math.max(1, input.value.split(/\r?\n/).length));
                input.spellcheck = false;
                input.placeholder = 'https://example.com/*';
            }
            input.addEventListener('input', () => {
                state.drafts[field].value = input.value;
                if (field === 'matches') input.rows = Math.min(6, Math.max(1, input.value.split(/\r?\n/).length));
                feedback(state, '有未保存的修改，点击保存后生效。');
                controls(state);
                persist(state, field, state.drafts[field]).catch(() => {});
            });
            input.addEventListener('keydown', event => {
                if (event.key === 'Escape') { event.preventDefault(); cancelField(state); }
                if (event.key === 'Enter' && (field === 'name' || event.ctrlKey || event.metaKey)) {
                    event.preventDefault(); saveField(state);
                }
            });
            const actions = element('div', 'library-quick-actions');
            view.save = button('library-quick-save', '保存', () => saveField(state));
            actions.append(view.save, button('library-quick-cancel', '取消', () => cancelField(state)));
            editor.append(input);
            if (field === 'matches') editor.append(element('p', '', '每行一个规则，例如 https://example.com/*，最多 20 个；不支持全站匹配。'));
            editor.append(actions);
            (field === 'name' ? view.nameGroup : view.matchGroup).append(editor);
            view.input = input;
        }
        if (state.confirmation && !state.deleted) {
            const confirmation = element('div', 'library-delete-confirmation');
            confirmation.append(element('p', 'library-delete-message',
                `确定删除“${state.confirmation.name}”？脚本和未保存草稿将移除，无法撤销；已打开页面的效果需刷新后清除。`));
            const actions = element('div', 'library-quick-actions');
            view.cancelDelete = button('library-delete-cancel', '取消', () => {
                if (state.busy || externalBusy) return;
                state.confirmation = null;
                renderTransient(state);
                view.remove.focus();
            });
            actions.append(button('library-delete-confirm', '确认删除', () => deleteScript(state)), view.cancelDelete);
            confirmation.append(actions);
            view.card.append(confirmation);
        }
        feedback(state, state.feedback?.text || '', !!state.feedback?.error);
        controls(state);
    }

    async function restore(state) {
        try {
            await migrateLegacyDraft(state.id);
            const saved = await chrome.storage.session.get(fields.map(field => key(state.id, field)));
            for (const field of fields) {
                const draft = saved[key(state.id, field)];
                if (validDraft(draft) && draft.value !== draft.baseValue) state.drafts[field] = { ...draft };
            }
            state.active = fields.find(field => state.drafts[field]) || null;
            if (state.active) feedback(state, '已恢复未保存草稿。保存时会检查脚本库是否被其他操作更新。');
        } catch (_) { feedback(state, '无法读取暂存草稿，请刷新列表重试。', true); state.restoreFailed = true; }
        finally { state.loading = false; renderTransient(state); }
    }
    function mount(card, script, revision, options) {
        let state = states.get(script.id);
        if (!state || state.deleted) {
            state = { id: script.id, drafts: {}, active: null, loading: true, busy: false };
            states.set(script.id, state);
        }
        const previousInput = state.view?.input;
        const focused = previousInput && document.activeElement === previousInput;
        const selection = focused ? [previousInput.selectionStart, previousInput.selectionEnd] : null;
        state.script = script;
        state.revision = revision;
        state.options = options;
        const nameGroup = card.querySelector('.library-name-group');
        const matchGroup = card.querySelector('.library-match-group');
        const matchHeading = card.querySelector('.library-match-heading');
        const actions = card.querySelector('.library-card-actions');
        const remove = button('library-delete', '删除', () => requestDelete(state));
        remove.dataset.scriptId = script.id;
        for (const [field, parent] of [['name', nameGroup], ['matches', matchHeading]]) {
            const edit = button(`library-${field}-edit library-pencil`, '✎', () => openField(state, field));
            edit.dataset.scriptId = script.id;
            edit.title = field === 'name' ? '修改脚本名称' : '修改匹配网站';
            edit.setAttribute('aria-label', edit.title);
            parent.append(edit);
        }
        actions.append(remove);
        card.dataset.scriptId = script.id;
        const message = element('p', 'library-card-feedback');
        message.setAttribute('role', 'status');
        card.append(message);
        state.view = { card, nameGroup, matchGroup, remove, feedback: message };
        renderTransient(state);
        if (focused) focusInput(state, selection);
        if (!state.restoring || state.restoreFailed) {
            state.restoring = true;
            state.restoreFailed = false;
            state.loading = true;
            controls(state);
            restore(state);
        }
    }
    window.ADBLibraryCards = {
        mount,
        migrateLegacyDraft,
        setBusy(busy) { externalBusy = !!busy; for (const state of states.values()) controls(state); }
    };
})();
