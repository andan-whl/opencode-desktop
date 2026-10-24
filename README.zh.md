# OpenCodeDesktop

**OpenCodeDesktop** 是一个个人编程助手客户端 —— 基于 [opencode](https://github.com/sst/opencode)（SST/Anomaly Innovations 出品的开源 AI Coding Agent）打造的独立客户端，主打隐私优先。客户端版本 1.0.16。

这个 fork 完整保留了 opencode 的 agent 工程能力和桌面客户端，同时移除了所有会“打电话回家”的部分。你的 API 密钥、提示词和代码始终留在本机。

[English](./README.md) | [简体中文](./README.zh.md)

## 相对上游的改动

已从上游代码中移除：

- 云网关 —— 客户端直接对接模型供应商。
- 遥测与 Sentry 上报 —— 不采集、不上传任何数据。
- 自动更新检查 —— 版本只在你自己重新构建时变化。
- 远程隧道 —— 无法从外部暴露一个会话。

完整保留：

- Agent 运行时的全部能力：会话、工具调用、权限控制、MCP 服务器和 agent 配置。
- 桌面客户端与终端界面，由同一个本地服务驱动。

## 特性

- **隐私优先** —— 云网关、遥测、更新检查、远程隧道全部移除，模型密钥和全部会话数据只存本地。
- **完整的 agent 工程能力** —— 会话、工具调用、权限控制、MCP 服务器、agent 配置一应俱全。
- **40+ 模型供应商** —— OpenAI、Anthropic、Google 等主流厂商，也能通过 ollama、lmstudio 使用本地模型，可按会话或 agent 自由切换。
- **Skill 体系** —— 支持四种安装来源：
  - 本地路径
  - URL
  - Git 仓库
  - 内置索引 catalog

  CLI（`opencode skill add/list/update/remove`）与 GUI（Settings → Skills）双入口管理。
- **桌面客户端** —— 三栏布局：
  - 左侧：文件树
  - 中间：CodeMirror 编辑器（Ctrl+S 保存、带脏状态标记），底部为终端 dock
  - 右侧：AI 会话窗口
- **TUI** —— 完整的终端界面，直接随 CLI 提供。
- **Windows 安装包** —— electron-builder 本地构建的 NSIS x64 安装包，不签名、不远程发布。

## 快速开始

前置条件：[Bun](https://bun.com)（仓库固定使用 `bun@1.4.x`）。

```bash
bun install
```

以开发模式运行 TUI：

```bash
bun run dev
```

以开发模式运行桌面客户端：

```bash
bun run dev:desktop
```

桌面开发脚本会自行启动一个隔离的本地服务并使用 CLI 源码，渲染层支持热重载。

让开发中的 TUI 连接已安装的后台服务，而不是自带的服务：

```bash
bun run dev:live
```

对整个仓库做 lint 和类型检查：

```bash
bun run check
```

如果只在单个 package 内快速迭代，也可以直接在该 package 下执行 `bun typecheck`。

测试请在各 package 目录内运行，不要在仓库根目录跑：

```bash
bun test # 例如在 packages/core 下
```

## 构建 Windows 安装包

安装包会把本地构建的 `opencode` CLI 打进 Electron 应用，因此先构建 CLI，再打包桌面端。开始前请先在仓库根目录执行 `bun install`。

### 1. 构建 CLI

在 `packages/cli` 下执行：

```bash
bun run build --single --baseline
```

`--single` 表示只构建当前系统与架构；`--baseline` 会额外产出 x64 桌面端所需的 baseline（非 AVX2）变体。在 Windows x64 机器上，这条命令会在 `dist/` 下同时产出 `cli-windows-x64` 和 `cli-windows-x64-baseline`。也可以只构建桌面端需要的那个目标：

```bash
bun run build --target=opencode-windows-x64-baseline
```

产物位于 `packages/cli/dist/<target>/bin/opencode.exe`，例如 `packages/cli/dist/cli-windows-x64-baseline/bin/opencode.exe`。构建产物是单文件自包含可执行程序，应用无需附带独立运行时。

### 2. 打包桌面端

在 `packages/desktop` 下执行（PowerShell）：

```powershell
$env:OPENCODE_CHANNEL = "prod"
$env:OPENCODE_CLI_DIST = "D:\path\to\this\repo\packages\cli\dist"
bun run build
bun run package:win
```

`OPENCODE_CLI_DIST` 必须指向 CLI 的 `dist` 目录：prod 预构建会从中找到 `cli-windows-x64-baseline/bin/opencode.exe` 并复制进应用资源，缺文件会直接报错。

产物是未签名的 NSIS 安装包，位于 `packages/desktop/dist/OpenCodeDesktop-win-x64.exe`。整个过程全部在本地完成 —— 不签名，也没有任何发布步骤。

## 仓库结构

| 包 | 职责 |
| --- | --- |
| `packages/core` | Agent 引擎：会话、工具、权限、模型供应商、agent 配置 |
| `packages/server` | 通过 HTTP API 对外暴露 core 的服务器 |
| `packages/protocol` | 公共 API 与事件协议定义 |
| `packages/schema` | 共享的 schema 与类型定义 |
| `packages/client` | 生成的 API 客户端，供 TUI、桌面端和插件使用 |
| `packages/cli` | `opencode` CLI：命令、入口与可执行文件构建 |
| `packages/tui` | 终端界面 |
| `packages/app` | 驱动桌面渲染层的 SolidJS Web 应用 |
| `packages/desktop` | Electron 桌面外壳与安装包打包 |
| `packages/ui` | 共享的 SolidJS UI 组件 |
| `packages/gui-extensions` | 内嵌在桌面渲染层的编辑器与文档 GUI 扩展 |
| `packages/plugin` | 插件定义与运行时 |
| `packages/util` | 共享工具库 |
| `packages/sdk` | 组合 client、core 与 server，供编程方式集成 |

## 致谢与许可

OpenCodeDesktop 基于 SST/Anomaly Innovations 的开源项目 [opencode](https://github.com/sst/opencode) 二次开发。感谢 opencode 团队和所有贡献者打造的 agent 引擎、TUI 与桌面应用，本 fork 站在它们之上。

与上游一样，本项目基于 [MIT License](./LICENSE) 发布。
