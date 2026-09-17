# 可选的 AntiDebug Breaker MCP

仅在使用本项目 MCP 时阅读。这是当前项目实现的工具说明，不限定其他工具，也不要求只通过该 MCP 完成分析。实际工具名、输入 schema 和返回能力优先于本文；不同客户端可能增加工具名前缀。

## 能力索引

| 用途 | 当前工具 |
| --- | --- |
| 连接与目标状态 | `adb_capabilities`、`adb_list_pages`、`adb_connect_browser`、`adb_disconnect_browser` |
| 插件脚本及参数 | `adb_list_scripts`、`adb_get_state`、`adb_set_scripts`、`adb_set_hook_config`、`adb_set_mode` |
| Agent 持久脚本库 | `adb_script_library` |
| 已加载路由快照 | `adb_get_routes` |
| 新建标签页、导航、交互与页面观察 | `adb_navigate`、`adb_snapshot`、`adb_interact`、`adb_screenshot` |
| 断点、源码及表达式 | `adb_debug`、`adb_source`、`adb_evaluate` |
| 网络、控制台和 Hook 事件 | `adb_network`、`adb_get_events` |
| 清理目标网站 Cookie（含 HttpOnly） | `adb_clear_cookies` |

扩展桥负责脚本设置与路由，并默认通过扩展的 `chrome.debugger` 通道承载导航、断点、源码、网络和交互。用户首次在 MCP 面板填写配对信息，点击“启用 MCP 并允许 Agent 控制浏览器”，即可同时保存配对信息、启用连接和控制；此后 Agent 调用 `adb_connect_browser`，参数为 `{}`，正常重启无需用户再次启用。两项均已启用时，主按钮“保存连接设置”只更新配对信息。收到 `DEBUGGER_CONTROL_DISABLED` 时告知用户点击“重新启用浏览器控制”；若 MCP 已停止，点击“启用 MCP 并允许 Agent 控制浏览器”。不要自行修改设置或自动切换远程连接。“停止 MCP”同时关闭连接和控制，保留配对信息；Chrome 调试提示条取消仅停用浏览器控制，正常重启不会恢复停用的功能。该 MCP 连接现有 Chrome，不负责启动或关闭用户浏览器。

原有远程通道可用 `transport: "remote"` 选择；显式指定 channel 或远程端点也会选择该通道，仍可能触发 Chrome 的远程连接授权。扩展配对成功与浏览器控制已连接是两个状态，以 `adb_capabilities` 的实际结果为准。

## Agent 脚本库

`adb_script_library` 管理 Agent 保存的普通 JavaScript，与 `adb_set_scripts` 管理的内置脚本独立。先查看 `adb_capabilities.extension.scriptLibrary`；需要扩展与本地 MCP 配套更新。Chrome 138+ 需要用户在扩展详情页打开“允许用户脚本”，Chrome 120–137 使用开发者模式；不可用时根据返回原因和指引处理，不影响其他工具的使用。库的写入操作还需用户在 MCP 面板启用 Agent 浏览器控制；保存下次导航生效的脚本无需先附加调试会话。

- `action: "save"` 提供稳定的 `id`、`name`、`code`、`matches`；新建默认停用，更新默认保留原启用状态，也可同次传 `enabled: true` 保存并启用。`matches` 使用指定 HTTP(S) 主机的匹配模式，可包含 `*.example.com` 子域，不接受全站匹配。复用 ID 更新脚本，避免创建多份重复 Hook。
- `list` 返回摘要，`get` 加 `id` 读取源码；`enable`、`disable`、`delete` 加 `id` 管理状态。`expectedRevision` 使用脚本库自己的全局 revision，与内置脚本配置的 revision 不同。
- 注入固定为 `document_start`、页面主环境（`MAIN`）、仅顶层页面。首版不提供 `GM_*`、`@require` 或其他运行时机；源码可以带油猴注释，但不等于兼容任意油猴脚本。
- 写入默认 `apply: "next_navigation"`；`apply: "reload"` 需要 `tabId` 和已连接的浏览器。`saved`、`registered` 只表示保存或注册结果，不能作为脚本实际运行、绕过成功的证据。`applicationStatus: "unverified"` 仅表示没有页面执行回执，正常执行后也可能保持此值，不能据此断言未注入或未开启“允许用户脚本”；权限/API 可用性和注册状态应查看 `status.available`、`status.reason` / `status.guidance` 及脚本的 `registrationState`。
- 已启用脚本保存在扩展中，匹配的新文档会继续注入，包括 MCP 断连或点击“停止 MCP”之后。停用、删除只阻止未来注入，当前页面已安装的 Hook 需要刷新后清除；结束时明确交代保留状态。

例如保存并启用一个仅用于检查运行环境的标记脚本：

```json
{"action":"save","id":"example_start","name":"启动标记示例","code":"window.__ADB_LIBRARY_EXAMPLE__ = 'document_start';","matches":["https://example.com/*"],"enabled":true,"apply":"next_navigation"}
```

这只是用法示例，不是反调试绕过。更换为目标脚本和实际匹配范围后，在新文档中验证脚本及用户需要的页面操作；不要将此前的临时求值效果算作脚本库验证。

## 影响结果判断的语义

- `tabId` 来自实际页面列表或新建标签页结果及扩展/浏览器配对，不能把同名网页、CDP targetId 或另一个浏览器的页面 ID 当作它。默认扩展通道按 tabId 附加，不依赖页面执行代码；备用远程通道首次 nonce 配对需要页面能执行代码。配对后可在暂停状态操作调试器。
- 需要另开页面时，在默认扩展通道连接后调用 `adb_navigate`，参数 `{"action":"new","url":"目标绝对 URL"}`，无需已有 `tabId`；可加 `active:false` 后台打开，后续使用返回的新 `tabId`。已有页面继续用 `action:"navigate"` 和 `tabId`。新建先接入观察再导航；`paused`、`timeout` 或带 `created:true` 的错误不代表标签页未创建，应复用返回的 ID，不能盲目重试新建；`created:"unknown"` 时先查页面列表及可能晚到的 `page.created` 事件。
- 内置脚本 ID 使用目录中的精确大小写。标准模式的脚本选择按 **hostname** 保存，不区分端口；全局模式覆盖更广。Hook 参数按脚本共享到不同站点，不是每个 tab 独立。
- 设置默认 `apply: "next_navigation"`：配置已保存，不代表当前文档已经安装或撤销 Hook。`apply: "reload"` 需要浏览器调试连接并对目标进行受控刷新；仍要以返回的 `applied`、`requiresReload`、revision 等实际状态判断。
- 开关不是当前页面的实时撤销器。内置脚本的 MCP 早期注入准备针对受控导航/刷新，不能推广成所有手动导航、跨域重定向或所有子框架均已覆盖；脚本库则由 Chrome 按注册的匹配范围在新文档中注入。
- `debugger`、`stack` 配置是 `0`/`1`；关键词 `param` 是字符串数组，只有 `keyword_filter_enabled: true` 且数组非空才启用子串匹配。可修改字段由脚本 schema 决定，不能给所有 Hook 都传关键词或固定值。
- `paused` 导航尚未完成。暂停会阻止普通页面表达式和交互，但已配对目标的调试状态、恢复、单步、源码和事件查询可以继续。暂停局部变量用当前 `callFrameId`，不要靠反复刷新解决暂停。
- 操作超时或返回 pending 不证明操作未发生，尤其不能盲目重发点击或提交；检查其状态再决定后续动作。
- `adb_debug` 与 `adb_source` 对外行列从 **1** 开始。工具中脚本目录 ID 与调试器的源码 `scriptId` 是不同标识。
- 路由快照只反映实际观测到的实例/记录。读取 `status`、新鲜度与文档标识；`rescan` 不是下载并发现所有懒加载路由的保证。
- 网络记录从附加观察开始，事件与响应体有缓冲、截断和可用性限制。空记录不代表页面从未发出请求；源码列表也不能代表站点全部未加载资源。
- 用户任务需要清理网站 Cookie 时，可调用 `adb_clear_cookies`，仅传目标 `tabId`，要求 Chrome 138+。范围是目标主机全部路径及适用的父域 Cookie，包含 HttpOnly；其他网站分区和无法识别的分区会保留并报告。Cookie 在匹配的标签页/子域间共享；不自动刷新或清理 localStorage。以复核状态和剩余/跳过数量判断结果，不能把命令成功或 `document.cookie` 为空当成全部清理成功；清理也不是每次逆向必须执行的步骤。
- 用本 MCP 检查控制台时，可从 `adb_get_events` 的混合事件中读取 `Runtime.consoleAPICalled` 和 `Runtime.exceptionThrown`。需先附加目标标签页再复现相关操作，单独读取事件不会启动采集；按返回的 `nextCursor` 继续读取，留意 `hasMore` 和 `cursorExpired`。附加前的完整历史或已被缓存淘汰的错误不保证可得，空结果不能证明脚本没有引发报错。
- 页面快照的元素引用、源码/请求标识和暂停帧都有各自生命周期；导航或新的快照后，按工具返回的有效性重新取得引用。

需要参数细节时读取当前工具 schema；需要脚本含义时阅读 [脚本用途](antidebug-breaker-scripts.md)。无需为了使用本技能预先启用所有脚本或改变全局模式。
