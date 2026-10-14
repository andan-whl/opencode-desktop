import { EOL } from "node:os"
import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { createClient, isNotManagedError, location, reportFailure } from "./shared"

const handler = Effect.fn("cli.skill.remove")(function* (name: string) {
  const client = yield* createClient()
  yield* Effect.tryPromise({
    try: () => client.skill.uninstall({ location, name }),
    catch: (cause) => cause,
  }).pipe(
    Effect.catch((error) =>
      isNotManagedError(error)
        ? Effect.fail(
            new Error(
              `Skill "${name}" was not installed with "opencode skill add", so it cannot be removed with this command. Remove it from the project or configuration that provides it.`,
            ),
          )
        : Effect.fail(error),
    ),
  )
  process.stdout.write(`Skill "${name}" removed${EOL}`)
})

export default Runtime.handler(
  Commands.commands.skill.commands.remove,
  (input) => reportFailure(handler(input.name)),
)
