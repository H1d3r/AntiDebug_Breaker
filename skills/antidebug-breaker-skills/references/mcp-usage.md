# 可选的 AntiDebug Breaker MCP

仅在使用本项目 MCP 时阅读。这是当前项目实现的工具说明，不限定其他工具，也不要求只通过该 MCP 完成分析。实际工具名、输入 schema 和返回能力优先于本文；不同客户端可能增加工具名前缀。

## 能力索引

| 用途 | 当前工具 |
| --- | --- |
| 连接与目标状态 | `adb_capabilities`、`adb_list_pages`、`adb_connect_browser`、`adb_disconnect_browser` |
| 插件脚本及参数 | `adb_list_scripts`、`adb_get_state`、`adb_set_scripts`、`adb_set_hook_config`、`adb_set_mode` |
| 已加载路由快照 | `adb_get_routes` |
| 新建标签页、导航、交互与页面观察 | `adb_navigate`、`adb_snapshot`、`adb_interact`、`adb_screenshot` |
| 断点、源码及表达式 | `adb_debug`、`adb_source`、`adb_evaluate` |
| 网络和 Hook 事件 | `adb_network`、`adb_get_events` |

扩展桥负责脚本设置与路由，并默认通过扩展的 `chrome.debugger` 通道承载导航、断点、源码、网络和交互。用户首次在 MCP 面板填写配对信息，点击“启用 MCP 并允许 Agent 控制浏览器”，即可同时保存配对信息、启用连接和控制；此后 Agent 调用 `adb_connect_browser`，参数为 `{}`，正常重启无需用户再次启用。两项均已启用时，主按钮“保存连接设置”只更新配对信息。收到 `DEBUGGER_CONTROL_DISABLED` 时告知用户点击“重新启用浏览器控制”；若 MCP 已停止，点击“启用 MCP 并允许 Agent 控制浏览器”。不要自行修改设置或自动切换远程连接。“停止 MCP”同时关闭连接和控制，保留配对信息；Chrome 调试提示条取消仅停用浏览器控制，正常重启不会恢复停用的功能。该 MCP 连接现有 Chrome，不负责启动或关闭用户浏览器。

原有远程通道可用 `transport: "remote"` 选择；显式指定 channel 或远程端点也会选择该通道，仍可能触发 Chrome 的远程连接授权。扩展配对成功与浏览器控制已连接是两个状态，以 `adb_capabilities` 的实际结果为准。

## 影响结果判断的语义

- `tabId` 来自实际页面列表或新建标签页结果及扩展/浏览器配对，不能把同名网页、CDP targetId 或另一个浏览器的页面 ID 当作它。默认扩展通道按 tabId 附加，不依赖页面执行代码；备用远程通道首次 nonce 配对需要页面能执行代码。配对后可在暂停状态操作调试器。
- 需要另开页面时，在默认扩展通道连接后调用 `adb_navigate`，参数 `{"action":"new","url":"目标绝对 URL"}`，无需已有 `tabId`；可加 `active:false` 后台打开，后续使用返回的新 `tabId`。已有页面继续用 `action:"navigate"` 和 `tabId`。新建先接入观察再导航；`paused`、`timeout` 或带 `created:true` 的错误不代表标签页未创建，应复用返回的 ID，不能盲目重试新建；`created:"unknown"` 时先查页面列表及可能晚到的 `page.created` 事件。
- 脚本 ID 使用目录中的精确大小写。标准模式的脚本选择按 **hostname** 保存，不区分端口；全局模式覆盖更广。Hook 参数按脚本共享到不同站点，不是每个 tab 独立。
- 设置默认 `apply: "next_navigation"`：配置已保存，不代表当前文档已经安装或撤销 Hook。`apply: "reload"` 需要浏览器调试连接并对目标进行受控刷新；仍要以返回的 `applied`、`requiresReload`、revision 等实际状态判断。
- 开关不是当前页面的实时撤销器。当前实现对 MCP 受控导航/刷新准备早期注入，不能推广成所有手动导航、跨域重定向或所有子框架均已覆盖。
- `debugger`、`stack` 配置是 `0`/`1`；关键词 `param` 是字符串数组，只有 `keyword_filter_enabled: true` 且数组非空才启用子串匹配。可修改字段由脚本 schema 决定，不能给所有 Hook 都传关键词或固定值。
- `paused` 导航尚未完成。暂停会阻止普通页面表达式和交互，但已配对目标的调试状态、恢复、单步、源码和事件查询可以继续。暂停局部变量用当前 `callFrameId`，不要靠反复刷新解决暂停。
- 操作超时或返回 pending 不证明操作未发生，尤其不能盲目重发点击或提交；检查其状态再决定后续动作。
- `adb_debug` 与 `adb_source` 对外行列从 **1** 开始。工具中脚本目录 ID 与调试器的源码 `scriptId` 是不同标识。
- 路由快照只反映实际观测到的实例/记录。读取 `status`、新鲜度与文档标识；`rescan` 不是下载并发现所有懒加载路由的保证。
- 网络记录从附加观察开始，事件与响应体有缓冲、截断和可用性限制。空记录不代表页面从未发出请求；源码列表也不能代表站点全部未加载资源。
- 页面快照的元素引用、源码/请求标识和暂停帧都有各自生命周期；导航或新的快照后，按工具返回的有效性重新取得引用。

需要参数细节时读取当前工具 schema；需要脚本含义时阅读 [脚本用途](antidebug-breaker-scripts.md)。无需为了使用本技能预先启用所有脚本或改变全局模式。
