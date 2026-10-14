import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Effect } from "effect"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { startServer } from "./fixture/server"

const skillMd = (name: string) => `---\nname: ${name}\ndescription: ${name} skill\n---\n# ${name}\n`

it.live(
  "serves the skill catalog and manages installs over the HTTP API",
  () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const project = path.join(tmp.path, "project")
      const source = path.join(tmp.path, "source", "test-skill")
      yield* Effect.promise(async () => {
        await fs.mkdir(project, { recursive: true })
        await fs.mkdir(source, { recursive: true })
        await fs.writeFile(path.join(source, "SKILL.md"), skillMd("test-skill"))
      })
      const configRoot = path.join(tmp.path, "config")
      const server = yield* startServer(configRoot)
      const request = (route: string, init?: BunFetchRequestInit) => {
        const url = new URL(route, server.base)
        url.searchParams.set("location[directory]", project)
        return Effect.promise(() => fetch(url, { ...init, headers: { ...server.headers, ...init?.headers } }))
      }
      const post = (route: string, body: unknown) =>
        request(route, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        })

      const catalog = yield* request("/api/skill/catalog")
      expect(catalog.status).toBe(200)
      const catalogBody = yield* Effect.promise(() => catalog.json())
      expect(catalogBody.data.length).toBeGreaterThan(0)
      expect(catalogBody.data[0]).toMatchObject({
        name: expect.any(String),
        description: expect.any(String),
        category: expect.any(String),
        source: { type: expect.any(String), ref: expect.any(String) },
      })

      const before = yield* request("/api/skill/installed")
      expect(before.status).toBe(200)
      expect(yield* Effect.promise(() => before.json())).toMatchObject({ data: [] })

      const install = yield* post("/api/skill/install", { type: "path", ref: source })
      expect(install.status).toBe(200)
      const installBody = yield* Effect.promise(() => install.json())
      expect(installBody.data).toHaveLength(1)
      expect(installBody.data[0]).toMatchObject({ status: "installed", name: "test-skill" })
      expect(installBody.data[0].path).toBe(path.join(configRoot, "skills", "test-skill"))

      const installed = yield* request("/api/skill/installed")
      expect(installed.status).toBe(200)
      expect(yield* Effect.promise(() => installed.json())).toMatchObject({
        data: [{ name: "test-skill", source: { type: "path", ref: source } }],
      })

      const update = yield* post("/api/skill/update", {})
      expect(update.status).toBe(200)
      expect(yield* Effect.promise(() => update.json())).toMatchObject({
        data: [{ status: "noop", name: "test-skill" }],
      })

      const uninstall = yield* post("/api/skill/uninstall", { name: "test-skill" })
      expect(uninstall.status).toBe(204)
      expect(
        yield* Effect.promise(() => Bun.file(path.join(configRoot, "skills", "test-skill", "SKILL.md")).exists()),
      ).toBe(false)

      yield* Effect.promise(async () => {
        await fs.mkdir(path.join(configRoot, "skills", "unmanaged"), { recursive: true })
        await fs.writeFile(path.join(configRoot, "skills", "unmanaged", "SKILL.md"), skillMd("unmanaged"))
      })
      const unmanaged = yield* post("/api/skill/uninstall", { name: "unmanaged" })
      expect(unmanaged.status).toBe(409)
      expect(yield* Effect.promise(() => unmanaged.json())).toMatchObject({ _tag: "SkillNotManagedError" })
    }),
  15_000,
)
