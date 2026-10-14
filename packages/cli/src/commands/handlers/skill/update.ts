import { EOL } from "node:os"
import { Effect, Option } from "effect"
import type { SkillInstallResult } from "@opencode/client"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { createClient, location, reportFailure, shortVersion } from "./shared"

const handler = Effect.fn("cli.skill.update")(function* (name?: string) {
  const client = yield* createClient()
  const response = yield* Effect.tryPromise({
    try: () => client.skill.update({ location, ...(name ? { name } : {}) }),
    catch: (cause) => cause,
  })
  if (!response.data.length) {
    process.stdout.write("No installed skills to update" + EOL)
    return
  }
  process.stdout.write(response.data.map(updateLine).join(EOL) + EOL)
})

export default Runtime.handler(
  Commands.commands.skill.commands.update,
  (input) => reportFailure(handler(Option.getOrUndefined(input.name))),
)

function updateLine(result: SkillInstallResult) {
  const version = shortVersion(result.version)
  if (result.status === "updated") return `Updated skill "${result.name}" to ${version}`
  if (result.status === "installed") return `Reinstalled skill "${result.name}" at ${version}`
  return `Skill "${result.name}" is already up to date (${version})`
}
