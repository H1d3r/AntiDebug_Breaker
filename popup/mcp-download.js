(() => {
    'use strict';
    const link = document.getElementById('mcp-download');
    const version = document.getElementById('mcp-download-version');
    const feedback = document.getElementById('mcp-download-feedback');
    if (!link || !version || !feedback) return;

    link.addEventListener('click', event => {
        if (link.getAttribute('aria-disabled') === 'true') event.preventDefault();
    });

    (async () => {
        const response = await fetch(chrome.runtime.getURL('agent-release.json'));
        if (!response.ok) throw new Error('Download information unavailable.');
        const release = await response.json();
        const currentVersion = chrome.runtime.getManifest().version;
        if (release.schemaVersion !== 1 || release.extensionVersion !== currentVersion ||
            !/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(release.repository) ||
            release.tag !== `v${currentVersion}` ||
            release.assetName !== `AntiDebug_Breaker-Agent-${currentVersion}.zip`) {
            throw new Error('Download information does not match the extension.');
        }
        link.href = `https://github.com/${release.repository}/releases/tag/${encodeURIComponent(release.tag)}`;
        link.removeAttribute('aria-disabled');
        link.removeAttribute('tabindex');
        ADB_UI.bind(version, () => ADB_I18N.t("ui_for_extension_0_includes_setup_guide", [currentVersion]), "textContent");
        ADB_UI.bind(link, () => ADB_I18N.t("ui_download_from_the_github_release_page_0", [version.textContent]), "title");
    })().catch(() => {
        ADB_UI.raw(version, '', "textContent");
        ADB_UI.bind(feedback, () => ADB_I18N.t("ui_could_not_load_bundle_download_information_reload_the_extension_a"), "textContent");
        feedback.hidden = false;
    });
})();
