export * as Skill from "./skill.js"

import { Schema } from "effect"
import { optional } from "./schema.js"
import { AbsolutePath, DateTimeUtcFromMillis } from "./schema.js"
import { ephemeral, inventory } from "./event.js"

export const ID = Schema.String.pipe(Schema.brand("Skill.ID"), Schema.annotate({ identifier: "Skill.ID" }))
export type ID = typeof ID.Type

export const Name = Schema.String.pipe(Schema.brand("Skill.Name"), Schema.annotate({ identifier: "Skill.Name" }))
export type Name = typeof Name.Type

export interface DirectorySource extends Schema.Schema.Type<typeof DirectorySource> {}
export const DirectorySource = Schema.Struct({
  type: Schema.tag("directory"),
  path: AbsolutePath,
}).annotate({ identifier: "Skill.DirectorySource" })

export interface UrlSource extends Schema.Schema.Type<typeof UrlSource> {}
export const UrlSource = Schema.Struct({
  type: Schema.tag("url"),
  url: Schema.String,
}).annotate({ identifier: "Skill.UrlSource" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  name: Name,
  description: Schema.String.pipe(optional),
  autoinvoke: Schema.Boolean.pipe(optional),
  path: AbsolutePath,
  content: Schema.String,
}).annotate({ identifier: "Skill.Info" })

const Updated = ephemeral({ type: "skill.updated", schema: {} })
export const Event = { Updated, Definitions: inventory(Updated) }

export interface EmbeddedSource extends Schema.Schema.Type<typeof EmbeddedSource> {}
export const EmbeddedSource = Schema.Struct({
  type: Schema.tag("embedded"),
  skill: Schema.suspend(() => Info),
}).annotate({ identifier: "Skill.EmbeddedSource" })

export type Source = DirectorySource | UrlSource | EmbeddedSource
export const Source = Object.assign(
  Schema.Union([DirectorySource, UrlSource, EmbeddedSource]).pipe(
    Schema.toTaggedUnion("type"),
    Schema.annotate({ identifier: "Skill.Source" }),
  ),
  {
    equals: (a: Source, b: Source) => {
      if (a.type !== b.type) return false
      if (a.type === "directory" && b.type === "directory") return a.path === b.path
      if (a.type === "url" && b.type === "url") return a.url === b.url
      if (a.type === "embedded" && b.type === "embedded") return a.skill.id === b.skill.id
      return false
    },
    key: (source: Source) =>
      source.type === "directory"
        ? `directory:${source.path}`
        : source.type === "url"
          ? `url:${source.url}`
          : `embedded:${source.skill.id}`,
  },
)

export interface InstallSource extends Schema.Schema.Type<typeof InstallSource> {}
export const InstallSource = Schema.Struct({
  type: Schema.Literals(["path", "url", "git", "index"]),
  ref: Schema.String,
}).annotate({ identifier: "Skill.InstallSource" })

export interface ManifestEntry extends Schema.Schema.Type<typeof ManifestEntry> {}
export const ManifestEntry = Schema.Struct({
  name: Name,
  source: InstallSource,
  version: Schema.String,
  installedAt: DateTimeUtcFromMillis,
}).annotate({ identifier: "Skill.ManifestEntry" })

export interface Manifest extends Schema.Schema.Type<typeof Manifest> {}
export const Manifest = Schema.Struct({
  version: Schema.Literal(1),
  entries: Schema.Array(ManifestEntry),
}).annotate({ identifier: "Skill.Manifest" })

export const InstallStatus = Schema.Literals(["installed", "updated", "noop"])
export type InstallStatus = typeof InstallStatus.Type

export interface InstallResult extends Schema.Schema.Type<typeof InstallResult> {}
export const InstallResult = Schema.Struct({
  status: InstallStatus,
  name: Name,
  version: Schema.String,
  path: AbsolutePath,
}).annotate({ identifier: "Skill.InstallResult" })

export interface CatalogSource extends Schema.Schema.Type<typeof CatalogSource> {}
export const CatalogSource = Schema.Struct({
  type: Schema.Literals(["git", "url"]),
  ref: Schema.String,
}).annotate({ identifier: "Skill.CatalogSource" })

export interface CatalogEntry extends Schema.Schema.Type<typeof CatalogEntry> {}
export const CatalogEntry = Schema.Struct({
  name: Name,
  description: Schema.String,
  category: Schema.String,
  source: CatalogSource,
}).annotate({ identifier: "Skill.CatalogEntry" })

export interface Catalog extends Schema.Schema.Type<typeof Catalog> {}
export const Catalog = Schema.Struct({
  version: Schema.Literal(1),
  entries: Schema.Array(CatalogEntry),
}).annotate({ identifier: "Skill.Catalog" })
