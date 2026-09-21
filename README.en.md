# AntiDebug Breaker

[简体中文](README.md) · [English](README.en.md)

AntiDebug Breaker is a Chrome extension built on [Hook_JS](https://github.com/0xsdeo/Hook_JS) for JavaScript reverse engineering and browser debugging. It provides built-in anti-debugging scripts, configurable API Hooks, Vue/React route inspection, and an optional local MCP service with an Agent skill.

The current extension is **3.1.2**, paired with MCP **0.2.0**. The extension and the MCP + Skills bundle are separate downloads. You can use the extension's built-in scripts without installing MCP.

## Install the extension

Install from the existing [Chrome Web Store listing](https://chromewebstore.google.com/detail/antidebug-breaker/opkclndfcbafdaecbbaklefnaadopcln), or download the source, open `chrome://extensions/`, enable **Developer mode**, click **Load unpacked**, and select the directory containing `manifest.json`. The extension requires Chrome 120 or later; Firefox is not supported.

For the interface language, open the configuration button at the upper left of the popup and choose **Language → Follow browser, 简体中文, or English**. This setting controls the extension's own interface and supported script messages. Chrome's permission prompts, debugging banner, and extension management page use Chrome's language. User scripts, collected page data, URLs, and technical identifiers keep their original contents.

## Use the extension

The top navigation scrolls horizontally and contains **AntiDebug**, **Hook**, **Vue/React**, **Scripts**, and **MCP**.

| Area | What it provides |
| --- | --- |
| AntiDebug | Scripts for repeated `debugger` pauses, console interference, window closing, history navigation, window dimensions, and supported cryptographic library Hooks. |
| Hook | Observe supported browser APIs, filter captured values by keyword where available, print stacks, trigger breakpoints, or set a fixed return value. |
| Vue/React | Inspect routes recognized in the loaded application; copy paths/URLs or open routes. Vue also has separate navigation, guard, and Devtools scripts. |
| Scripts | View, edit, enable, disable, or delete persistent Agent-created scripts, including names, matching websites, and source code. |
| MCP | Pair the extension with the local MCP service, enable browser control, download the matching bundle, and copy task prompts. |

Choose the scripts needed for a page and reload it. Disabling a script also requires a reload to remove effects already installed in that page. In the configuration panel, **Standard mode** saves built-in script selections per hostname; **Global mode** applies its selection across websites. Hook parameters are shared by script ID. Agent library scripts use their own match rules and do not follow Standard/Global mode.

For fixed-value Hooks, press **Enter** to save the value. For supported keyword Hooks, press **Enter** to add each keyword. Filtering uses substring matches: a disabled filter, or an enabled filter with no keywords, captures all matching calls. `debugger` pauses execution and `stack` prints call stacks when a Hook is triggered.

## Built-in script guide

| Script or group | Intended use |
| --- | --- |
| `Bypass_Debugger` | Hook `eval`, `Function`, and `Function.prototype.constructor` to handle common repeated debugger patterns. Some sites depend on evaluation scope or use other checks, so site-specific work may still be needed. |
| `hook_log`, `hook_clear`, `hook_table` | Address console method replacement, console clearing, and supported timing checks involving console output. |
| `hook_close`, `hook_history`, `Fixed_window_size` | Address page closing, history navigation, and window-size checks. |
| `location_href` | Pause at supported navigation calls to help locate the responsible JavaScript. This is a debugging aid; enabling it does not remove all navigation code. |
| `Hook_CryptoJS`, `Hook_JSEncrypt`, `Hook_SMcrypto` | Inspect supported CryptoJS, JSEncrypt RSA, and SM-crypto calls and their arguments/results. No output may mean the site uses another library or has interfered with console output. |
| Cookie, XHR, fetch, storage, JSON, Promise Hooks | Observe supported API calls, including cookie writes, request setup, storage access, JSON operations, and Promise resolution. See each script's description for its available filters. |
| `Math.random`, `Date.now`, `performance.now` Hooks | Configure a fixed return value. |
| `Get_Vue_0`, `Get_React_0` | Collect routes currently loaded and recognized by the collectors; this is not a complete inventory of server endpoints or unloaded routes. |
| `Get_Vue_1` | Collect Vue routes and modify supported router navigation behavior. It is separate from read-only route collection. |
| `Clear_vue_Navigation_Guards` | Remove supported global `beforeEach` and `beforeResolve` guards. Applications may depend on these guards for loading or other behavior. |
| `detectorExec` | Enable Vue Devtools integration for supported Vue applications. A compatible Vue Devtools extension must be installed separately. |

The **Anti-Hook detection** option is experimental and may affect page behavior. If a script breaks the application, disable it and reload. The original [Chinese script walkthrough](README.md#脚本使用场景) includes source links and articles.

## Connect an Agent

In **MCP**, choose **Get MCP + Skills** and download `AntiDebug_Breaker-Agent-3.1.2.zip` from the matching release's **Assets**. Follow the [English installation guide](docs/agent-install.en.md), then use the [complete MCP reference](mcp/README.en.md).

The local MCP service requires Node.js 22 or later. It connects your selected Agent client to the paired extension and, after you enable browser control, to the existing Chrome tabs. Browser control is initially disabled. The default extension transport does not require a remote debugging port.

Install the complete `skills/antidebug-breaker-skills` directory once using your client's skill installation workflow. Its existing instructions and references are shared across languages; the English installation guide explains how to invoke it for anti-debugging analysis, cryptographic analysis, and route collection.

Debugging results are returned to the Agent client you choose. The local service uses a loopback connection to the extension; this does not determine whether your Agent client sends those results to a remote model provider. Pairing information and saved extension settings remain in their documented local storage locations. See the [MCP reference](mcp/README.en.md#data-and-lifecycle) for data and session behavior.

## Update and troubleshoot

Update store installations through the same store listing. For an unpacked installation, replace files in the existing directory, click **Reload** in `chrome://extensions/`, then reload open websites. Replacing files alone can leave an old background worker running. If Chrome disables the extension after an update, review the added permissions and re-enable it. Do not uninstall or clear extension storage for a routine upgrade, because that can remove saved settings.

Update the local MCP bundle and installed skill separately; a store update does not update them. Use the versions from the same release, run `npm ci` in the new `mcp` directory, and restart the MCP service in your client. The [installation guide](docs/agent-install.en.md#update-and-troubleshoot) covers pairing, ports, browser control, and user-script permissions.

## Learning, contributions, and credits

- [Anti-debugging video](https://www.bilibili.com/video/BV1gQ4mzMEA4), [Vue video](https://www.bilibili.com/video/BV12148z7EnP), [CryptoJS video](https://www.bilibili.com/video/BV1MPW1zDEK8), and [locating cryptographic calls](https://www.bilibili.com/video/BV1cRyXBaEJX) are in Chinese.
- [SpiderDemo practice site](https://www.spiderdemo.cn).
- [Submit a Hook script](https://github.com/0xsdeo/AntiDebug_Breaker/wiki/%E6%8F%90%E4%BA%A4%E6%82%A8%E8%87%AA%E5%B7%B1%E7%9A%84hook%E8%84%9A%E6%9C%AC) or [report an issue](https://github.com/0xsdeo/AntiDebug_Breaker/issues).
- Thanks to [魔法少女☆ホシノ](https://github.com/Hosinoharu), [CC11001100](https://github.com/CC11001100), [Dexter](https://github.com/mingheyan), [d1sbb](https://github.com/d1sbb), and [Yosan](https://github.com/lyousan). Referenced projects include [VueCrack](https://github.com/Ad1euDa1e/VueCrack), [FakeCryptoJS](https://github.com/keecth/FakeCryptoJS), and [vue-force-dev](https://github.com/hzmming/vue-force-dev).
- Sponsor information remains in the [Chinese README](README.md#赞助商). The project participates in [404StarLink](https://github.com/knownsec/404StarLink).

The project's stated use restriction prohibits unauthorized commercial use, including unauthorized commercial use of derivative versions. The original statement is in the [Chinese README](README.md#使用许可). For contact, use GitHub issues or the **Spade sec** WeChat public account; the maintainer's WeChat ID is `I-0xsdeo`.
