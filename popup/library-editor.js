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
        ADB_UI.text(feedback, text);
        feedback.classList.toggle('library-editor-error', error);
    }
    function resetCopyStatus() {
        copySequence++;
        clearTimeout(copyResetTimer);
        copyResetTimer = undefined;
        ADB_UI.bind(copy, () => ADB_I18N.t("ui_copy_code"), "textContent");
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
        if (current === state) ADB_UI.bind(draftHint, () => draft ? ADB_I18N.t("ui_keeping_draft") : ADB_I18N.t("ui_updating_draft_status"), "textContent");
        draftWrites = draftWrites.then(async () => {
            const key = draftPrefix + state.id;
            // Preserve pending metadata from earlier combined-editor drafts
            // before replacing or clearing this source-only draft.
            await window.ADBLibraryCards?.migrateLegacyDraft(state.id);
            if (draft) await chrome.storage.session.set({ [key]: draft });
            else await chrome.storage.session.remove(key);
            state.draftReadFailed = false;
            if (current === state && sequence === draftSequence) {
                ADB_UI.bind(draftHint, () => draft ? ADB_I18N.t("ui_draft_retained_for_this_browser_session_you_can_reopen_the_popup_")
                    : ADB_I18N.t("ui_unsaved_drafts_are_kept_only_for_this_browser_session_and_are_nev"), "textContent");
            }
        }).catch(() => {
            if (current === state && sequence === draftSequence) ADB_UI.bind(draftHint, () => ADB_I18N.t("ui_could_not_keep_the_draft_save_or_copy_the_code_before_closing_the"), "textContent");
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
        message(ADB_I18N.t("ui_loading_script"));
        try {
            await draftWrites;
            const result = await state.command('library.get', { id: state.id });
            if (current !== state) return;
            if (typeof result?.script?.code !== 'string' || typeof result.script.name !== 'string' ||
                !Array.isArray(result.script.matches) || !result.script.matches.every(item => typeof item === 'string') ||
                !Number.isSafeInteger(result.revision)) {
                throw new Error(ADB_I18N.t("ui_the_background_returned_incomplete_script_data_reload_the_extensi"));
            }
            let draft;
            if (restoreDraft) {
                try {
                    draft = (await chrome.storage.session.get(draftPrefix + state.id))[draftPrefix + state.id];
                    state.draftReadFailed = false;
                } catch (_) {
                    state.draftReadFailed = true;
                    ADB_UI.bind(draftHint, () => ADB_I18N.t("ui_could_not_read_the_draft_saved_code_is_shown_below_closing_will_k"), "textContent");
                }
                if (current !== state) return;
            }
            const script = result.script;
            state.baseCode = normalize(script.code);
            state.revision = result.revision;
            state.loaded = true;
            ADB_UI.raw(title, script.name, "textContent");
            ADB_UI.bind(meta, () => script.enabled ? ADB_I18N.t("ui_enabled") : ADB_I18N.t("ui_disabled"), "textContent");
            ADB_UI.raw(meta, script.matches.join('\n'), "title");
            code.value = state.baseCode;
            discard.hidden = true;
            ADB_UI.bind(reload, () => ADB_I18N.t("ui_load_saved_version"), "textContent");
            if (draft && typeof draft.code === 'string' && typeof draft.baseCode === 'string' &&
                Number.isSafeInteger(draft.revision) && draft.revision >= 0) {
                state.baseCode = draft.baseCode;
                state.revision = draft.revision;
                code.value = draft.code;
                const stale = draft.revision !== result.revision;
                message(stale ? ADB_I18N.t("ui_draft_restored_but_the_library_has_changed_copy_any_changes_you_n")
                    : ADB_I18N.t("ui_unsaved_draft_restored"), stale);
                if (stale) ADB_UI.bind(reload, () => ADB_I18N.t("ui_load_latest_version"), "textContent");
            } else message(ADB_I18N.t("ui_script_loaded_and_ready_to_edit"));
            // A failed reload must keep the old draft. Clear only after the new
            // source was successfully fetched and explicitly accepted.
            if (!restoreDraft) await writeDraft(state, null);
        } catch (error) {
            if (current !== state) return;
            message(error.code === 'SCRIPT_NOT_FOUND' ? ADB_I18N.t("ui_the_script_was_deleted_your_draft_is_retained_you_can_copy_the_co")
                : error.code === 'METHOD_NOT_FOUND' ? ADB_I18N.t("ui_reload_the_extension_to_use_the_source_editor")
                : ADB_I18N.error(error) || ADB_I18N.t("ui_could_not_load_the_source_please_retry"), true);
        } finally {
            if (current === state) { state.busy = false; controls(); }
        }
    }

    async function saveCode() {
        const state = current;
        if (!state || save.disabled) return;
        const source = code.value;
        if (!source.trim() || new TextEncoder().encode(source).length > 131072) {
            message(ADB_I18N.t("ui_source_code_must_not_be_empty_or_exceed_128_kib_in_utf_8"), true);
            return;
        }
        state.busy = state.saving = true;
        controls();
        message(ADB_I18N.t("ui_saving"));
        try {
            const result = await state.command('library.update', { id: state.id, code: source, expectedRevision: state.revision });
            if (current !== state) return;
            if (result?.saved !== true || typeof result.script?.name !== 'string' ||
                !Array.isArray(result.script.matches) || !Number.isSafeInteger(result.revision)) {
                throw new Error(ADB_I18N.t("ui_could_not_confirm_the_save_your_draft_is_retained_load_the_saved_"));
            }
            state.baseCode = source;
            state.revision = result.revision;
            ADB_UI.raw(title, result.script.name, "textContent");
            ADB_UI.bind(meta, () => result.script.enabled ? ADB_I18N.t("ui_enabled") : ADB_I18N.t("ui_disabled"), "textContent");
            ADB_UI.raw(meta, result.script.matches.join('\n'), "title");
            await writeDraft(state, null);
            if (result.registrationUpdated) {
                message(result.script.enabled ? ADB_I18N.t("ui_saved_reload_matching_websites_to_apply_the_new_code")
                    : ADB_I18N.t("ui_saved_and_still_disabled_after_enabling_it_will_run_on_the_next_m"));
            } else {
                const reason = ADB_I18N.error(result.script.registrationError) || ADB_I18N.translate(result.status?.guidance) || ADB_I18N.t("ui_close_the_editor_and_check_the_error_in_the_script_library");
                message(ADB_I18N.t("ui_changes_saved_but_registration_is_not_synchronized_0", [reason]), true);
            }
            state.onSaved();
        } catch (error) {
            if (current !== state) return;
            if (error.code === 'REVISION_CONFLICT') {
                message(ADB_I18N.t("ui_the_library_changed_so_nothing_was_overwritten_your_draft_is_reta_2"), true);
                ADB_UI.bind(reload, () => ADB_I18N.t("ui_load_latest_version"), "textContent");
            } else message(error.code === 'SCRIPT_NOT_FOUND' ? ADB_I18N.t("ui_the_script_was_deleted_nothing_was_saved_you_can_copy_the_code_to")
                : error.code === 'METHOD_NOT_FOUND' ? ADB_I18N.t("ui_reload_the_extension_to_use_the_source_editor")
                : ADB_I18N.error(error) || ADB_I18N.t("ui_save_failed_your_draft_is_retained"), true);
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
                ADB_UI.bind(copy, () => ADB_I18N.t("ui_copied"), "textContent");
                copyResetTimer = setTimeout(() => {
                    if (current === state && sequence === copySequence) {
                        ADB_UI.bind(copy, () => ADB_I18N.t("ui_copy_code"), "textContent");
                        copyResetTimer = undefined;
                    }
                }, 2000);
            }
        } catch (_) {
            if (current === state && sequence === copySequence && code.value === source && !state.busy) {
                code.focus();
                code.select();
                ADB_UI.bind(copyFeedback, () => ADB_I18N.t("ui_copy_failed_the_code_is_selected_please_copy_it_manually"), "textContent");
                copyFeedback.hidden = false;
            }
        } finally {
            if (current === state) { state.copying = false; controls(); }
        }
    });
    const onInput = () => {
        resetCopyStatus();
        discard.hidden = true;
        message(dirty() ? ADB_I18N.t("ui_you_have_unsaved_changes") : ADB_I18N.t("ui_no_changes_to_the_script"));
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
            ADB_UI.bind(title, () => ADB_I18N.t("ui_view_edit_script"), "textContent");
            ADB_UI.raw(meta, '', "textContent");
            ADB_UI.raw(meta, '', "title");
            code.value = '';
            discard.hidden = true;
            ADB_UI.bind(draftHint, () => ADB_I18N.t("ui_unsaved_drafts_are_kept_only_for_this_browser_session_and_are_nev"), "textContent");
            dialog.showModal();
            load(current, true);
        }
    };
})();
