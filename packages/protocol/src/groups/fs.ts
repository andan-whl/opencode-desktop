import { FileSystem } from "@opencode/schema/filesystem"
import { Location } from "@opencode/schema/location"
import { PositiveInt } from "@opencode/schema/schema"
import { Schema, SchemaGetter } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"
import { FileNotFoundError, InvalidRequestError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

const ListQuery = Schema.Struct({
  ...LocationQuery.fields,
  path: Schema.String.pipe(Schema.optional).annotate({
    description: "An absolute path or a path relative to the requested location. Defaults to the location directory.",
  }),
})

const WriteQuery = Schema.Struct({
  ...LocationQuery.fields,
  path: Schema.String.annotate({
    description:
      "An absolute path or a path relative to the requested location. Missing parent directories are created.",
  }),
})

const FindQuery = Schema.Struct({
  ...LocationQuery.fields,
  query: FileSystem.FindInput.fields.query,
  type: FileSystem.FindInput.fields.type,
  limit: Schema.NumberFromString.pipe(Schema.decodeTo(PositiveInt), Schema.optional),
})

// effect 4 ships no BooleanFromString; query strings carry booleans as "true"/"false".
const BooleanFromString = Schema.Literals(["true", "false"]).pipe(
  Schema.decodeTo(Schema.Boolean, {
    decode: SchemaGetter.transform((value) => value === "true"),
    encode: SchemaGetter.transform((value) => (value ? "true" : "false")),
  }),
)

const GrepQuery = Schema.Struct({
  ...LocationQuery.fields,
  pattern: Schema.String.annotate({ description: "Regex pattern, or a literal when literal is true." }),
  include: Schema.String.pipe(Schema.optional).annotate({
    description: "Optional glob restricting which files are searched, e.g. *.ts",
  }),
  literal: Schema.optional(BooleanFromString).annotate({ description: "Match the pattern literally." }),
  caseSensitive: Schema.optional(BooleanFromString).annotate({
    description: "Defaults to case-sensitive matching.",
  }),
  limit: Schema.NumberFromString.pipe(Schema.decodeTo(PositiveInt), Schema.optional),
})

export const FileSystemGroup = HttpApiGroup.make("server.fs")
  .add(
    HttpApiEndpoint.get("fs.read", "/api/fs/read/*", {
      query: LocationQuery,
      success: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
      error: FileNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "fs.read",
          summary: "Read file",
          description:
            "Stream one file relative to the requested location with ETag, Last-Modified, and single-range HTTP Range support (206 Partial Content, 416 Range Not Satisfiable, and 304 Not Modified; multi-range and malformed Range headers fall back to 200).",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("fs.list", "/api/fs/list", {
      query: ListQuery,
      success: Location.response(Schema.Array(FileSystem.Entry)),
      error: FileNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "fs.list",
          summary: "List directory",
          description:
            "List direct children using an absolute path or a path relative to the requested location, including parents and siblings outside its directory. Entry paths remain relative to the requested location; listing does not switch locations.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("fs.find", "/api/fs/find", {
      query: FindQuery,
      success: Location.response(Schema.Array(FileSystem.Entry)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "fs.find",
          summary: "Find files",
          description: "Find recursively ranked filesystem entries relative to the requested location.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("fs.grep", "/api/fs/grep", {
      query: GrepQuery,
      success: Location.response(Schema.Array(FileSystem.Match)),
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "fs.grep",
          summary: "Search file content",
          description:
            "Search file content with a regex (or literal) pattern relative to the requested location, returning matches with line numbers and submatch offsets.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("fs.write", "/api/experimental/fs/write", {
      query: WriteQuery,
      payload: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
      success: Location.response(FileSystem.Write),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.fs.write",
          summary: "Write file",
          description:
            "Write the raw request body to an absolute path or a path relative to the requested location, creating parent directories, and return the resolved absolute path. Unlike read, the target is not confined to the location. Experimental: may change without compatibility guarantees.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "filesystem",
      description: "Experimental location-scoped filesystem routes.",
    }),
  )
