(() => {
    'use strict';

    const prompts = {
        antidebug: {
            text: '请使用 antidebug-breaker-skills，结合 AntiDebug Breaker MCP，检测并绕过 {页面 URL} 的反调试。\n已知现象及触发操作：{例如打开开发者工具后不断暂停；不清楚可写“请主动检测”}。'
        },
        crypto: {
            text: '请使用 antidebug-breaker-skills，结合 AntiDebug Breaker MCP，逆向 {页面 URL} 中接口 {接口 URL} 的 {字段位置和名称，例如请求头 sign、请求体 data、响应体 data}。\n我的用途是：{参数计算／完整接口请求复现／响应解密／代理中查看和修改明文，可组合选择}。\n脚本交付形式：{纯本地 Python 脚本／双层 mitmproxy 脚本}。',
            note: '不知道接口或字段时，可描述具体业务操作（如“点击搜索后发出的搜索请求”），让 Agent 定位。未指定交付形式时，默认纯本地 Python 脚本。'
        },
        routes: {
            text: '请使用 antidebug-breaker-skills，结合 AntiDebug Breaker MCP，收集 {入口页面 URL} 所属应用的 Vue/React 隐藏动态路由，重点补充插件尚未捕获的部分。'
        }
    };

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
        feedback.textContent = '';
        copy.disabled = false;
    }

    function selectPrompt(key) {
        selected = key;
        const prompt = prompts[key];
        for (const button of options) {
            button.setAttribute('aria-pressed', String(button.dataset.mcpPrompt === key));
        }
        text.value = prompt.text;
        text.scrollTop = 0;
        note.textContent = prompt.note || '';
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
        feedback.textContent = '';
        try {
            await navigator.clipboard.writeText(text.value);
            if (pendingRevision === revision && dialog.open) feedback.textContent = '已复制';
        } catch (_) {
            if (pendingRevision === revision && dialog.open) {
                text.focus();
                text.select();
                feedback.textContent = '复制失败，已选中文本，请手动复制。';
            }
        } finally {
            if (pendingRevision === revision) copy.disabled = false;
        }
    });

    selectPrompt(selected);
})();
