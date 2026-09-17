# AntiDebug Breaker 脚本用途

按本项目当前 `scripts.json`、`scripts/` 和控制层实现核对。脚本 ID 大小写敏感；实际安装版本的目录和能力返回优先于本文。这里说明用途及影响判断的边界，不是推荐全部开启的清单。

## 反调试与跳转

| ID | 实际用途与边界 |
| --- | --- |
| `Bypass_Debugger` | 在 `eval`、`Function`、`Function.prototype.constructor` 的字符串参数中删除 `debugger` 子串。没有清除已加载 JS 中直接书写的静态断点；字符串替换也可能改变字符串字面量或标识符。包装后的 `eval` 经别名调用原生 `eval`，不再保留直接求值时的调用处局部作用域，可能引发 `ReferenceError` 或行为变化；验证时检查相关报错和目标功能。 |
| `hook_log` | 防止普通赋值覆盖 `console.log/trace/groupCollapsed/groupEnd` 及 `window.console`。不等于恢复所有已被改写的 console 方法。 |
| `hook_table` | 将 `console.table` 置空，针对依赖它调用耗时的检测。不是通用时间差绕过。 |
| `hook_clear` | 禁用 `console.clear`，避免控制台输出被清掉。 |
| `hook_close` | 禁用 `window.close`，不覆盖其他跳转方式。 |
| `hook_history` | 禁用 `history.go` 和 `history.back`，没有禁用 `forward`、`pushState`、`replaceState` 或 `location`。 |
| `Fixed_window_size` | 固定页面读取到的 inner 宽高为 1366×660、outer 宽高为 1400×760，干预基于窗口尺寸的检测。数值写在脚本中，不是调整实际浏览器窗口。 |
| `location_href` | 设置 `onbeforeunload`，文档卸载前执行 `debugger`，辅助定位跳转。没有直接 Hook `location.href`，不是跳转自动阻断器，也不覆盖不卸载文档的 SPA 导航。需要活动调试会话。 |
| `AntiAnti_Hook` | 应对反 Hook 检测：为 `Hooks.Function` 登记的函数伪装原生 `toString`，并处理部分通过 iframe 获取原始方法的情况。不是网站 Hook 检测扫描器，不自动覆盖所有函数、属性描述符检查或 iframe 场景。界面有独立开关，目录标记为隐藏项。 |

脚本名称或开关状态不是站点存在某种反调试的证据。固定尺寸、禁用导航、替换全局函数可能改变业务行为，其效果需结合目标页面实际观察。

## 加密库观测

| ID | 实际用途与边界 |
| --- | --- |
| `Hook_CryptoJS` | 通过全局 `Function.prototype.apply` 和对象/原型特征识别 CryptoJS 对称加解密及哈希/HMAC。加密侧可记录密文、key、iv 等，解密侧主要记录配置；哈希/HMAC 记录部分入参与输出，不能取得 HMAC 密钥。`symmetric`、`hash/HMAC` 标签不等于已经确认 AES、SHA 等具体算法。 |
| `Hook_JSEncrypt` | 通过全局 `Function.prototype.call` 识别 RSA 对象并包装加解密，记录输入、输出、公钥或可取得的私钥。当前结构化加密输出为底层 hex，控制台另显示 Base64，需区分编码；未包装签名/验签。 |
| `Hook_SMcrypto` | 从形似 webpack 模块工厂的 `.call` 中捕获导出，识别并包装 SM2 加解密、SM3 摘要、SM4 加解密。包含特征与试算识别，覆盖取决于库及打包方式；未包装 SM2 签名/验签。 |
| `Hook_JSEncrypt_SMcrypto` | 同时启用 `Hook_JSEncrypt` 和 `Hook_SMcrypto` 时，由控制层自动使用的内部合并实现。设置独立逻辑 ID 即可，不直接启用此合并 ID。 |

这些脚本提供线索和运行时数据，不保证命中所有库版本、自定义实现或 Web Crypto API。Hook 到库调用，还需把它与用户指定接口/字段联系起来。SM3、MD5、SHA 是摘要，HMAC 是消息认证码，不能根据日志里的“加密”字样认定可解密。

## 可配置的数据流 Hook

这些 Hook 可按实际配置选择命中后暂停（`debugger`）或输出调用栈（`stack`）。支持关键词的脚本按表中对象做大小写敏感的子串匹配；关键词字段不能用于所有脚本。详情以脚本 schema 为准。

| ID | 观察内容 | 关键词目标/边界 |
| --- | --- | --- |
| `Hook_cookie` | JS 写入 `document.cookie` | cookie 名；不是完整 Cookie 读取器，不覆盖服务端 `Set-Cookie` 或 HttpOnly 值 |
| `hook_xhr_open` | XHR 的方法、URL 等 `open` 入参 | URL；没有拦截 `send`，不能据此取得完整请求体/响应 |
| `hook_xhr_setRequestHeader` | JS 设置的请求头名和值 | 头名称；不代表最终全部请求头 |
| `hook_fetch` | `fetch` 入参 | 无关键词选项；不读取响应正文 |
| `hook_localStorage_setItem` | localStorage 写入键和值 | 键名 |
| `hook_localStorage_getItem` | localStorage 读取的键 | 键名；当前事件记录入参，不是读取结果 |
| `hook_localStorage_removeItem` | localStorage 删除的键 | 键名；原删除操作仍执行 |
| `hook_localStorage_clear` | localStorage 清空动作 | 无关键词选项；原清空操作仍执行 |
| `hook_sessionStorage_setItem` | sessionStorage 写入键和值 | 键名 |
| `hook_sessionStorage_getItem` | sessionStorage 读取的键 | 键名；当前事件记录入参，不是读取结果 |
| `hook_sessionStorage_removeItem` | sessionStorage 删除的键 | 键名；原删除操作仍执行 |
| `hook_sessionStorage_clear` | sessionStorage 清空动作 | 无关键词选项；原清空操作仍执行 |
| `hook_json_parse` | 传给 `JSON.parse` 的文本 | JSON 文本；解析 JSON 不等于解密 |
| `hook_json_stringify` | `JSON.stringify` 入参 | 无关键词选项；当前事件不是序列化后的返回字符串 |
| `hook_Promise` | 包装全局 Promise 构造器的 executor/resolve | 无关键词选项；只观察真值且非 Promise 的 resolve 值，漏掉 `0/false/空字符串/null/undefined`，不观察 reject，也不代表全部 async/await |
| `hook_random` | 将 `Math.random()` 固定为配置的 `value` | 不是关键词；不覆盖 `crypto.getRandomValues` |
| `Hook_Date_now` | 将 `Date.now()` 固定为配置的 `value` | 不是关键词；不覆盖 `new Date()` 等其他时间来源 |
| `hook_performance_now` | 将 `performance.now()` 固定为配置的 `value` | 不是关键词；不覆盖所有计时方式 |

最后三个脚本会改变返回值，当前默认固定值为 `0`，可能改变随机量、时效和业务逻辑；它们不是只读观察。`hook_clear` 是阻止控制台清屏，而两个 Storage 的 clear Hook 仍会执行清空，不能混淆。

## Vue / React

| ID | 实际用途与边界 |
| --- | --- |
| `Get_Vue_0` | 从 DOM 上的 Vue 实例发现多个 Router，读取 `getRoutes`、`options.routes`、matcher 或当前匹配记录；不同来源完整度不同。不会静态分析尚未注册的 JS 路由表。 |
| `Get_Vue_1` | 包含路由发现，并将发现的 Router 实例 `push/replace/go` 置空。它可能阻止正常导航，不能覆盖所有网页跳转。启用时替代父项 `Get_Vue_0`，关闭子项会恢复父项；完全停止采集还需关闭父项。 |
| `Clear_vue_Navigation_Guards` | Hook `Array.prototype.push`，按 `beforeEach/beforeResolve` 堆栈特征阻止部分守卫注册。不是遍历清空全部已注册守卫，不覆盖组件守卫、路由独享守卫或全部注册形式。可能同时阻止负责动态路由注册/初始化的逻辑。 |
| `detectorExec` | 借助已存在的 Vue Devtools hook 和消息启用 Vue 2/3 调试支持，并尝试注册 Pinia 调试能力。不会安装 Vue Devtools，也不是路由收集器。 |
| `Get_React_0` | 从 React DOM/Fiber、props、context、hook state 等提取路由，涵盖多种 Router 形态并包含菜单候选兜底；有扫描限制，动态变化后可重新扫描。`MenuRoutes` 是候选，不能直接视为已注册路由。 |

未加载组件可能已有路由定义；未进入运行时的路由定义则可能不在插件结果中。插件的 React `source: startFiber#…` 等值表示发现入口，不是来源 JS 文件；真正的源码定位需要额外证据。

`adb_runtime.js` 是内部观测运行时，不是用户可选脚本；保留的 `hook_log v0.1.js` / `hook_log v0.2.js` 不在当前功能目录中。
