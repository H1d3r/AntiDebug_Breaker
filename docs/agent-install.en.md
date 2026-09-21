# Install AntiDebug Breaker MCP + Skills

[简体中文](agent-install.md) · [English](agent-install.en.md)

This bundle pairs extension **3.1.2** with the local MCP service **0.2.0** and the existing `antidebug-breaker-skills` directory. Install or update the matching Chrome extension first. If you installed it from the Chrome Web Store, keep using that installation; the Agent bundle does not contain another extension.

## 1. Download and extract

Open the extension's **MCP** tab and click **Get MCP + Skills**. It opens the [release for extension 3.1.2](https://github.com/0xsdeo/AntiDebug_Breaker/releases/tag/v3.1.2). Under **Assets**, download `AntiDebug_Breaker-Agent-3.1.2.zip` and extract it into a directory you intend to keep. The button selects the release matching the extension, rather than automatically choosing a newer version.

```text
AntiDebug_Breaker-Agent-3.1.2/
├── README.md
├── 安装说明.md
├── INSTALL.en.md
├── bundle-manifest.json
├── mcp/
│   ├── src/
│   ├── package.json
│   ├── package-lock.json
│   ├── README.md
│   └── README.en.md
└── skills/
    └── antidebug-breaker-skills/
        ├── SKILL.md
        ├── references/
        └── agents/
```

`bundle-manifest.json` records component versions and file checksums. The bundle does not include Node.js, installed npm dependencies, Chrome, the Chrome extension, or personal pairing credentials.

To change the extension's language, open the upper-left configuration panel and choose **Language → Follow browser, 简体中文, or English**. Chrome's own prompts and settings follow the browser language.

## 2. Install dependencies and create pairing information

Use **Node.js 22 or later** with npm, and **Chrome 120 or later**. Open a terminal in the extracted `mcp` directory and run:

```powershell
node --version
npm ci
npm run setup
```

The first dependency installation needs network access. `setup` creates the pairing file at `.antidebug-breaker/mcp.json` in your user home directory and prints its absolute path, the local connection URL, and the pairing token. It reuses an existing file; running it again shows the same pairing information. The default URL is `ws://127.0.0.1:19876/extension`; use the actual value printed by setup.

For a custom configuration file, run `npm run setup -- --config "C:/Tools/adb-settings/mcp.json"` and use that same absolute configuration path in your MCP client's launch arguments. Keep the pairing file private and outside downloaded source or release directories.

## 3. Let your Agent client start MCP

Add a **stdio** MCP service in your client. Clients accepting an `mcpServers` object can use this example:

```json
{
  "mcpServers": {
    "antidebug-breaker": {
      "command": "node",
      "args": [
        "C:/Tools/AntiDebug_Breaker-Agent-3.1.2/mcp/src/index.js"
      ]
    }
  }
}
```

Replace the entry with the **absolute path** to your extracted `mcp/src/index.js`. On Windows, `/` avoids backslash escaping in JSON. If the client cannot find `node`, use the absolute executable path for `command`, such as `C:/Program Files/nodejs/node.exe`. Configuration screens and outer formats vary by client; the launch command is the same.

If you selected a custom pairing file in step 2, append `"--config"` and its absolute path to `args`. Start or restart this MCP service in your client. **Do not also leave `npm start` running in a terminal**: a second process can occupy the same port. Manual `npm start` is useful only for a separate startup check; stop it before the client starts its process.

## 4. Pair the extension and enable control

Open the extension popup and scroll the top tab bar to **MCP**.

1. Enter the connection URL and full pairing token printed by setup.
2. Click **Enable MCP and allow browser control**.
3. Wait for the connected status.

The extension saves the pairing information and enabled state locally, including across normal restarts. **Save connection settings** updates the address/token while enabled. **Stop MCP** disables the MCP connection and browser control while retaining pairing information. You must explicitly enable it again to resume.

Chrome grants the extension's declared `debugger` permission during extension installation or update. If Chrome disables the extension after an update, review the added permission and re-enable it in `chrome://extensions/`. The popup's control setting is separate: the Agent cannot turn it on itself. Cancelling Chrome's debugging banner disables browser control and ends extension debugging sessions while leaving MCP enabled. Click **Re-enable browser control** in the extension to allow control again. Stopping MCP does not revoke the extension's declared Chrome permission.

For persistent Agent-created scripts, open `chrome://extensions/` → **AntiDebug Breaker** → **Details** and enable **Allow user scripts** on Chrome 138 or later. On Chrome 120–137, enable **Developer mode** on the extensions page. This is normally a one-time user action. Without it, library scripts can still be read and saved, but automatic injection is unavailable; the other built-in script and debugging tools remain available.

Library scripts run as ordinary JavaScript in the page's main world, on matching HTTP(S) top-level documents at `document_start`. They do not provide Tampermonkey APIs such as `GM_*` or `@require`. Name, website rules, and source can also be edited in the **Scripts** tab, which supports enabling, disabling, and deleting existing scripts. Changes apply on the next matching page load.

**Stopping MCP or closing your Agent does not disable enabled library scripts.** They remain saved in the extension and run in matching new documents. Disable or delete a script through **Scripts** or `adb_script_library`, then reload already-open pages to remove its existing effects. Turning off Chrome's user-script permission also prevents future injection; it does not undo code already run in an open page.

## 5. Install and use the skill

Use your Agent client's skill installation workflow to install the **entire** `skills/antidebug-breaker-skills` directory. Keep `SKILL.md`, `references`, and `agents` together. Do not copy only the Markdown entry file. Reload skills as required by your client. There is one shared skill package; no separate English copy is needed.

The skill guides the Agent through evidence collection, built-in script selection, Hook configuration, route inspection, and JavaScript/cryptographic analysis using this MCP. It also describes delivery workflows for local Python scripts and, where appropriate to the task, mitmproxy scripts. Installing the skill does not start MCP or prove that it is connected.

Start with:

> Use antidebug-breaker-skills with AntiDebug Breaker MCP. Call adb_capabilities to check the connection, then adb_list_pages to list the tabs. Explain the results in English.

Confirm skill loading in your client's skill list or loading history. `adb_capabilities` checks MCP/extension capabilities. For browser interaction or debugging, have the Agent call `adb_connect_browser` with `{}` to use the default paired extension transport. No remote debugging port is needed for that transport.

Example tasks, with placeholders replaced:

> Use antidebug-breaker-skills with AntiDebug Breaker MCP to investigate and bypass the anti-debugging behavior at {page URL}. The observed behavior and reproduction steps are {details}. Respond in English.

> Use antidebug-breaker-skills with AntiDebug Breaker MCP to analyze {field name and location} in requests to {API URL}, triggered by {page operation}. I need {parameter calculation, a complete request reproduction, response decryption, or inspecting/editing plaintext through a proxy}. Deliver {a standalone local Python script or the two-layer mitmproxy form}.

> Use antidebug-breaker-skills with AntiDebug Breaker MCP to collect Vue/React routes in the application at {entry URL}, focusing on routes the extension has not yet captured. State which routes are confirmed and which are inferred.

The extension's **MCP → Prompts** dialog provides editable-by-copy task templates in the selected interface language. Log in to the target site in Chrome first when needed, and describe any relevant role, reproduction steps, or scope. Do not include your MCP pairing token in prompts.

For library scripts, inspect `adb_capabilities.extension.scriptLibrary`. Saved or registered does not prove that a script ran successfully; verify its expected behavior in a new matching document. Library writes for the next navigation do not need an attached debugger; asking the tool to reload immediately does require a browser connection. See the [MCP reference](../mcp/README.en.md) for the complete tool list and examples.

## Data and connection behavior

The Node service connects the chosen Agent client over stdio to the paired extension over a loopback WebSocket. Debugging results can include page content, script source, requests/responses, and captured values, depending on the tools used. These results are returned to your Agent client; that client's model provider and data settings govern its subsequent handling. A local bridge does not imply that the Agent client processes everything locally.

Pairing configuration is saved in the local user configuration file; the extension stores its pairing information and script/settings data locally. The token is not injected into target pages. Runtime event/network/source caches are bounded, and observations generally start after attachment. The [MCP reference](../mcp/README.en.md) describes truncation, pending operations, and session cleanup.

## Update and troubleshoot

| Situation | Action |
| --- | --- |
| Updating the Agent bundle | Stop the old MCP service in the client, use the bundle matching the extension release, run `npm ci` in its `mcp` directory, and restart. Update the client entry path if the directory moved, and replace the complete installed skill directory. The default pairing file lives outside the bundle and is reused. |
| Updating the extension | Update store installations through the same store listing. For unpacked installations, replace the files and click **Reload** in `chrome://extensions/`, then reload open sites. Replacing files or restarting Chrome alone may leave an older worker active. Preserve existing storage; uninstalling is not required for a routine update. |
| Extension cannot read its state after an update | Reload the extension in `chrome://extensions/`, reopen the popup, and reload the website. Do not interpret an unread state as all scripts being disabled. |
| Waiting for MCP / connection failure | Start the service in the client; verify the URL, token, and configuration path match setup. Only one service may listen on the chosen port. |
| `PORT_IN_USE` | Stop a duplicate MCP process or a manually started `npm start`. If you change the configured port, also change the extension URL. |
| Browser control disabled / debugging cancelled | Use **Re-enable browser control**; if MCP is stopped, use the combined enable button. Then reconnect and check the target. The Agent cannot enable control on its own. |
| Script library cannot inject | Check **Allow user scripts** (Chrome 138+) or **Developer mode** (120–137), then refresh **Scripts** or query the library to retry registration. Inspect `status.available`, the returned guidance, and registration results before reloading a target. |
| Missing `adb_script_library` or newer tools | Update and restart the local MCP service as well as the extension. A store extension update does not update your Node service or skill. Use extension 3.1.2 and MCP 0.2.0 from the same release. |
| Cookie clearing reports unsupported isolation | This tool requires a confirmed Chrome version of at least 138. Update Chrome and, for extension transport, reload the matching extension and restart MCP. |
| Route results are empty or time out | Enable the corresponding collector, reload the target, let the application load, then rescan. The collectors only report loaded routes they recognize. |
| Release or asset is missing | The maintainer must publish the matching release and upload its asset. Local packaging does not upload it. Check the exact release version or use the maintainer's matching bundle. |

For the full command reference and runtime limits, read the [English MCP reference](../mcp/README.en.md). Its development/test/packaging commands require the complete source repository; the user bundle does not include tests or packaging tools.
