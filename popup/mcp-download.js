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
        version.textContent = `适配扩展 ${currentVersion} · 含安装说明`;
        link.title = `前往 GitHub 发布页下载 · ${version.textContent}`;
    })().catch(() => {
        version.textContent = '';
        feedback.textContent = '无法读取配套包下载信息，请重新加载扩展后重试。';
        feedback.hidden = false;
    });
})();
