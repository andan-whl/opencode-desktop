import { EOL } from "node:os"
import { Effect } from "effect"
import type { SkillInfo, SkillManifestEntry } from "@opencode/client"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { createClient, location, reportFailure, shortVersion } from "./shared"

const handler = Effect.fn("cli.skill.list")(function* () {
  const client = yield* createClient()
  const installed = yield* Effect.tryPromise({
    try: () => client.skill.installed({ location }),
    catch: (cause) => cause,
  })
  const registered = yield* Effect.tryPromise({
    try: () => client.skill.list({ location }),
    catch: (cause) => cause,
  })
  const output = format(installed.data, registered.data)
  process.stdout.write((output || "No skills found") + EOL)
})

export default Runtime.handler(
  Commands.commands.skill.commands.list,
  () => reportFailure(handler()),
)

// Managed manifest entries come first; registered skills the installer does not manage are
// listed separately so users can see what `skill remove` can and cannot touch.
function format(installed: ReadonlyArray<SkillManifestEntry>, registered: ReadonlyArray<SkillInfo>) {
  const managed = new Set(installed.map((entry) => entry.name))
  const discovered = registered
    .filter((skill) => !managed.has(skill.name))
    .toSorted((a, b) => a.name.localeCompare(b.name))
  const sections: string[] = []
  if (installed.length)
    sections.push(
      table(
        ["NAME", "VERSION", "SOURCE", "INSTALLED"],
        installed
          .toSorted((a, b) => a.name.localeCompare(b.name))
          .map((entry) => [
            entry.name,
            shortVersion(entry.version),
            `${entry.source.type}:${entry.source.ref}`,
            new Date(entry.installedAt).toLocaleString(),
          ]),
      ),
    )
  if (discovered.length)
    sections.push(
      `Discovered (from the project, configuration, or built-in):${EOL}` +
        table(
          ["NAME", "SOURCE"],
          discovered.map((skill) => [skill.name, skill.path]),
        ),
    )
  return sections.join(EOL + EOL)
}

function table(header: ReadonlyArray<string>, rows: ReadonlyArray<ReadonlyArray<string>>) {
  const all = [header, ...rows]
  const widths = header.map((_, index) => Math.max(...all.map((row) => row[index].length)))
  return all
    .map((row) =>
      row
        .map((cell, index) => cell.padEnd(widths[index]))
        .join("  ")
        .trimEnd(),
    )
    .join(EOL)
}
