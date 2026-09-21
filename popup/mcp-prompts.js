(() => {
    'use strict';

    const getPrompts = () => ({
        antidebug: {
            text: ADB_I18N.t("ui_use_antidebug_breaker_skills_with_antidebug_breaker_mcp_to_identi")
        },
        crypto: {
            text: ADB_I18N.t("ui_use_antidebug_breaker_skills_with_antidebug_breaker_mcp_to_revers"),
            note: ADB_I18N.t("ui_if_the_api_or_field_is_unknown_describe_the_action_such_as_the_re")
        },
        routes: {
            text: ADB_I18N.t("ui_use_antidebug_breaker_skills_with_antidebug_breaker_mcp_to_collec")
        }
    });

    const dialog = document.getElementById('mcp-prompts-dialog');
    const open = document.getElementById('mcp-prompts-open');
    const close = document.getElementById('mcp-prompts-close');
    const options = [...dialog.querySelectorAll('[data-mcp-prompt]')];
    const text = document.getElementById('mcp-prompt-text');
    const note = document.getElementById('mcp-prompt-note');
    const copy = document.getElementById('mcp-prompt-copy');
    const feedback = document.getElementById('mcp-prompt-feedback');
    let selected = 'antidebug', revision = 0;

    function resetCopy() {
        ++revision;
        ADB_UI.raw(feedback, '', "textContent");
        copy.disabled = false;
    }

    function selectPrompt(key) {
        selected = key;
        const prompt = getPrompts()[key];
        for (const button of options) {
            button.setAttribute('aria-pressed', String(button.dataset.mcpPrompt === key));
        }
        text.value = prompt.text;
        text.scrollTop = 0;
        ADB_UI.raw(note, prompt.note || '', "textContent");
        note.hidden = !prompt.note;
        resetCopy();
    }

    open.addEventListener('click', () => {
        selectPrompt(selected);
        if (!dialog.open) dialog.showModal();
        options.find(button => button.dataset.mcpPrompt === selected).focus();
    });
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', resetCopy);
    for (const button of options) {
        button.addEventListener('click', () => selectPrompt(button.dataset.mcpPrompt));
    }
    copy.addEventListener('click', async () => {
        const pendingRevision = revision;
        copy.disabled = true;
        ADB_UI.raw(feedback, '', "textContent");
        try {
            await navigator.clipboard.writeText(text.value);
            if (pendingRevision === revision && dialog.open) ADB_UI.bind(feedback, () => ADB_I18N.t("ui_copied_2"), "textContent");
        } catch (_) {
            if (pendingRevision === revision && dialog.open) {
                text.focus();
                text.select();
                ADB_UI.bind(feedback, () => ADB_I18N.t("ui_copy_failed_the_text_is_selected_please_copy_it_manually"), "textContent");
            }
        } finally {
            if (pendingRevision === revision) copy.disabled = false;
        }
    });

    document.addEventListener('adb:languagechange', () => selectPrompt(selected));
    selectPrompt(selected);
})();
