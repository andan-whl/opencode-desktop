import { Skill } from "@opencode/core/skill"
import { SkillCatalog } from "@opencode/core/skill/catalog"
import { SkillInstall } from "@opencode/core/skill/install"
import { ConflictError, InvalidRequestError, SkillNotManagedError, SkillNotFoundError } from "@opencode/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/http-api"
import { Api } from "../api"
import { response } from "../location"

export const SkillHandler = HttpApiBuilder.group(Api, "server.skill", (handlers) =>
  Effect.gen(function* () {
    const catalog = yield* SkillCatalog.Service
    return handlers
      .handle("skill.list", () => response(Skill.Service.use((skill) => skill.list())))
      .handle(
        "skill.install",
        Effect.fn("server.skill.install")(function* (ctx) {
          return yield* response(
            SkillInstall.Service.use((install) => install.install(ctx.payload)).pipe(installErrors),
          )
        }),
      )
      .handle(
        "skill.uninstall",
        Effect.fn("server.skill.uninstall")(function* (ctx) {
          yield* SkillInstall.Service.use((install) => install.uninstall(ctx.payload.name)).pipe(uninstallErrors)
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "skill.update",
        Effect.fn("server.skill.update")(function* (ctx) {
          return yield* response(
            Effect.gen(function* () {
              const install = yield* SkillInstall.Service
              const names = ctx.payload.name
                ? [ctx.payload.name]
                : (yield* install.list()).map((entry) => entry.name)
              return yield* Effect.forEach(names, (name) => install.update(name))
            }).pipe(installErrors),
          )
        }),
      )
      .handle("skill.installed", () =>
        response(SkillInstall.Service.use((install) => install.list()).pipe(Effect.orDie)),
      )
      .handle("skill.catalog", () => response(catalog.list()))
  }),
)

// The orElse fallback only sees upstream errors whose tag is not in the table, so the
// protocol errors produced by the table can never be re-captured here.
const installErrors = <A, R>(effect: Effect.Effect<A, SkillInstall.Error, R>) =>
  effect.pipe(
    Effect.catchTags(
      {
        "SkillInstall.NotFoundError": (error) =>
          new SkillNotFoundError({ skill: Skill.ID.make(error.name), message: `Skill not found: ${error.name}` }),
        "SkillInstall.ConflictError": (error) =>
          new ConflictError({
            message: `Skill directory exists and is not managed by the installer: ${error.name}`,
            resource: error.name,
          }),
        "SkillInstall.InvalidError": (error) =>
          new InvalidRequestError({ message: `${error.name}: ${error.reason}`, kind: "skill_invalid" }),
        "SkillInstall.SourceError": (error) =>
          new InvalidRequestError({ message: `${error.ref}: ${error.message}`, kind: "skill_source" }),
        "SkillInstall.GitError": (error) => new InvalidRequestError({ message: error.message, kind: "skill_git" }),
      },
      (error) => Effect.fail(new InvalidRequestError({ message: error.message, kind: "skill_source" })),
    ),
  )

const uninstallErrors = <A, R>(effect: Effect.Effect<A, SkillInstall.Error, R>) =>
  effect.pipe(
    Effect.catchTags(
      {
        "SkillInstall.NotManagedError": (error) =>
          new SkillNotManagedError({
            skill: Skill.Name.make(error.name),
            message: `Skill is not managed by the installer: ${error.name}`,
          }),
      },
      (error) => Effect.fail(new InvalidRequestError({ message: error.message, kind: "skill_uninstall" })),
    ),
  )
