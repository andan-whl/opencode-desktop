import { EOL } from "node:os"
import { Effect } from "effect"
import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { errorMessage } from "../../../util/error"
import { ServerConnection } from "../../../services/server-connection"

export const location = { directory: process.cwd() }

export const createClient = Effect.fn("cli.skill.client")(function* () {
  const { endpoint } = yield* ServerConnection.resolve()
  return OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
})

// The installer records content hashes and commit SHAs; print them short, like plugin versions.
export function shortVersion(version: string) {
  return /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(version) ? version.slice(0, 7) : version
}

// Declared API errors keep their tagged fields on the thrown Error, so the installer's 409 is
// recognizable by name.
export function isNotManagedError(error: unknown): error is Error & { readonly skill: string } {
  return error instanceof Error && error.name === "SkillNotManagedError"
}

// Report handler failures as one-line stderr messages instead of letting the runtime dump a cause.
export function reportFailure<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return effect.pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        process.stderr.write(errorMessage(error) + EOL)
        process.exitCode = 1
      }),
    ),
  )
}
