import { Skill } from "@opencode/schema/skill"
import { Location } from "@opencode/schema/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"
import { ConflictError, InvalidRequestError, SkillNotManagedError, SkillNotFoundError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const SkillGroup = HttpApiGroup.make("server.skill")
  .add(
    HttpApiEndpoint.get("skill.list", "/api/skill", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Skill.Info)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "skill.list",
          summary: "List skills",
          description: "Retrieve currently registered skills.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("skill.install", "/api/skill/install", {
      query: LocationQuery,
      payload: Skill.InstallSource,
      success: Location.response(Schema.Array(Skill.InstallResult)),
      error: [InvalidRequestError, ConflictError, SkillNotFoundError],
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "skill.install",
          summary: "Install skills",
          description:
            "Install skills from a local path, URL, git repository, or built-in catalog index into the global config root and reload the requested location. Refuses to overwrite skill directories that are not managed by the installer.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("skill.uninstall", "/api/skill/uninstall", {
      query: LocationQuery,
      payload: Schema.Struct({ name: Skill.Name }),
      success: HttpApiSchema.NoContent,
      error: [SkillNotManagedError, InvalidRequestError],
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "skill.uninstall",
          summary: "Uninstall skill",
          description:
            "Remove an installed skill from the global config root, clear its manifest entry, and reload the requested location. Only skills managed by the installer can be uninstalled.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("skill.update", "/api/skill/update", {
      query: LocationQuery,
      payload: Schema.Struct({ name: Schema.optional(Skill.Name) }),
      success: Location.response(Schema.Array(Skill.InstallResult)),
      error: [InvalidRequestError, ConflictError, SkillNotFoundError],
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "skill.update",
          summary: "Update skills",
          description:
            "Re-install one managed skill from its recorded source, or every managed skill when no name is given, and reload the requested location.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("skill.installed", "/api/skill/installed", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Skill.ManifestEntry)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "skill.installed",
          summary: "List installed skills",
          description:
            "List the skill manifest entries managed by the installer in the global config root. Compare with skill.list to distinguish user-installed skills from project-discovered ones.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("skill.catalog", "/api/skill/catalog", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Skill.CatalogEntry)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "skill.catalog",
          summary: "List skill catalog",
          description: "List the built-in skill catalog entries available through the index install source.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "skill",
      description: "Experimental skill routes.",
    }),
  )
