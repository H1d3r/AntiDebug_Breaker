(() => {
    'use strict';

    const dialog = document.getElementById('library-editor-dialog');
    const title = document.getElementById('library-editor-title');
    const meta = document.getElementById('library-editor-meta');
    const code = document.getElementById('library-editor-code');
    const feedback = document.getElementById('library-editor-feedback');
    const draftHint = document.getElementById('library-editor-draft');
    const save = document.getElementById('library-editor-save');
    const copy = document.getElementById('library-editor-copy');
    const copyFeedback = document.getElementById('library-editor-copy-feedback');
    const close = document.getElementById('library-editor-close');
    const reload = document.getElementById('library-editor-reload');
    const discard = document.getElementById('library-editor-discard');
    const discardConfirm = document.getElementById('library-editor-discard-confirm');
    const discardCancel = document.getElementById('library-editor-discard-cancel');
    const draftPrefix = 'adb_library_editor_draft:';
    const normalize = text => text.replace(/\r\n?/g, '\n');
    let current = null;
    let draftWrites = Promise.resolve();
    let draftSequence = 0;
    let copySequence = 0;
    let copyResetTimer;

    function dirty() { return current?.loaded && code.value !== current.baseCode; }
    function message(text, error = false) {
        feedback.textContent = text;
        feedback.classList.toggle('library-editor-error', error);
    }
    function resetCopyStatus() {
        copySequence++;
        clearTimeout(copyResetTimer);
        copyResetTimer = undefined;
        copy.textContent = '一键复制';
        copyFeedback.hidden = true;
    }
    function controls() {
        const busy = !current || current.busy;
        code.readOnly = busy || !current.loaded;
        save.disabled = busy || !dirty() || !discard.hidden;
        copy.disabled = busy || !current.loaded || !!current.copying;
        close.disabled = !!current?.saving;
        reload.disabled = busy;
        discardConfirm.disabled = busy;
        discardCancel.disabled = busy;
    }

    // Session storage survives the action popup closing. Drafts never enter the
    // registered library; ordered writes prevent an older input from winning.
    function writeDraft(state, draft) {
        const sequence = ++draftSequence;
        if (current === state) draftHint.textContent = draft ? '正在暂存草稿…' : '正在更新草稿状态…';
        draftWrites = draftWrites.then(async () => {
            const key = draftPrefix + state.id;
            // Preserve pending metadata from earlier combined-editor drafts
            // before replacing or clearing this source-only draft.
            await window.ADBLibraryCards?.migrateLegacyDraft(state.id);
            if (draft) await chrome.storage.session.set({ [key]: draft });
            else await chrome.storage.session.remove(key);
            state.draftReadFailed = false;
            if (current === state && sequence === draftSequence) {
                draftHint.textContent = draft ? '草稿已暂存，关闭面板后可继续编辑；点击保存才会更新脚本。'
                    : '未保存草稿仅在本次浏览器会话中暂存，不会注入网站。';
            }
        }).catch(() => {
            if (current === state && sequence === draftSequence) draftHint.textContent = '草稿暂存失败，请先保存或复制源码后再关闭面板。';
        });
        return draftWrites;
    }
    function rememberDraft() {
        if (!current?.loaded) return draftWrites;
        if (current.draftReadFailed && !dirty()) return draftWrites;
        return writeDraft(current, dirty() ? {
            revision: current.revision, baseCode: current.baseCode, code: code.value
        } : null);
    }

    async function load(state, restoreDraft) {
        state.busy = true;
        resetCopyStatus();
        controls();
        message('正在读取脚本…');
        try {
            await draftWrites;
            const result = await state.command('library.get', { id: state.id });
            if (current !== state) return;
            if (typeof result?.script?.code !== 'string' || typeof result.script.name !== 'string' ||
                !Array.isArray(result.script.matches) || !result.script.matches.every(item => typeof item === 'string') ||
                !Number.isSafeInteger(result.revision)) {
                throw new Error('后台返回的脚本不完整，请重新加载扩展后重试。');
            }
            let draft;
            if (restoreDraft) {
                try {
                    draft = (await chrome.storage.session.get(draftPrefix + state.id))[draftPrefix + state.id];
                    state.draftReadFailed = false;
                } catch (_) {
                    state.draftReadFailed = true;
                    draftHint.textContent = '无法读取暂存草稿，以下显示已保存源码；关闭不会删除原草稿。';
                }
                if (current !== state) return;
            }
            const script = result.script;
            state.baseCode = normalize(script.code);
            state.revision = result.revision;
            state.loaded = true;
            title.textContent = script.name;
            meta.textContent = script.enabled ? '已启用' : '已停用';
            meta.title = script.matches.join('\n');
            code.value = state.baseCode;
            discard.hidden = true;
            reload.textContent = '读取已保存版本';
            if (draft && typeof draft.code === 'string' && typeof draft.baseCode === 'string' &&
                Number.isSafeInteger(draft.revision) && draft.revision >= 0) {
                state.baseCode = draft.baseCode;
                state.revision = draft.revision;
                code.value = draft.code;
                const stale = draft.revision !== result.revision;
                message(stale ? '已恢复未保存草稿，但脚本库已有更新。请复制需保留的修改，再读取最新版本。'
                    : '已恢复未保存草稿。', stale);
                if (stale) reload.textContent = '读取最新版本';
            } else message('已读取脚本，可直接编辑。');
            // A failed reload must keep the old draft. Clear only after the new
            // source was successfully fetched and explicitly accepted.
            if (!restoreDraft) await writeDraft(state, null);
        } catch (error) {
            if (current !== state) return;
            message(error.code === 'SCRIPT_NOT_FOUND' ? '脚本已被删除；现有草稿仍保留，可复制源码。'
                : error.code === 'METHOD_NOT_FOUND' ? '请重新加载扩展后使用源码编辑功能。'
                : error.message || '源码读取失败，请重试。', true);
        } finally {
            if (current === state) { state.busy = false; controls(); }
        }
    }

    async function saveCode() {
        const state = current;
        if (!state || save.disabled) return;
        const source = code.value;
        if (!source.trim() || new TextEncoder().encode(source).length > 131072) {
            message('源码不能为空，且不得超过 128 KiB UTF-8。', true);
            return;
        }
        state.busy = state.saving = true;
        controls();
        message('正在保存…');
        try {
            const result = await state.command('library.update', { id: state.id, code: source, expectedRevision: state.revision });
            if (current !== state) return;
            if (result?.saved !== true || typeof result.script?.name !== 'string' ||
                !Array.isArray(result.script.matches) || !Number.isSafeInteger(result.revision)) {
                throw new Error('无法确认保存结果。草稿已保留，请读取已保存版本核对。');
            }
            state.baseCode = source;
            state.revision = result.revision;
            title.textContent = result.script.name;
            meta.textContent = result.script.enabled ? '已启用' : '已停用';
            meta.title = result.script.matches.join('\n');
            await writeDraft(state, null);
            if (result.registrationUpdated) {
                message(result.script.enabled ? '已保存。请刷新匹配网站以应用新源码。'
                    : '已保存，脚本保持停用。启用后在匹配页面下次加载时生效。');
            } else {
                const reason = result.script.registrationError?.message || result.status?.guidance || '请关闭编辑窗口，查看脚本库中的错误提示。';
                message(`修改已保存，但注册尚未同步。${reason}`, true);
            }
            state.onSaved();
        } catch (error) {
            if (current !== state) return;
            if (error.code === 'REVISION_CONFLICT') {
                message('脚本库已被更新，本次未覆盖。草稿已保留；请复制需保留的修改，再读取最新版本。', true);
                reload.textContent = '读取最新版本';
            } else message(error.code === 'SCRIPT_NOT_FOUND' ? '脚本已被删除，本次未保存。可复制保留源码。'
                : error.code === 'METHOD_NOT_FOUND' ? '请重新加载扩展后使用源码编辑功能。'
                : error.message || '保存失败，草稿已保留。', true);
        } finally {
            if (current === state) { state.busy = state.saving = false; controls(); }
        }
    }

    copy.addEventListener('click', async () => {
        const state = current;
        if (!state || copy.disabled) return;
        const source = code.value;
        resetCopyStatus();
        const sequence = copySequence;
        state.copying = true;
        controls();
        try {
            await navigator.clipboard.writeText(source);
            if (current === state && sequence === copySequence && code.value === source && !state.busy) {
                copy.textContent = '√ 已复制';
                copyResetTimer = setTimeout(() => {
                    if (current === state && sequence === copySequence) {
                        copy.textContent = '一键复制';
                        copyResetTimer = undefined;
                    }
                }, 2000);
            }
        } catch (_) {
            if (current === state && sequence === copySequence && code.value === source && !state.busy) {
                code.focus();
                code.select();
                copyFeedback.textContent = '复制失败，已选中源码，请手动复制。';
                copyFeedback.hidden = false;
            }
        } finally {
            if (current === state) { state.copying = false; controls(); }
        }
    });
    const onInput = () => {
        resetCopyStatus();
        discard.hidden = true;
        message(dirty() ? '有未保存的修改。' : '脚本未修改。');
        controls();
        rememberDraft();
    };
    code.addEventListener('input', onInput);
    dialog.addEventListener('keydown', event => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
            event.preventDefault();
            saveCode();
        }
    });
    save.addEventListener('click', saveCode);
    reload.addEventListener('click', () => {
        if (dirty()) { discard.hidden = false; controls(); discardCancel.focus(); }
        else if (current && !current.busy) load(current, false);
    });
    discardCancel.addEventListener('click', () => { discard.hidden = true; controls(); code.focus(); });
    discardConfirm.addEventListener('click', () => { if (current && !current.busy) load(current, false); });
    const closeEditor = async () => {
        if (current?.saving) return;
        const state = current;
        resetCopyStatus();
        await rememberDraft();
        if (current === state) { current = null; dialog.close(); }
    };
    close.addEventListener('click', closeEditor);
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeEditor(); });
    window.ADBLibraryEditor = {
        open(id, command, onSaved) {
            if (dialog.open) return;
            current = { id, command, onSaved, loaded: false, busy: false };
            title.textContent = '查看 / 编辑脚本';
            meta.textContent = '';
            meta.title = '';
            code.value = '';
            discard.hidden = true;
            draftHint.textContent = '未保存草稿仅在本次浏览器会话中暂存，不会注入网站。';
            dialog.showModal();
            load(current, true);
        }
    };
})();
