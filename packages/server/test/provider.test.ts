import { expect } from "bun:test"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { Plugin } from "@opencode/plugin/effect"
import { Context, Deferred, Effect, Fiber, Layer } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { createRoutes } from "../src/routes"
import { startServer } from "./fixture/server"

it.live(
  "provider reads stay nonblocking while authentication discovery waits for plugins",
  () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped("opencode-provider-endpoints-")
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const context = yield* Layer.build(
        createRoutes({
          password: "secret",
          database: { path: ":memory:" },
          models: { fetch: false },
          fs: { filewatcher: false },
          config: {
            directory: tmp.path,
            project: false,
            content: JSON.stringify({
              providers: {
                custom: {
                  name: "Configured Custom Provider",
                  package: "@opencode/ai/providers/openai-compatible",
                  settings: { apiKey: "secret" },
                  models: { chat: {} },
                },
              },
            }),
          },
        }).pipe(Layer.provide(HttpServer.layerServices)),
      )
      const sdk = Context.get(context, SdkPlugins.Service)
      yield* sdk.register(
        Plugin.define({
          id: "slow-plugin",
          effect: () =>
            Effect.gen(function* () {
              yield* Deferred.succeed(started, undefined)
              yield* Deferred.await(release)
            }),
        }),
      )
      const handler = Context.get(context, HttpRouter.HttpRouter)
        .asHttpEffect()
        .pipe(HttpEffect.toWebHandlerWith(context))
      const request = (method: "GET" | "POST", route: string) =>
        Effect.promise((signal) => {
          const url = new URL(route, "http://opencode.local")
          url.searchParams.set("location[directory]", tmp.path)
          return handler(
            new Request(url, {
              method,
              headers: { authorization: `Basic ${btoa("opencode:secret")}` },
              signal,
            }),
          )
        })
      // Config providers activate after SDK plugins; reads must return the current snapshot without waiting.
      const list = yield* request("GET", "/api/provider").pipe(Effect.timeout("2 seconds"))
      yield* Deferred.await(started)
      const integrations = yield* request("GET", "/api/integration").pipe(Effect.forkScoped)
      expect(list.status).toBe(200)
      expect(yield* Effect.promise(() => list.json())).toMatchObject({
        location: { directory: tmp.path },
        data: expect.not.arrayContaining([expect.objectContaining({ id: "custom" })]),
      })
      const get = yield* request("GET", "/api/provider/custom").pipe(Effect.timeout("2 seconds"))
      expect(get.status).toBe(404)
      expect(yield* Effect.promise(() => get.json())).toMatchObject({
        _tag: "ProviderNotFoundError",
        providerID: "custom",
      })
      yield* Deferred.succeed(release, undefined)
      const discovered = yield* Fiber.join(integrations)
      expect(discovered.status).toBe(200)
      expect(yield* Effect.promise(() => discovered.json())).toMatchObject({
        data: expect.arrayContaining([expect.objectContaining({ id: "opencode" })]),
      })
    }),
  15_000,
)

it.live("fork catalog providers connect only through a manually entered key", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped("opencode-fork-providers-")
    const server = yield* startServer(tmp.path)
    // integration.get and connect/key do not wait for plugin activation, so poll the same
    // location until the catalog populates before connecting.
    const integration = yield* pollIntegration(server, "volcengine-agent-plan", tmp.path)
    const info = (yield* Effect.promise(() => integration.json())) as {
      data: { id: string; name: string; methods: { type: string; names?: string[] }[]; connections: unknown[] }
    }
    expect(info.data.id).toBe("volcengine-agent-plan")
    expect(info.data.name).toBe("Volcengine Ark Agent Plan")
    // Key-only: no env method, and nothing connects on its own.
    expect(info.data.methods.map((method) => method.type)).toEqual(["key"])
    expect(info.data.connections).toEqual([])

    // Models only appear after a manual key connection, and the connection is removable.
    const connectUrl = new URL("/api/integration/volcengine-agent-plan/connect/key", server.base)
    connectUrl.searchParams.set("location[directory]", tmp.path)
    const connected = yield* Effect.promise(() =>
      fetch(connectUrl, {
        method: "POST",
        headers: { ...server.headers, "content-type": "application/json" },
        body: JSON.stringify({ key: "test-key" }),
      }),
    )
    if (connected.status !== 204) throw new Error(`connect/key ${connected.status}: ${yield* Effect.promise(() => connected.text())}`)
    expect(connected.status).toBe(204)

    const modelsUrl = new URL("/api/model", server.base)
    modelsUrl.searchParams.set("location[directory]", tmp.path)
    const models = yield* Effect.promise(() => fetch(modelsUrl, { headers: server.headers }))
    const body = (yield* Effect.promise(() => models.json())) as {
      data: { providerID: string; id: string; limit: { context: number; output: number } }[]
    }
    const planModels = body.data.filter((model) => model.providerID === "volcengine-agent-plan")
    expect(planModels.map((model) => model.id).sort()).toEqual(
      [
        "ark-code-latest",
        "doubao-seed-2.1-pro",
        "doubao-seed-evolving",
        "glm-5.3",
        "glm-5.3-flash",
        "glm-latest",
        "deepseek-v4.1-flash",
        "deepseek-v4-flash",
        "deepseek-v4-pro",
        "doubao-seed-2.1-lite",
        "doubao-seed-2.0-mini",
        "minimax-m3",
        "kimi-k2.8-preview",
      ].sort(),
    )
    const arkCode = planModels.find((model) => model.id === "ark-code-latest")
    expect(arkCode?.limit).toEqual({ context: 256000, output: 32000 })

    // The stored credential connection is removable, matching every other provider.
    const connected2 = yield* pollIntegration(server, "volcengine-agent-plan", tmp.path)
    const info2 = (yield* Effect.promise(() => connected2.json())) as {
      data: { connections: { type: string; id: string }[] }
    }
    const connection = info2.data.connections[0]
    expect(connection?.type).toBe("credential")
    const removed = yield* Effect.promise(() =>
      fetch(new URL(`/api/credential/${connection.id}`, server.base), {
        method: "DELETE",
        headers: server.headers,
      }),
    )
    expect(removed.status).toBe(204)

    const modelsAfter = yield* Effect.promise(() => fetch(modelsUrl, { headers: server.headers }))
    const bodyAfter = (yield* Effect.promise(() => modelsAfter.json())) as {
      data: { providerID: string }[]
    }
    expect(bodyAfter.data.filter((model) => model.providerID === "volcengine-agent-plan")).toEqual([])
  }),
)

function pollIntegration(
  server: { base: string; headers: Record<string, string> },
  integrationID: string,
  directory: string,
) {
  const attempt = (remaining: number): Effect.Effect<Response, Error> =>
    Effect.promise(() => {
      const url = new URL(`/api/integration/${integrationID}`, server.base)
      url.searchParams.set("location[directory]", directory)
      return fetch(url, { headers: server.headers })
    }).pipe(
      Effect.andThen((response) =>
        response.status === 200
          ? Effect.succeed(response)
          : remaining <= 0
            ? Effect.fail(new Error(`integration ${integrationID} did not appear: ${response.status}`))
            : Effect.sleep("250 millis").pipe(Effect.andThen(() => attempt(remaining - 1))),
      ),
    )
  return attempt(20)
}
