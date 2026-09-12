![Antidebug_Breaker](https://socialify.git.ci/0xsdeo/Antidebug_Breaker/image?description=1&font=Bitter&forks=1&language=1&logo=https%3A%2F%2Fp3-flow-imagex-sign.byteimg.com%2Ftos-cn-i-a9rns2rl98%2Frc_gen_image%2F83c1cf6f637940bba9ecb828b7f58ebc.jpeg%7Etplv-a9rns2rl98-image_raw_b.png%3Frcl%3D2025112123094019020B8768AB108FBE9E%26rk3s%3D8e244e95%26rrcfp%3D827586d3%26x-expires%3D2079097789%26x-signature%3DK1FvDsOfH%252BFlP1DmNm1nns1vAaM%253D&name=1&owner=1&pattern=Overlapping+Hexagons&stargazers=1&theme=Light)

## Intro

本插件是基于<a href="https://github.com/0xsdeo/Hook_JS">Hook_JS</a>库所写的Google插件，将致力于辅助前端JavaScript逆向以及渗透测试信息收集。

如何提交您自己的脚本：<a href="https://github.com/0xsdeo/AntiDebug_Breaker/wiki/%E6%8F%90%E4%BA%A4%E6%82%A8%E8%87%AA%E5%B7%B1%E7%9A%84hook%E8%84%9A%E6%9C%AC">AntiDebug_Breaker wiki</a>

本地 3.1.0 版本新增 MCP：可通过 Agent 管理脚本、设置 Hook 参数、获取 Vue/React 路由，并通过扩展的 `chrome.debugger` 通道控制当前 Chrome 标签页，进行页面操作、网络分析和断点调试。`adb_navigate` 的 `action: "new"` 可新建标签页并访问指定网站，返回新 `tabId` 供后续分析使用。安装、配对、完整工具表和打包方法见 [MCP 使用文档](mcp/README.md)。旧版 3.0.8 不含 MCP bridge；本地 ZIP 不会自动发布到商店。

从 3.0.8 升级时，域名/全局脚本选择与 Hook 参数会保留，旧版保存的超限关键词也可继续使用和删除。手动覆盖已解压的扩展目录后，先在 `chrome://extensions` 点击扩展的“重新加载”，再刷新已经打开的网页；仅重启浏览器可能仍使用旧后台，导致角标与脚本注入正常，但新版弹窗读不到开关和路由。遇到后台读取失败时，弹窗会明确提示，不会把未知状态显示为全部关闭。Vue/React 面板重新打开时会重新收集路由。

3.1.0 的扩展基础功能要求 **Chrome 120+**，低于此版本的浏览器无法接收本次更新。MCP 默认关闭，普通扩展功能不需要 Node.js；启用 MCP 时才需要单独安装本地服务。商店升级应沿用原条目；开发者模式测试时请停用另一个版本，避免重复 Hook 同一网页。

扩展新增必需的 `debugger` 权限：Chrome 不支持将它设为运行时可选权限。旧版商店扩展升级后，Chrome 可能要求确认新增权限并重新启用扩展。[Chrome 权限说明](https://developer.chrome.com/docs/extensions/reference/api/permissions)

首次使用时，在弹窗的 MCP 标签填写地址和配对密钥，点击 **“启用 MCP 并允许 Agent 控制浏览器”**，一次保存配对信息并开启 MCP 连接与浏览器控制。两项都已启用时，主按钮显示“保存连接设置”；连接已启用但浏览器控制停用时，主按钮显示“重新启用浏览器控制”，点击时也会保存当前配对信息。启用状态和配对信息会在正常重启后保留；旧版已配对但未允许浏览器控制的用户升级后保持原状态，需明确点击启用。Agent 不能自行开启浏览器控制。

配对后调用 `adb_connect_browser`，参数 `{}`，即可走扩展通道，无需开启远程调试或确认 Chrome 的远程会话连接弹窗。调试期间 Chrome 仍显示提示条：点击 Chrome 的取消只停用浏览器控制并释放扩展调试会话，MCP 连接保持原启用状态；点击面板的 **“停止 MCP”** 会同时停用 MCP 和浏览器控制，保留地址与密钥。恢复时需再次点击面板的启用按钮，正常重启不会恢复已停止的功能。这些操作不会撤销已声明的 Chrome 权限；普通脚本开关、Hook 参数和路由读取无需启用浏览器控制。

原有远程 CDP 连接保留为备用通道：使用 `{"transport":"remote","channel":"chrome"}`，或提供本机调试端点；具体授权步骤见 MCP 文档。两种通道提供相同的 19 个工具；新增的 `adb_navigate action: "new"` 操作需要默认扩展通道，已有标签页导航仍支持两种通道。当前均不自动覆盖跨进程 iframe 和 workers。

## 赞助商

感谢以下朋友与伙伴对 AntiDebug Breaker 的支持。

| Logo | 赞助商 | 介绍 | 邀请码 | 官网 |
| :--- | :--- | :--- | :--- | :--- |
| [![BirdProxies](image/README/1779357961398.png)](https://birdproxies.com/@ANTIDEBUG_BREAKER) | BirdProxies | 代理不该复杂也不该贵。覆盖 195+ 地区的快速住宅代理和 ISP 代理，价格公道，支持到位。官网首页玩 FlappyBird 小游戏可免费领流量。 | 首单10%折扣 + 额外15%住宅代理免费流量<br>测试联系：https://discord.com/invite/birdproxies | [立即注册](https://birdproxies.com/@ANTIDEBUG_BREAKER) |

## 教学视频

反调试：https://www.bilibili.com/video/BV1gQ4mzMEA4

Vue：https://www.bilibili.com/video/BV12148z7EnP

Hook CryptoJS对称加密 快速出key、iv、mode、padding：https://www.bilibili.com/video/BV1MPW1zDEK8

JS逆向快速定位加密位置以及获取加密密文等加密参数：https://www.bilibili.com/video/BV1cRyXBaEJX

SpiderDemo 靶场练习网站：https://www.spiderdemo.cn

## 插件安装

### 谷歌插件应用商店安装

地址：https://chromewebstore.google.com/detail/antidebug-breaker/opkclndfcbafdaecbbaklefnaadopcln

### 手动安装

将源码下载到本地后打开chrome，访问`chrome://extensions/`，点击左上角的`加载未打包的扩展程序`，然后选中源码文件夹即可：
![1753669187234](image/README/1753669187234.png)

## MCP + Skills 配套包

安装了含 MCP 功能的扩展后，在弹窗 **MCP** 页面点击 **“下载 MCP + Skills”**，在新标签页打开 [当前版本的 GitHub Release](https://github.com/0xsdeo/AntiDebug_Breaker/releases/tag/v3.1.0)，从 **Assets** 下载 `AntiDebug_Breaker-Agent-3.1.0.zip`。解压后按照根目录的 `安装说明.md` 安装 MCP 依赖、配置 Agent 客户端，并安装完整的技能目录；也可先阅读仓库中的 [中文安装说明](docs/agent-install.md)。商店用户继续使用原商店扩展，无需另装源码版扩展。

配套包提供 MCP 代码、锁定的依赖清单、Skills 和中文安装说明；不包含 Node.js、`node_modules`、测试缓存或个人配对信息。需要 Node.js 22+，安装依赖时需要联网。MCP 服务由 Agent 客户端通过 stdio 启动，配对配置默认保存在用户目录，与下载包分开。

维护者在完整源码的根目录运行 `node tools/package.mjs`，同时生成扩展包和配套包；只生成配套包可运行 `node tools/package-agent.mjs`。下载按钮打开固定版本的 GitHub Release 页面：发布当前版本时，在 [GitHub Releases](https://github.com/0xsdeo/AntiDebug_Breaker/releases) 的 `v3.1.0` Release 上传 `dist/AntiDebug_Breaker-Agent-3.1.0.zip`，保持附件文件名不变，并将对应扩展包通过原 Chrome 商店条目发布。**本地打包不会上传或发布；Release 尚未发布时页面不可用，附件尚未上传时 Assets 中不会出现配套包。** 完整构建和发布说明见 [MCP 使用文档](mcp/README.md#开发验证与发布打包)。

## 脚本使用场景

>AntiDebug

- <a href="#Bypass_Debugger">Bypass Debugger</a>
- <a href="#hook_log">hook log</a>
- <a href="#Hook_table">Hook table</a>
- <a href="#hook_clear">hook clear</a>
- <a href="#hook_close">hook close</a>
- <a href="#hook_history">hook history</a>
- <a href="#Fixed_window_size">Fixed window size</a>
- <a href="#location_href">页面跳转JS代码定位通杀方案</a>
- <a href="#Hook_CryptoJS">Hook CryptoJS</a>
- <a href="#Hook_JSEncrypt_RSA">Hook JSEncrypt RSA</a>
- <a href="#Hook_SMcrypto">Hook SM-crypto</a>

>Hook

- <a href="#document.cookie">document.cookie</a>
- <a href="#XMLHttpRequest.setRequestHeader">XMLHttpRequest.setRequestHeader</a>
- <a href="#XMLHttpRequest.open">XMLHttpRequest.open</a>
- <a href="#localStorage.setItem">localStorage.setItem</a>
- <a href="#localStorage.getItem">localStorage.getItem</a>
- <a href="#localStorage.removeItem">localStorage.removeItem</a>
- <a href="#localStorage.clear">localStorage.clear</a>
- <a href="#sessionStorage.setItem">sessionStorage.setItem</a>
- <a href="#sessionStorage.getItem">sessionStorage.getItem</a>
- <a href="#sessionStorage.removeItem">sessionStorage.removeItem</a>
- <a href="#sessionStorage.clear">sessionStorage.clear</a>
- <a href="#fetch">fetch</a>
- <a href="#JSON.parse">JSON.parse</a>
- <a href="#JSON.stringify">JSON.stringify</a>
- <a href="#Promise">Promise</a>
- <a href="#Math.random">Math.random</a>
- <a href="#Date.now">Date.now</a>
- <a href="#performance.now">performance.now</a>

> Vue

- <a href="#Get_Vue_0">获取路由</a>
- <a href="#Get_Vue_1">清除跳转</a>
- <a href="#Clear_vue_Navigation_Guards">清除路由守卫</a>
- <a href="#detectorExec">激活Vue Devtools</a>

> React

- <a href="#Get_React_0">获取路由</a>

### 反调试

- <a id="Bypass_Debugger" href="https://github.com/0xsdeo/AntiDebug_Breaker/blob/main/scripts/Bypass_Debugger.js">Bypass Debugger</a>

该脚本用于绕过**无限Debugger**，目前引起无限Debugger的三种核心方式为：

> eval

> Function

> Function.prototype.constructor

本脚本通过 Hook 以上核心函数有效绕过大部分前端无限 debugger。但因 eval 作用域问题，某些网站可能会报错。此时可切换至火狐浏览器无视debugger进行调试。

注：极少数网站可能采用特殊反制措施（如故意引发eval作用域问题或其他问题），导致前端报错或依然能引起debugger，这种情况需针对性解决。总体而言，**本脚本能覆盖绝大多数场景**。

脚本原理：<a href="https://mp.weixin.qq.com/s/3xagT-PXCgGrw9YiaCe__g">JS逆向系列14-Bypass Debugger</a>

- <a id="hook_log" href="https://github.com/0xsdeo/AntiDebug_Breaker/blob/main/scripts/hook_log.js">hook log</a>

本脚本为<a href="https://github.com/lyousan">Yosan</a>师傅所作，用于防止js重写console.log等方法。

- <a id="Hook_table" href="https://github.com/0xsdeo/AntiDebug_Breaker/blob/main/scripts/hook_table.js">Hook table</a>

绕过js检测运行时间差来实现反调试。

本脚本将针对以下这三种特征的反调试网站(注：包括但不仅限于这以下三种特征，需根据实际情况去判断是否需要使用本脚本)：

> 频繁调用console.clear清除控制台数据

> 控制台频繁输出大量内容

> 进行完以上两种操作后直接使用location.href进行跳转，一般跳转到主域名为github.io的网站。

如存在以上特征的网站，均可尝试使用本脚本去进行绕过。

脚本原理：<a href="https://mp.weixin.qq.com/s/JZu-fknVdEpaI5anzSlLjg">JS逆向系列19-无感绕过一类运行时间差反调试</a>

- <a id="hook_clear" href="https://github.com/0xsdeo/AntiDebug_Breaker/blob/main/scripts/hook_clear.js">hook clear</a>

禁止js清除控制台数据。

脚本原理：<a href="https://mp.weixin.qq.com/s/r-ZcP2knpmoVEK0y_26xBw">JS逆向系列10-反调试与反反调试</a>

- <a id="hook_close" href="https://github.com/0xsdeo/AntiDebug_Breaker/blob/main/scripts/hook_close.js">hook close</a>

重写close，以此来避免网站反调试关闭当前页面。

脚本原理：<a href="https://mp.weixin.qq.com/s/r-ZcP2knpmoVEK0y_26xBw">JS逆向系列10-反调试与反反调试</a>

- <a id="hook_history" href="https://github.com/0xsdeo/AntiDebug_Breaker/blob/main/scripts/hook_history.js">hook history</a>

避免网站反调试返回上一页或某个特定历史页面。

脚本原理：<a href="https://mp.weixin.qq.com/s/r-ZcP2knpmoVEK0y_26xBw">JS逆向系列10-反调试与反反调试</a>

- <a id="Fixed_window_size" href="https://github.com/0xsdeo/AntiDebug_Breaker/blob/main/scripts/Fixed_window_size.js">Fixed window size</a>

固定浏览器高度宽度值以绕过前端检测用户是否打开控制台。

固定的宽度高度值：
```text
innerHeight：660
innerWidth：1366

outerHeight：760
outerWidth：1400
```

- <a id="location_href" href="https://github.com/0xsdeo/AntiDebug_Breaker/blob/main/scripts/location_href.js">页面跳转JS代码定位通杀方案</a>

本脚本为<a href="https://github.com/CC11001100">CC11001100</a>师傅所作，脚本原地址：`https://github.com/JSREI/page-redirect-code-location-hook`，用于阻断页面跳转，留在当前页面分析。

- <a id="Hook_CryptoJS" href="https://github.com/0xsdeo/AntiDebug_Breaker/blob/main/scripts/Hook_CryptoJS.js">Hook CryptoJS</a>

Hook CryptoJS当中的所有 对称&哈希&HMAC算法，例如AES、DES、MD5、SHA等。如果未打印请自查目标站点是否清除了console.log或是否使用的是CryptoJS的加密算法，如果确认使用的是CryptoJS库进行的加密而无法打印可联系我。

- <a id="Hook_JSEncrypt_RSA" href="https://github.com/0xsdeo/AntiDebug_Breaker/blob/main/scripts/Hook_JSEncrypt.js">Hook JSEncrypt RSA</a>

Hook JSEncrypt加密库中的RSA算法，加密时将在控制台打印公钥、原始数据、加密后的密文。解密时将在控制台打印私钥、原始数据、解密后的明文。如果未打印请自查目标站点是否清除了console.log或是否使用的是JSEncrypt的RSA算法，如果确认使用的是JSEncrypt库进行的RSA加密而无法打印可联系我。

- <a id="Hook_SMcrypto" href="https://github.com/0xsdeo/AntiDebug_Breaker/blob/main/scripts/Hook_SMcrypto.js">Hook SM-crypto</a>

本脚本思路与初始形态为<a href="https://github.com/Hosinoharu">魔法少女☆ホシノ</a>所作。

Hook SM-crypto加密库当中的 SM2、SM3、SM4算法。如果未打印请自查目标站点是否清除了console.log或是否使用的是sm-crypto的加密算法，如果清除了console.log可以尝试使用hook log脚本防止js重写log方法，如果确认使用的是sm-crypto库进行的加密而无法打印可联系我。

### Hook

- <a id="document.cookie" href="https://github.com/0xsdeo/AntiDebug_Breaker/blob/main/scripts/Hook_cookie.js">document.cookie</a>

开启本脚本后默认将在控制台打印设置的cookie，如果需要打印特定cookie请在下方输入框中输入cookie名称，脚本将会捕获这些特定cookie名。

- <a id="XMLHttpRequest.setRequestHeader" href="https://github.com/0xsdeo/AntiDebug_Breaker/blob/main/scripts/hook_xhr_setRequestHeader.js">XMLHttpRequest.setRequestHeader</a>

开启本脚本后默认将在控制台打印设置的请求头，如果需要打印特定请求头请在下方输入框中输入请求头名称，脚本将会捕获这些特定请求头名。

- <a id="XMLHttpRequest.open" href="https://github.com/0xsdeo/AntiDebug_Breaker/blob/main/scripts/hook_xhr_open.js">XMLHttpRequest.open</a>

开启本脚本后默认将在控制台打印初始化xhr请求配置(url,method)，如果需要捕获特定url请在下方输入框中输入url名称，脚本将会捕获这些特定url名称。

- <a id="localStorage.setItem" href="https://github.com/0xsdeo/AntiDebug_Breaker/blob/main/scripts/hook_localStorage_setItem.js">localStorage.setItem</a>

开启本脚本后默认将在控制台打印设置的localStorage键值，如果需要捕获特定键请在下方输入框中输入键名，脚本将会捕获这些特定键名。

- <a id="localStorage.getItem" href="https://github.com/0xsdeo/AntiDebug_Breaker/blob/main/scripts/hook_localStorage_getItem.js">localStorage.getItem</a>

开启本脚本后默认将在控制台打印站点读取的localStorage键名，如果需要捕获特定键名请在下方输入框中输入键名，脚本将会捕获这些特定键名。

- <a id="localStorage.removeItem" href="https://github.com/0xsdeo/AntiDebug_Breaker/blob/main/scripts/hook_localStorage_removeItem.js">localStorage.removeItem</a>

开启本脚本后默认将在控制台打印移除的localStorage键名，如果需要捕获特定键名请在下方输入框中输入键名，脚本将会捕获这些特定键名。

- <a id="localStorage.clear" href="https://github.com/0xsdeo/AntiDebug_Breaker/blob/main/scripts/hook_localStorage_clear.js">localStorage.clear</a>

开启本脚本后如果站点进行了清空localStorage动作，默认会在控制台打印消息。

- <a id="sessionStorage.setItem" href="https://github.com/0xsdeo/AntiDebug_Breaker/blob/main/scripts/hook_sessionStorage_setItem.js">sessionStorage.setItem</a>

开启本脚本后默认将在控制台打印设置的sessionStorage键值，如果需要捕获特定键请在下方输入框中输入键名，脚本将会捕获这些特定键名。

- <a id="sessionStorage.getItem" href="https://github.com/0xsdeo/AntiDebug_Breaker/blob/main/scripts/hook_sessionStorage_getItem.js">sessionStorage.getItem</a>

开启本脚本后默认将在控制台打印站点读取的sessionStorage键名，如果需要捕获特定键名请在下方输入框中输入键名，脚本将会捕获这些特定键名。

- <a id="sessionStorage.removeItem" href="https://github.com/0xsdeo/AntiDebug_Breaker/blob/main/scripts/hook_sessionStorage_removeItem.js">sessionStorage.removeItem</a>

开启本脚本后默认将在控制台打印移除的sessionStorage键名，如果需要捕获特定键名请在下方输入框中输入键名，脚本将会捕获这些特定键名。

- <a id="sessionStorage.clear" href="https://github.com/0xsdeo/AntiDebug_Breaker/blob/main/scripts/hook_sessionStorage_clear.js">sessionStorage.clear</a>

开启本脚本后如果站点进行了清空sessionStorage动作，默认会在控制台打印消息。

- <a id="fetch" href="https://github.com/0xsdeo/AntiDebug_Breaker/blob/main/scripts/hook_fetch.js">fetch</a>

开启本脚本后默认将在控制台打印fetch请求设置。

- <a id="JSON.parse" href="https://github.com/0xsdeo/AntiDebug_Breaker/blob/main/scripts/hook_json_parse.js">JSON.parse</a>

开启本脚本后默认将在控制台打印传入的JSON，如果需要捕获特定JSON请在下方输入框中输入JSON，脚本将会捕获这些特定JSON字符串。

- <a id="JSON.stringify" href="https://github.com/0xsdeo/AntiDebug_Breaker/blob/main/scripts/hook_json_stringify.js">JSON.stringify</a>

开启本脚本后默认将在控制台打印传入JSON.stringify的值。

- <a id="Promise" href="https://github.com/0xsdeo/AntiDebug_Breaker/blob/main/scripts/hook_Promise.js">Promise</a>

本脚本为<a href="https://github.com/lyousan">Yosan</a>师傅所作。

将在控制台打印Promise的resolve参数，可快速定位异步回调位置。

- <a id="Math.random" href="https://github.com/0xsdeo/AntiDebug_Breaker/blob/main/scripts/hook_random.js">Math.random</a>

固定Math.random返回值

- <a id="Date.now" href="https://github.com/0xsdeo/AntiDebug_Breaker/blob/main/scripts/Hook_Date_now.js">Date.now</a>

固定Date.now返回值

- <a id="performance.now" href="https://github.com/0xsdeo/AntiDebug_Breaker/blob/main/scripts/hook_performance_now.js">performance.now</a>

固定performance.now返回值

### Vue

- <a id="Get_Vue_0" href="https://github.com/0xsdeo/AntiDebug_Breaker/blob/main/scripts/Get_Vue_0.js">获取路由</a>

获取已加载的路由并显示在下方的表格中，注意未加载的路由不会被获取到，如果长时间未获取到可能是由于目标站点未使用vue router，也可能是因为目标站点未加载完毕。

- <a id="Get_Vue_1" href="https://github.com/0xsdeo/AntiDebug_Breaker/blob/main/scripts/Get_Vue_1.js">清除跳转</a>

本脚本将清除vue router的跳转方法，如果清除后依然会跳转，一方面可能是由于注入的脚本还未清除跳转方法，网站就调用了方法进行跳转，此时可以考虑手动替换js清除跳转方法。另一方面可能是由于在代码中调用的不是vue router的跳转方法，此时可以考虑开启反调试板块中的hook close或hook history脚本，再或者打开页面跳转JS代码定位通杀方案脚本，定位到跳转的函数并替换清除。

- <a id="Clear_vue_Navigation_Guards" href="https://github.com/0xsdeo/AntiDebug_Breaker/blob/main/scripts/Clear_vue_Navigation_Guards.js">清除路由守卫</a>

仅清除全局前置守卫(beforeEach)和全局解析守卫(beforeResolve)，如果清除后网站控制台显示报错，可能是由于在路由守卫中做了动态加载等其他操作，此时可以考虑关闭本脚本并亲自替换js逻辑实现绕过。

脚本原理：<a href="https://mp.weixin.qq.com/s/klhBr2V7UJpspiAmRY1DXQ">最大化收集Vue框架(SPA类型)下的js</a>

- <a id="detectorExec" href="https://github.com/0xsdeo/AntiDebug_Breaker/blob/main/scripts/detectorExec.js">激活Vue Devtools</a>

本脚本引用自<a href="https://github.com/hzmming/vue-force-dev">vue-force-dev</a>。

当开启本脚本后将激活Vue Devtools。Vue2需开启Vue.js devtools(v5)，Vue3需开启Vue.js devtools，可自行去谷歌插件商店安装上述两个插件。注：1.上述两个插件不能同时开。2.当下方没有检测到Vue Router时并不能代表网站不是Vue框架，只能说明网站并没有使用Vue Router。

### React

- <a id="Get_React_0" href="https://github.com/0xsdeo/AntiDebug_Breaker/blob/main/scripts/Get_React_0.js">获取路由</a>

获取已加载的路由并显示在下方的表格中，注意未加载的路由不会被获取到，如果长时间未获取到可能是由于目标站点未使用react router，也可能是因为目标站点未加载完毕。

## 插件使用注意事项

1. 本插件目前不支持火狐。
2. 进入网页后，无论是开启脚本还是关闭脚本，需刷新页面后才会生效。
3. **商店版本通过原条目升级；手动版本替换原目录文件后在扩展管理页重新加载。**新增调试权限可能需要确认并重新启用扩展。卸载扩展会删除它的本地配置，请勿为普通升级先卸载旧版。

## 致谢

致谢个人：<a href="https://github.com/Hosinoharu">魔法少女☆ホシノ</a>、<a href="https://github.com/CC11001100">CC11001100</a>、<a href="https://github.com/mingheyan">Dexter</a>、<a href="https://github.com/d1sbb">d1sbb</a>、<a href="https://github.com/lyousan">Yosan</a>

本项目参考过、引用过或正在引用的优质项目：<a href="https://github.com/Ad1euDa1e/VueCrack">VueCrack</a>、<a href="https://github.com/keecth/FakeCryptoJS">FakeCryptoJS</a>、<a href="https://github.com/hzmming/vue-force-dev">vue-force-dev</a>

## Contact

如有bug或其他问题可提交issues，或者关注公众号Spade sec联系我。

如需添加交流群可加我微信：I-0xsdeo。

## 使用许可

本工具禁止未授权商业用途，禁止二次开发后进行未授权商业用途。

## 404星链计划
<img src="https://github.com/knownsec/404StarLink-Project/raw/master/logo.png" width="30%">

AntiDebug_Breaker 现已加入 [404星链计划](https://github.com/knownsec/404StarLink)

## Star History
[![Stargazers over time](https://starchart.cc/0xsdeo/AntiDebug_Breaker.svg?variant=adaptive)](https://starchart.cc/0xsdeo/AntiDebug_Breaker)
