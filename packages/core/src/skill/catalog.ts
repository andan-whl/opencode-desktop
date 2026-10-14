export * as SkillCatalog from "./catalog.js"

import raw from "./catalog.json" with { type: "json" }
import { Context, Effect, Layer, Option, Schema } from "effect"
import { Skill } from "@opencode/schema/skill"
import { makeGlobalNode } from "@opencode/util/effect/app-node"

export interface Interface {
  readonly list: () => Effect.Effect<ReadonlyArray<Skill.CatalogEntry>>
  readonly resolve: (name: string) => Effect.Effect<Skill.CatalogEntry | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SkillCatalog") {}

const catalog = Option.getOrThrow(Schema.decodeUnknownOption(Skill.Catalog)(raw))

const layer = Layer.succeed(
  Service,
  Service.of({
    list: () => Effect.sync(() => catalog.entries),
    resolve: (name) => Effect.sync(() => catalog.entries.find((entry) => entry.name === name)),
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
