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
        if (text !== undefined) ADB_UI.text(node, text);
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
        ADB_UI.text(state.view.feedback, text);
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
            feedback(state, ADB_I18N.t("ui_could_not_save_the_draft_copy_your_changes_before_closing_the_pop"), true);
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
            ? ADB_I18N.t("ui_this_draft_is_based_on_an_older_version_copy_your_changes_cancel_")
            : ADB_I18N.t("ui_save_to_apply_your_changes_cancel_discards_this_field_s_draft"), state.drafts[field].revision !== state.revision);
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
            feedback(state, ADB_I18N.t("ui_editing_canceled"));
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
            feedback(state, ADB_I18N.t("ui_enter_a_script_name_of_1_200_characters"), true);
            focusInput(state);
            return;
        }
        if (field === 'matches' && (!value.length || value.length > 20)) {
            feedback(state, ADB_I18N.t("ui_enter_1_20_website_match_patterns_one_per_line"), true);
            focusInput(state);
            return;
        }
        state.busy = true;
        controls(state);
        feedback(state, ADB_I18N.t("ui_saving"));
        try {
            const result = await state.options.command('library.update', {
                id: state.id, [field]: value, expectedRevision: draft.revision
            });
            if (result?.saved !== true || result.script?.id !== state.id || !Number.isSafeInteger(result.revision) ||
                typeof result.script.name !== 'string' || !Array.isArray(result.script.matches)) {
                throw new Error(ADB_I18N.t("ui_could_not_confirm_the_save_your_draft_is_retained_refresh_the_lis"));
            }
            state.script = result.script;
            state.revision = result.revision;
            state.drafts[field] = null;
            state.active = null;
            try { await persist(state, field, null); }
            catch (_) { state.options.showToast(ADB_I18N.t("ui_changes_saved_but_the_draft_could_not_be_cleared_check_it_when_re")); }
            const text = result.registrationUpdated
                ? field === 'name' ? ADB_I18N.t("ui_script_name_saved") : ADB_I18N.t("ui_match_patterns_saved_reload_matching_pages_to_apply")
                : ADB_I18N.t("ui_changes_saved_but_automatic_injection_is_not_synchronized_0", [ADB_I18N.translate(result.status?.guidance) || ADB_I18N.t("ui_check_the_error_shown_in_the_script_library")]);
            feedback(state, text, !result.registrationUpdated);
            state.options.showToast(text);
            state.options.onSaved();
        } catch (error) {
            feedback(state, error.code === 'REVISION_CONFLICT'
                ? ADB_I18N.t("ui_the_library_changed_so_nothing_was_overwritten_your_draft_is_reta")
                : error.code === 'SCRIPT_NOT_FOUND' ? ADB_I18N.t("ui_the_script_was_deleted_nothing_was_saved_copy_any_changes_you_nee")
                : ADB_I18N.error(error) || ADB_I18N.t("ui_save_failed_your_draft_is_retained"), true);
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
        feedback(state, ADB_I18N.t("ui_deleting"));
        try {
            const result = await state.options.command('library.delete', { id: state.id, expectedRevision: revision });
            if (result?.saved !== true || result.deletedId !== state.id) {
                throw new Error(ADB_I18N.t("ui_could_not_confirm_deletion_refresh_the_script_library_to_check"));
            }
            state.deleted = true;
            state.drafts = {};
            state.active = null;
            try {
                await storageTask(() => chrome.storage.session.remove([sourcePrefix + state.id, ...fields.map(field => key(state.id, field))]));
            } catch (_) { state.options.showToast(ADB_I18N.t("ui_script_deleted_but_its_saved_draft_could_not_be_cleared")); }
            const text = result.registrationUpdated ? ADB_I18N.t("ui_script_deleted_reload_open_pages_to_remove_its_effects")
                : ADB_I18N.t("ui_deleted_from_the_library_but_future_injection_may_not_have_stoppe", [ADB_I18N.translate(result.status?.guidance) || ADB_I18N.t("ui_reload_the_extension_to_synchronize_the_deletion")]);
            feedback(state, text, !result.registrationUpdated);
            state.options.showToast(text);
            state.options.onSaved();
        } catch (error) {
            const text = error.code === 'REVISION_CONFLICT' ? ADB_I18N.t("ui_the_library_changed_so_nothing_was_deleted_review_the_latest_vers")
                : error.code === 'SCRIPT_NOT_FOUND' ? ADB_I18N.t("ui_the_script_was_already_deleted_refresh_the_list")
                : ADB_I18N.error(error) || ADB_I18N.t("ui_deletion_failed_please_retry");
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
            ADB_UI.bind(input, () => field === 'name' ? ADB_I18N.t("ui_script_name") : ADB_I18N.t("ui_website_matches_one_pattern_per_line"), "aria-label");
            if (field === 'name') { input.type = 'text'; input.maxLength = 200; input.autocomplete = 'off'; }
            else {
                input.rows = Math.min(6, Math.max(1, input.value.split(/\r?\n/).length));
                input.spellcheck = false;
                input.placeholder = 'https://example.com/*';
            }
            input.addEventListener('input', () => {
                state.drafts[field].value = input.value;
                if (field === 'matches') input.rows = Math.min(6, Math.max(1, input.value.split(/\r?\n/).length));
                feedback(state, ADB_I18N.t("ui_unsaved_changes_select_save_to_apply_them"));
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
            view.save = button('library-quick-save', ADB_I18N.t("ui_save"), () => saveField(state));
            actions.append(view.save, button('library-quick-cancel', ADB_I18N.t("ui_cancel"), () => cancelField(state)));
            editor.append(input);
            if (field === 'matches') editor.append(element('p', '', ADB_I18N.t("ui_one_pattern_per_line_e_g_https_example_com_up_to_20_patterns_matc")));
            editor.append(actions);
            (field === 'name' ? view.nameGroup : view.matchGroup).append(editor);
            view.input = input;
        }
        if (state.confirmation && !state.deleted) {
            const confirmation = element('div', 'library-delete-confirmation');
            confirmation.append(element('p', 'library-delete-message',
                ADB_I18N.t("ui_delete_0_the_script_and_unsaved_drafts_will_be_permanently_remove", [state.confirmation.name])));
            const actions = element('div', 'library-quick-actions');
            view.cancelDelete = button('library-delete-cancel', ADB_I18N.t("ui_cancel"), () => {
                if (state.busy || externalBusy) return;
                state.confirmation = null;
                renderTransient(state);
                view.remove.focus();
            });
            actions.append(button('library-delete-confirm', ADB_I18N.t("ui_delete_script"), () => deleteScript(state)), view.cancelDelete);
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
            if (state.active) feedback(state, ADB_I18N.t("ui_unsaved_draft_restored_saving_will_check_for_changes_made_elsewhe"));
        } catch (_) { feedback(state, ADB_I18N.t("ui_could_not_read_the_draft_refresh_the_list_to_retry"), true); state.restoreFailed = true; }
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
        const remove = button('library-delete', ADB_I18N.t("ui_delete"), () => requestDelete(state));
        remove.dataset.scriptId = script.id;
        for (const [field, parent] of [['name', nameGroup], ['matches', matchHeading]]) {
            const edit = button(`library-${field}-edit library-pencil`, '✎', () => openField(state, field));
            edit.dataset.scriptId = script.id;
            ADB_UI.bind(edit, () => field === 'name' ? ADB_I18N.t("ui_edit_script_name") : ADB_I18N.t("ui_edit_website_matches"), "title");
            ADB_UI.bind(edit, () => edit.title, 'aria-label');
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
