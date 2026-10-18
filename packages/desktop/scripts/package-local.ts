#!/usr/bin/env bun
import { $ } from "bun"
import { existsSync } from "node:fs"
import { join } from "node:path"

// One-command local Windows packaging that avoids the things that stall a plain
// `bun run package:win` here: electron-builder's default cache lives in LOCALAPPDATA and
// downloads its tools (NSIS, 7zip) from GitHub, which hangs on this network, and
// `package:full` builds the CLI for all 12 platform targets. This pins the download
// mirrors, keeps every cache inside the repo's gitignored .cache, builds only the host's
// CLI target, and skips that build entirely when its output already exists.
const root = join(import.meta.dirname, "../..")

const cache = join(import.meta.dirname, "../.cache")

const cliTarget = "opencode-windows-x64-baseline"

const cliDist = join(root, "cli/dist", cliTarget, "bin", "opencode.exe")

process.env.ELECTRON_MIRROR ??= "https://npmmirror.com/mirrors/electron/"

process.env.ELECTRON_CACHE ??= join(cache, "electron")

process.env.ELECTRON_BUILDER_CACHE ??= join(cache, "electron-builder")

process.env.ELECTRON_BUILDER_BINARIES_MIRROR ??= "https://npmmirror.com/mirrors/electron-builder/"

if (!existsSync(cliDist)) await $`bun run --cwd ${join(root, "cli")} build -- --target=${cliTarget}`

await $`bun run build`

await $`bun ./scripts/prebuild.ts`

await $`electron-builder --win --publish never --config electron-builder.config.ts`
