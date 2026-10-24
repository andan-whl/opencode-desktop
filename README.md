# OpenCodeDesktop

**OpenCodeDesktop** is a personal AI coding assistant client — a privacy-first independent client based on [opencode](https://github.com/sst/opencode), the open source AI coding agent by SST/Anomaly Innovations. Client version 1.0.16.

This fork keeps opencode's full agent engineering stack and desktop client, but removes everything that phones home. Your API keys, prompts, and code never leave your machine.

[English](./README.md) | [简体中文](./README.zh.md)

## What this fork changes

Removed from the upstream codebase:

- Cloud gateway — the client talks straight to model providers.
- Telemetry and Sentry reporting — nothing is collected or sent.
- Automatic update checks — versions change only when you rebuild.
- Remote tunnels — no way to expose a session from outside.

Kept from upstream:

- The complete agent runtime: sessions, tool calls, permission control, MCP servers, and agent configuration.
- The desktop client and the terminal UI, driven by the same local server.

## Features

- **Privacy first** — with the gateway, telemetry, update checks, and tunnels gone, provider credentials and all session data stay on your machine.
- **Full agent engineering** — sessions, tool calls, permission control, MCP servers, and configurable agents are all intact.
- **40+ model providers** — OpenAI, Anthropic, Google, and more, plus local models through ollama and lmstudio. Switch freely per session or agent.
- **Skill system** — install skills from four kinds of sources:
  - a local path
  - a URL
  - a git repository
  - the built-in catalog

  Managed from both the CLI (`opencode skill add/list/update/remove`) and the GUI (Settings → Skills).
- **Desktop client** — three-pane layout:
  - left: file tree
  - center: CodeMirror editor (Ctrl+S to save, dirty-state markers) with a terminal dock at the bottom
  - right: AI session window
- **TUI** — the full terminal interface, straight from the CLI.
- **Windows installer** — a local electron-builder NSIS x64 package, unsigned, with no auto-update or remote publishing.

## Quick start

Prerequisites: [Bun](https://bun.com) (the repository pins `bun@1.4.x`).

```bash
bun install
```

Run the TUI in development:

```bash
bun run dev
```

Run the desktop client in development:

```bash
bun run dev:desktop
```

The desktop dev script spins up its own isolated local server against the CLI source, with live reload in the renderer.

Attach the development TUI to the installed background server instead of its own:

```bash
bun run dev:live
```

Lint and type-check the whole repository:

```bash
bun run check
```

For faster iteration inside a single package, run `bun typecheck` in that package instead.

Tests run from package directories, not from the repository root:

```bash
bun test # e.g. inside packages/core
```

## Building the Windows installer

The installer bundles a locally built `opencode` CLI into the Electron app, so build the CLI first, then package the desktop. Run `bun install` at the repository root before starting.

### 1. Build the CLI

From `packages/cli`:

```bash
bun run build --single --baseline
```

`--single` limits the build to the current OS and architecture; `--baseline` also emits the baseline (non-AVX2) Windows variant that the desktop bundles on x64. On a Windows x64 host this produces both `cli-windows-x64` and `cli-windows-x64-baseline` under `dist/`. Alternatively, build exactly the target the desktop needs:

```bash
bun run build --target=opencode-windows-x64-baseline
```

The executable lands under `packages/cli/dist/<target>/bin/opencode.exe` — for example `packages/cli/dist/cli-windows-x64-baseline/bin/opencode.exe`. The build compiles a single self-contained executable, so the app ships no separate runtime.

### 2. Package the desktop

From `packages/desktop` (PowerShell):

```powershell
$env:OPENCODE_CHANNEL = "prod"
$env:OPENCODE_CLI_DIST = "D:\path\to\this\repo\packages\cli\dist"
bun run build
bun run package:win
```

`OPENCODE_CLI_DIST` must point at the CLI `dist` directory: the prod prebuild expects `cli-windows-x64-baseline/bin/opencode.exe` inside it and copies that binary into the app resources. The build fails fast if it is missing.

The result is an unsigned NSIS installer at `packages/desktop/dist/OpenCodeDesktop-win-x64.exe`. Everything happens locally — no code signing, no publishing step.

## Repository layout

| Package | Purpose |
| --- | --- |
| `packages/core` | Agent engine: sessions, tools, permissions, model providers, agent configuration |
| `packages/server` | HTTP server exposing the core over the API |
| `packages/protocol` | Public API and event protocol definitions |
| `packages/schema` | Shared schema and type definitions |
| `packages/client` | Generated API client used by the TUI, desktop, and plugins |
| `packages/cli` | The `opencode` CLI: commands, entrypoint, and executable build |
| `packages/tui` | Terminal UI |
| `packages/app` | SolidJS web app that powers the desktop renderer |
| `packages/desktop` | Electron desktop shell and installer packaging |
| `packages/ui` | Shared SolidJS UI components |
| `packages/gui-extensions` | Editor and document GUI extensions embedded in the desktop renderer |
| `packages/plugin` | Plugin definitions and runtime for extensions |
| `packages/util` | Shared utilities |
| `packages/sdk` | Composes client, core, and server for programmatic use |

## Acknowledgements & license

OpenCodeDesktop is a derivative work of [opencode](https://github.com/sst/opencode) by SST/Anomaly Innovations. Many thanks to the opencode team and its contributors for the agent engine, TUI, and desktop app this fork builds on.

Licensed under the [MIT License](./LICENSE), as is the upstream project.
