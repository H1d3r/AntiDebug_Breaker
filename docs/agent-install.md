# AntiDebug Breaker MCP + Skills 安装说明

此配套包用于扩展 **3.1.1**，包含本地 MCP **0.2.0** 服务和 `Antidebug_Breaker_skills`。先安装或更新到对应版本的 Chrome 扩展，再按以下步骤接入 Agent。商店用户继续使用商店安装的扩展，无需从配套包再安装扩展。

## 1. 下载并解压

在扩展的 **MCP** 页面点击 **“下载 MCP + Skills”**，在新标签页打开 [本扩展版本对应的 GitHub Release](https://github.com/0xsdeo/AntiDebug_Breaker/releases/tag/v3.1.1)。从页面的 **Assets** 下载 `AntiDebug_Breaker-Agent-3.1.1.zip`，解压到准备长期保留的目录。按钮不会自动选择其他版本。

包内目录如下：

```text
AntiDebug_Breaker-Agent-3.1.1/
├── 安装说明.md
├── bundle-manifest.json
├── mcp/
│   ├── src/
│   ├── package.json
│   ├── package-lock.json
│   └── README.md
└── skills/
    └── antidebug-breaker-skills/
        ├── SKILL.md
        ├── references/
        └── agents/
```

`bundle-manifest.json` 记录配套包和组件版本、文件校验信息。包中不含 Node.js、npm 依赖、Chrome 扩展和个人配对信息。

## 2. 安装 MCP 依赖，生成配对信息

准备 **Node.js 22 或以上**（含 npm）和 **Chrome 120 或以上**。在解压后的 `mcp` 目录打开终端，执行：

```powershell
node --version
npm ci
npm run setup
```

首次安装依赖需要联网。`setup` 会在当前用户目录的 `.antidebug-breaker/mcp.json` 中创建配对配置，并打印本地连接地址和配对密钥；已有配置会继续使用，重复执行可以重新查看。默认地址是 `ws://127.0.0.1:19876/extension`，填写时以实际输出为准。

## 3. 让 Agent 客户端启动 MCP

在客户端添加 **stdio** 类型的 MCP 服务。支持 `mcpServers` 配置的客户端可参考：

```json
{
  "mcpServers": {
    "antidebug-breaker": {
      "command": "node",
      "args": [
        "C:/Tools/AntiDebug_Breaker-Agent-3.1.1/mcp/src/index.js"
      ]
    }
  }
}
```

把 `args` 替换成实际解压位置的**绝对路径**。Windows 路径可使用 `/`，避免 JSON 中的反斜杠转义。客户端找不到 `node` 时，把 `command` 改为 Node 可执行文件的绝对路径，例如 `C:/Program Files/nodejs/node.exe`。不同客户端的配置入口和外层格式可能不同，服务启动命令不变。

保存配置后，启动或重启客户端中的该 MCP 服务。客户端会自动启动 Node 进程，**不要同时在终端运行 `npm start`**，否则可能争用同一配对端口。

默认情况下，服务读取第 2 步生成的个人配置。如果你主动使用了 `--config` 自定义配置路径，客户端 `args` 也要追加 `"--config"` 和同一配置文件的绝对路径。

## 4. 配对扩展

打开扩展弹窗，横向滑动顶部标签栏进入 **MCP** 页面：

1. 填写 `setup` 显示的本地连接地址和配对密钥。
2. 点击 **“启用 MCP 并允许 Agent 控制浏览器”**。
3. 等待显示 **“已连接到本地 MCP”**。

正常重启后会保留配对和启用状态。点击“停止 MCP”后，需要主动再次启用。配对密钥只供你本机的客户端与扩展使用，不要发给他人或放入公开仓库。

如需让 Agent 保存并持续注入自己的脚本，再到 `chrome://extensions` → AntiDebug Breaker → 详情，打开 **“允许用户脚本”**（Chrome 138+）；Chrome 120–137 使用开发者模式。通常只需开启一次，无需安装油猴。未开启时仍可读取、保存库脚本，但不能注册注入，不影响其他工具。脚本库由 Agent 通过 `adb_script_library` 管理，用户也可在 Scripts 板块编辑名称、匹配网站和源码，以及启停或删除已有脚本。脚本固定在匹配的 HTTP(S) 顶层页面 `document_start`、页面主环境运行，不提供 `GM_*`、`@require` 等油猴能力；匹配范围和源码的变更在页面下次加载时生效，删除后也需刷新已打开页面以清除原脚本效果。

已启用的库脚本会保存在扩展中，**“停止 MCP”或关闭 Agent 后仍会继续注入匹配的新页面**。让 Agent 通过 `adb_script_library` 停用或删除脚本，再刷新已经打开的页面，才能清除原脚本对当前页面的影响。

## 5. 安装 Skills 并验证

按照所用客户端的技能安装方式，将 **整个** `skills/antidebug-breaker-skills` 目录安装到该客户端支持的技能位置；保留其中的 `SKILL.md`、`references` 和 `agents`，不要只复制一个 Markdown 文件。客户端如有技能导入入口，也可按其要求导入该目录。安装后按客户端要求重新载入技能。

可以向 Agent 发送：

> 请确认已加载 Antidebug_Breaker_skills，并调用 AntiDebug Breaker MCP 的 adb_capabilities 检查连接，再用 adb_list_pages 列出标签页。

技能是否已加载以客户端的技能列表或加载记录为准；`adb_capabilities` 用于确认 MCP 与扩展连接。需要控制网页时，Agent 调用 `adb_connect_browser`，参数 `{}`，即可使用默认扩展通道。扩展 MCP 页的 **“提示词”** 按钮提供三类任务的推荐提示词。

使用脚本库时查看 `adb_capabilities.extension.scriptLibrary`。用户可在扩展 **Scripts** 板块查看并启停已有脚本，无需保持 MCP 连接；开关作用于该脚本全部匹配网站，下次页面加载生效，停用后已打开页面需刷新才能清除原脚本效果。保存和注册成功不等于脚本已运行，Agent 仍需在新文档中验证结果；保存下次导航生效的脚本无需先附加调试会话，要求工具同时刷新时则需要浏览器连接。具体调用示例见 `mcp/README.md` 的“Agent 脚本库”。

## 更新与排查

- **更新配套包**：选择与扩展对应的版本，停止客户端中的旧 MCP 服务，替换本地配套文件，在新的 `mcp` 目录执行 `npm ci`，再启动服务。解压位置改变时同步修改客户端入口路径；更新已安装的整个技能目录。默认个人配对配置在包外，会继续使用，无需重新生成密钥。本次脚本库与 Cookie 清理能力使用扩展 **3.1.1** 和本地 MCP **0.2.0**；请使用同次发布的配套文件，商店更新扩展不会替你更新本地 MCP。
- **手动更新扩展源码**：覆盖文件后，在 `chrome://extensions` 点击扩展的“重新加载”，再刷新已经打开的网站。商店安装的扩展通过原商店条目更新；更新后刷新已有网站以加载新版页面脚本。
- **扩展一直正在连接**：确认客户端的 MCP 服务已启动，地址和密钥与 `setup` 输出一致。`PORT_IN_USE` 通常表示另一个 MCP 进程或手动启动的服务占用了端口。
- **脚本库不可用**：检查扩展详情中的“允许用户脚本”开关，以及 `adb_capabilities.extension.scriptLibrary` 返回的原因和指引。没有 `adb_script_library` 工具时更新并重启本地 MCP；旧扩展也需同步更新。扩展更新后会从保存内容恢复库脚本注册，无需重复创建脚本。
- **Release 页面不可用或找不到配套包**：配套附件需要由项目维护者发布到对应的 GitHub Release。本地打包不会自动上传；Release 尚未发布时页面不可用，附件尚未上传时 **Assets** 中不会出现配套包。确认打开的是对应版本的 Release，或使用维护者提供的同版本配套 ZIP。

完整工具说明见包内 `mcp/README.md`；其开发验证和打包章节面向完整源码仓库，配套包不包含测试与打包工具。
