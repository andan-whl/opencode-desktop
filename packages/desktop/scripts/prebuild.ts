#!/usr/bin/env bun
import { $ } from "bun"
import { existsSync } from "node:fs"
import { join } from "node:path"

import { copyBuiltCliToResources, getCurrentCli, resolveChannel } from "./utils"

const channel = resolveChannel()

await $`bun ./scripts/copy-icons.ts ${channel}`

await $`bun ./scripts/copy-metainfo.ts ${channel}`

// This fork bundles its own CLI: the npm @opencode/* packages are upstream builds whose protocol
// does not match this renderer (their /api/event stream fails as UnsupportedContentType), so
// prebuild never downloads. OPENCODE_CLI_DIST overrides; otherwise the local packages/cli/dist
// build is used and must exist.
const cliDist = Bun.env.OPENCODE_CLI_DIST ?? join(import.meta.dirname, "../../cli/dist")
const target = getCurrentCli().package.replace("@opencode/", "")

if (!existsSync(join(cliDist, target))) {
  throw new Error(
    `No ${target} in ${cliDist}: build the CLI first with "bun run --cwd packages/cli build", or point OPENCODE_CLI_DIST at a distribution.`,
  )
}

await copyBuiltCliToResources(cliDist)
