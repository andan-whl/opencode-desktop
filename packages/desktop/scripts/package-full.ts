#!/usr/bin/env bun
import { $ } from "bun"
import { join } from "node:path"

// One-command release pipeline: build the CLI, copy it into resources (prebuild),
// then run electron-builder. Forward extra arguments, defaulting to a Windows build.
const root = join(import.meta.dirname, "../..")
const target = Bun.argv.slice(2)
const platform = target.length > 0 ? target : ["--win"]

await $`bun run --cwd ${join(root, "cli")} build`
await $`bun ./scripts/prebuild.ts`
await $`electron-builder ${platform} --config electron-builder.config.ts`
