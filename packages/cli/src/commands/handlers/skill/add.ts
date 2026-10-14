import { existsSync } from "node:fs"
import { EOL } from "node:os"
import path from "node:path"
import { autocomplete, cancel, intro, isCancel, outro } from "@clack/prompts"
import { Effect, Option } from "effect"
import type { OpenCodeClient, SkillCatalogEntry, SkillInstallSource } from "@opencode/client"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { createClient, location, reportFailure, shortVersion } from "./shared"

const handler = Effect.fn("cli.skill.add")(function* (source?: string) {
  if (!source && !process.stdin.isTTY)
    return yield* Effect.fail(new Error("Pass a skill source when running without an interactive terminal"))
  const client = yield* createClient()
  const ref = source ?? (yield* chooseSkill(client))
  if (!ref) return
  const inferred = inferSource(ref)
  const install = inferred ?? (yield* catalogSource(client, ref))
  const response = yield* Effect.tryPromise({
    try: () => client.skill.install({ location, type: install.type, ref: install.ref }),
    catch: (cause) => cause,
  })
  process.stdout.write(
    response.data
      .map((result) => {
        const version = shortVersion(result.version)
        if (result.status === "noop") return `Skill "${result.name}" is already installed at ${version}`
        const verb = result.status === "installed" ? "Installed" : "Updated"
        return `${verb} skill "${result.name}" ${version}${EOL}  ${result.path}`
      })
      .join(EOL) + EOL,
  )
})

export default Runtime.handler(
  Commands.commands.skill.commands.add,
  (input) => reportFailure(handler(Option.getOrUndefined(input.source))),
)

/**
 * Maps a skill source argument to an install source. Local paths, URLs, and git specifiers are
 * decided here; everything else is left undefined so the caller can resolve it as a catalog name.
 */
export function inferSource(
  source: string,
  exists: (ref: string) => boolean = (ref) => existsSync(ref),
): SkillInstallSource | undefined {
  if (source.startsWith("git@")) return { type: "git", ref: source }
  if (URL.canParse(source)) {
    const url = new URL(source)
    if (url.protocol === "ssh:") return { type: "git", ref: source }
    if (url.protocol === "http:" || url.protocol === "https:")
      return isGitUrl(url) ? { type: "git", ref: source } : { type: "url", ref: source }
  }
  if (exists(source)) return { type: "path", ref: path.resolve(source) }
}

const forgeHosts = new Set(["github.com", "gitlab.com", "bitbucket.org"])

function isGitUrl(url: URL) {
  if (url.pathname.endsWith(".git")) return true
  if (!forgeHosts.has(url.hostname)) return false
  // Plain forge URLs like https://github.com/owner/repo (optionally #subdir) clone directly.
  return url.pathname.split("/").filter((segment) => segment !== "").length === 2
}

function isPathLike(source: string) {
  return (
    source.startsWith(".") ||
    source.startsWith("/") ||
    source.startsWith("\\") ||
    source.startsWith("~") ||
    /^[A-Za-z]:[\\/]/.test(source)
  )
}

const catalogSource = Effect.fn("cli.skill.add.catalog")(function* (client: OpenCodeClient, name: string) {
  if (isPathLike(name)) return yield* Effect.fail(new Error(`Skill source path does not exist: ${name}`))
  const catalog = yield* fetchCatalog(client)
  const entry = matchCatalogEntry(catalog, name)
  if (!entry)
    return yield* Effect.fail(
      new Error(
        `Skill "${name}" is not in the catalog. Available skills: ${catalog.map((item) => item.name).join(", ")}`,
      ),
    )
  return { type: "index" as const, ref: entry.name }
})

function matchCatalogEntry(catalog: ReadonlyArray<SkillCatalogEntry>, name: string) {
  const exact = catalog.find((entry) => entry.name === name)
  if (exact) return exact
  const matches = catalog.filter((entry) => entry.name.toLowerCase() === name.toLowerCase())
  return matches.length === 1 ? matches[0] : undefined
}

const chooseSkill = Effect.fn("cli.skill.add.choose")(function* (client: OpenCodeClient) {
  const catalog = yield* fetchCatalog(client)
  if (!catalog.length) return yield* Effect.fail(new Error("The skill catalog is empty"))
  intro("Add a skill", { output: process.stderr })
  const selected = yield* Effect.tryPromise({
    try: () =>
      autocomplete({
        message: "Select a skill to install",
        maxItems: 10,
        options: catalog
          .toSorted((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
          .map((entry) => ({ label: entry.name, value: entry.name, hint: `${entry.category} - ${entry.description}` })),
        output: process.stderr,
      }),
    catch: (cause) => cause,
  })
  if (isCancel(selected)) {
    cancel("Cancelled", { output: process.stderr })
    process.exitCode = 130
    return undefined
  }
  outro("Installing...", { output: process.stderr })
  return selected
})

const fetchCatalog = Effect.fn("cli.skill.add.catalog.fetch")(function* (client: OpenCodeClient) {
  const response = yield* Effect.tryPromise({
    try: () => client.skill.catalog({ location }),
    catch: (cause) => cause,
  })
  return response.data
})
