import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Config } from "@opencode/core/config"
import { Directory } from "@opencode/schema/config"
import { ConfigCompatibilityPlugin } from "@opencode/core/config/plugin/compatibility"
import { ConfigSkillPlugin } from "@opencode/core/config/plugin/skill"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Bus } from "@opencode/core/bus"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { Location } from "@opencode/core/location"
import { AbsolutePath } from "@opencode/core/schema"
import { Skill } from "@opencode/core/skill"
import { SkillCatalog } from "@opencode/core/skill/catalog"
import { SkillDiscovery } from "@opencode/core/skill/discovery"
import { SkillInstall } from "@opencode/core/skill/install"
import { gitExecutable } from "@opencode/core/util/git-executable"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { tmpdir } from "./fixture/tmpdir"
import { location } from "./fixture/location"
import { it } from "./lib/effect"
import { host } from "./plugin/host"

const skillMd = (name: string, description = `${name} skill`) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`

const commitGit = (cwd: string) =>
  runGit(cwd, ["-c", "user.name=test", "-c", "user.email=test@test.test", "commit", "-m", "change"])

async function runGit(cwd: string, args: string[]) {
  const proc = Bun.spawn({ cmd: [gitExecutable, ...args], cwd, stdout: "pipe", stderr: "pipe", stdin: "ignore" })
  const exitCode = await proc.exited
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${await new Response(proc.stderr).text()}`)
}

async function initRepo(dir: string, files: Record<string, string>) {
  await fs.mkdir(dir, { recursive: true })
  for (const [file, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true })
    await fs.writeFile(path.join(dir, file), content)
  }
  await runGit(dir, ["init"])
  await runGit(dir, ["add", "."])
  await commitGit(dir)
}

type TestContext = {
  readonly tmp: { readonly path: string }
  readonly configRoot: string
  readonly skillsRoot: string
  readonly skill: Skill.Interface
  readonly install: SkillInstall.Interface
}

// The body runs inside the layer-provided effect: Effect.provide closes the layer scope (and the
// watcher subscriptions with it) when the wrapped effect finishes, so the whole test must execute
// before the layer can unwind.
const fixture = <A, E, R>(body: (ctx: TestContext) => Effect.Effect<A, E, R>, catalog?: SkillCatalog.Interface) =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir()))
    const configRoot = path.join(tmp.path, "config")
    const projectDir = path.join(tmp.path, "project")
    yield* Effect.promise(() =>
      fs.mkdir(configRoot, { recursive: true }).then(() => fs.mkdir(projectDir, { recursive: true })),
    )

    const layer = AppNodeBuilder.build(
      LayerNode.group([Skill.node, Bus.node, FSUtil.node, Watcher.node, SkillInstall.node]),
      [
        Global.node.replace(
          Global.layerWith({
            config: configRoot,
            home: path.join(tmp.path, "home"),
            cache: path.join(tmp.path, "cache"),
          }),
        ),
        Location.node.replace(
          Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(projectDir) }))),
        ),
        ...(catalog
          ? [
              SkillCatalog.node.replace(
                makeGlobalNode({
                  service: SkillCatalog.Service,
                  layer: Layer.succeed(SkillCatalog.Service, SkillCatalog.Service.of(catalog)),
                  deps: [],
                }),
              ),
            ]
          : []),
      ],
    )

    yield* Effect.gen(function* () {
      const skill = yield* Skill.Service
      const install = yield* SkillInstall.Service
      const pluginHost = host({
        skill: {
          list: () => Effect.die("unused skill.list"),
          install: () => Effect.die("unused skill.install"),
          uninstall: () => Effect.die("unused skill.uninstall"),
          update: () => Effect.die("unused skill.update"),
          installed: () => Effect.die("unused skill.installed"),
          catalog: () => Effect.die("unused skill.catalog"),
          transform: skill.transform,
          reload: skill.reload,
        },
      })
      const entries = [new Directory({ type: "directory", path: AbsolutePath.make(configRoot) })]
      yield* ConfigCompatibilityPlugin.Plugin.effect(pluginHost).pipe(Effect.provide(Config.testLayer(entries)))
      yield* ConfigSkillPlugin.Plugin.effect(pluginHost).pipe(
        Effect.provide(Config.testLayer(entries)),
        Effect.provideService(SkillDiscovery.Service, SkillDiscovery.Service.of({ pull: () => Effect.succeed([]) })),
        Effect.provideService(
          Global.Service,
          Global.Service.of({ ...Global.make(), config: configRoot, home: path.join(tmp.path, "home") }),
        ),
        Effect.provideService(
          Location.Service,
          Location.Service.of(location({ directory: AbsolutePath.make(projectDir) })),
        ),
      )
      return yield* body({ tmp, configRoot, skillsRoot: path.join(configRoot, "skills"), skill, install })
    }).pipe(Effect.provide(layer))
  })

const serve = (routes: Record<string, () => Response>) =>
  Effect.acquireDisposable(
    Effect.sync(() => {
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: (request) =>
          (routes[new URL(request.url).pathname] ?? (() => new Response("Not Found", { status: 404 })))(),
      })
      return {
        port: server.port,
        [Symbol.asyncDispose]: async () => {
          await server.stop(true)
        },
      }
    }),
  )

describe("SkillInstall", () => {
  it.live(
    "installs a local skill directory, records the manifest, and lists the skill",
    fixture((ctx) =>
      Effect.gen(function* () {
        const source = path.join(ctx.tmp.path, "source", "test-skill")
        yield* Effect.promise(() => fs.mkdir(source, { recursive: true }).then(() => fs.writeFile(path.join(source, "SKILL.md"), skillMd("test-skill"))))

        const results = yield* ctx.install.install({ type: "path", ref: source })
        expect(results).toHaveLength(1)
        expect(results[0].status).toBe("installed")
        expect(String(results[0].name)).toBe("test-skill")
        expect(String(results[0].path)).toBe(path.join(ctx.skillsRoot, "test-skill"))

        expect(yield* Effect.promise(() => fs.readFile(path.join(ctx.skillsRoot, "test-skill", "SKILL.md"), "utf8"))).toBe(
          skillMd("test-skill"),
        )
        const entries = yield* ctx.install.list()
        expect(entries.map((entry) => String(entry.name))).toEqual(["test-skill"])
        expect(entries[0].source).toEqual({ type: "path", ref: source })
        expect(entries[0].version).toMatch(/^[0-9a-f]{64}$/)
        const manifest = JSON.parse(
          yield* Effect.promise(() => fs.readFile(path.join(ctx.configRoot, "skills.json"), "utf8")),
        )
        expect(manifest.version).toBe(1)
        expect(manifest.entries).toHaveLength(1)
        expect((yield* ctx.skill.list()).map((item) => String(item.id))).toContain("test-skill")
      }),
    ),
  )

  it.live(
    "installs a single SKILL.md file under its frontmatter name",
    fixture((ctx) =>
      Effect.gen(function* () {
        const source = path.join(ctx.tmp.path, "solo.md")
        yield* Effect.promise(() => fs.writeFile(source, skillMd("solo")))

        const results = yield* ctx.install.install({ type: "path", ref: source })
        expect(results).toHaveLength(1)
        expect(String(results[0].name)).toBe("solo")
        expect(yield* Effect.promise(() => fs.readFile(path.join(ctx.skillsRoot, "solo", "SKILL.md"), "utf8"))).toBe(
          skillMd("solo"),
        )
        expect((yield* ctx.skill.list()).map((item) => String(item.id))).toContain("solo")
      }),
    ),
  )

  it.live(
    "uninstalls managed skills and clears their manifest entries",
    fixture((ctx) =>
      Effect.gen(function* () {
        const source = path.join(ctx.tmp.path, "source", "test-skill")
        yield* Effect.promise(() => fs.mkdir(source, { recursive: true }).then(() => fs.writeFile(path.join(source, "SKILL.md"), skillMd("test-skill"))))
        yield* ctx.install.install({ type: "path", ref: source })

        yield* ctx.install.uninstall("test-skill")
        expect(yield* Effect.promise(() => Bun.file(path.join(ctx.skillsRoot, "test-skill", "SKILL.md")).exists())).toBe(false)
        expect(yield* ctx.install.list()).toEqual([])
      }),
    ),
  )

  it.live(
    "refuses to uninstall skills that are not managed by the manifest",
    fixture((ctx) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          fs
            .mkdir(path.join(ctx.skillsRoot, "unmanaged"), { recursive: true })
            .then(() => fs.writeFile(path.join(ctx.skillsRoot, "unmanaged", "SKILL.md"), skillMd("unmanaged"))),
        )

        const error = yield* ctx.install.uninstall("unmanaged").pipe(Effect.flip)
        expect(error._tag).toBe("SkillInstall.NotManagedError")
        expect(yield* Effect.promise(() => Bun.file(path.join(ctx.skillsRoot, "unmanaged", "SKILL.md")).exists())).toBe(true)
      }),
    ),
  )

  it.live(
    "refuses to overwrite unmanaged skill directories on name conflict",
    fixture((ctx) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          fs
            .mkdir(path.join(ctx.skillsRoot, "taken"), { recursive: true })
            .then(() => fs.writeFile(path.join(ctx.skillsRoot, "taken", "SKILL.md"), skillMd("taken", "original"))),
        )
        const source = path.join(ctx.tmp.path, "source", "taken")
        yield* Effect.promise(() => fs.mkdir(source, { recursive: true }).then(() => fs.writeFile(path.join(source, "SKILL.md"), skillMd("taken", "replacement"))))

        const error = yield* ctx.install.install({ type: "path", ref: source }).pipe(Effect.flip)
        expect(error._tag).toBe("SkillInstall.ConflictError")
        expect(
          yield* Effect.promise(() => fs.readFile(path.join(ctx.skillsRoot, "taken", "SKILL.md"), "utf8")),
        ).toBe(skillMd("taken", "original"))
        expect(yield* ctx.install.list()).toEqual([])
      }),
    ),
  )

  it.live(
    "installs every skill directory from a git repository",
    fixture((ctx) =>
      Effect.gen(function* () {
        const repo = path.join(ctx.tmp.path, "repo")
        yield* Effect.promise(() =>
          initRepo(repo, {
            "skills/alpha/SKILL.md": skillMd("alpha"),
            "skills/beta/SKILL.md": skillMd("beta"),
            "README.md": "# repo",
          }),
        )

        const results = yield* ctx.install.install({ type: "git", ref: repo })
        expect(results.map((item) => String(item.name)).toSorted()).toEqual(["alpha", "beta"])
        expect(results.every((item) => item.status === "installed")).toBe(true)

        const entries = yield* ctx.install.list()
        expect(entries.map((entry) => String(entry.name)).toSorted()).toEqual(["alpha", "beta"])
        expect(entries[0].source).toEqual({ type: "git", ref: repo })
        expect(entries[0].version).toMatch(/^[0-9a-f]{40}$/)
        expect(entries[0].version).toBe(entries[1].version)
        expect((yield* ctx.skill.list()).map((item) => String(item.id)).toSorted()).toEqual(["alpha", "beta"])
      }),
    ),
  )

  it.live(
    "installs only the fragment subdirectory from a git repository",
    fixture((ctx) =>
      Effect.gen(function* () {
        const repo = path.join(ctx.tmp.path, "repo")
        yield* Effect.promise(() =>
          initRepo(repo, {
            "skills/alpha/SKILL.md": skillMd("alpha"),
            "skills/beta/SKILL.md": skillMd("beta"),
          }),
        )

        const results = yield* ctx.install.install({ type: "git", ref: `${repo}#skills/beta` })
        expect(results.map((item) => String(item.name))).toEqual(["beta"])
        expect(yield* Effect.promise(() => Bun.file(path.join(ctx.skillsRoot, "alpha", "SKILL.md")).exists())).toBe(false)
        expect(yield* Effect.promise(() => Bun.file(path.join(ctx.skillsRoot, "beta", "SKILL.md")).exists())).toBe(true)
      }),
    ),
  )

  it.live(
    "updates git skills when the commit changes and reports noop otherwise",
    fixture((ctx) =>
      Effect.gen(function* () {
        const repo = path.join(ctx.tmp.path, "repo")
        yield* Effect.promise(() => initRepo(repo, { "skills/alpha/SKILL.md": skillMd("alpha", "original") }))

        const first = yield* ctx.install.install({ type: "git", ref: repo })
        const noop = yield* ctx.install.update("alpha")
        expect(noop.status).toBe("noop")
        expect(noop.version).toBe(first[0].version)

        yield* Effect.promise(() =>
          fs.writeFile(path.join(repo, "skills", "alpha", "SKILL.md"), skillMd("alpha", "updated")),
        )
        yield* Effect.promise(() => runGit(repo, ["add", "."]))
        yield* Effect.promise(() => commitGit(repo))

        const updated = yield* ctx.install.update("alpha")
        expect(updated.status).toBe("updated")
        expect(updated.version).not.toBe(first[0].version)
        expect(
          yield* Effect.promise(() => fs.readFile(path.join(ctx.skillsRoot, "alpha", "SKILL.md"), "utf8")),
        ).toBe(skillMd("alpha", "updated"))
        const entries = yield* ctx.install.list()
        expect(entries.find((entry) => String(entry.name) === "alpha")?.version).toBe(updated.version)
      }),
    ),
  )

  it.live(
    "installs a skill served over http",
    fixture((ctx) =>
      Effect.gen(function* () {
        const server = yield* serve({ "/SKILL.md": () => new Response(skillMd("remote")) })

        const results = yield* ctx.install.install({
          type: "url",
          ref: `http://127.0.0.1:${server.port}/SKILL.md`,
        })
        expect(results).toHaveLength(1)
        expect(String(results[0].name)).toBe("remote")
        expect(yield* Effect.promise(() => fs.readFile(path.join(ctx.skillsRoot, "remote", "SKILL.md"), "utf8"))).toBe(
          skillMd("remote"),
        )
        const entries = yield* ctx.install.list()
        expect(entries[0].source).toEqual({ type: "url", ref: `http://127.0.0.1:${server.port}/SKILL.md` })
        expect((yield* ctx.skill.list()).map((item) => String(item.id))).toContain("remote")
      }),
    ),
  )

  it.live(
    "installs directory-index skills over http",
    fixture((ctx) =>
      Effect.gen(function* () {
        const server = yield* serve({
          "/skills/index.json": () =>
            Response.json({ skills: [{ name: "deploy", files: ["SKILL.md", "reference.md"] }] }),
          "/skills/deploy/SKILL.md": () => new Response(skillMd("deploy")),
          "/skills/deploy/reference.md": () => new Response("# reference"),
        })

        const results = yield* ctx.install.install({
          type: "url",
          ref: `http://127.0.0.1:${server.port}/skills/index.json`,
        })
        expect(results.map((item) => String(item.name))).toEqual(["deploy"])
        expect(yield* Effect.promise(() => fs.readFile(path.join(ctx.skillsRoot, "deploy", "SKILL.md"), "utf8"))).toBe(
          skillMd("deploy"),
        )
        expect(
          yield* Effect.promise(() => fs.readFile(path.join(ctx.skillsRoot, "deploy", "reference.md"), "utf8")),
        ).toBe("# reference")
      }),
    ),
  )

  it.live(
    "installs catalog entries through the index source",
    Effect.gen(function* () {
      const repoTmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir()))
      const repo = path.join(repoTmp.path, "repo")
      yield* Effect.promise(() => initRepo(repo, { "skills/alpha/SKILL.md": skillMd("alpha") }))
      const catalog: SkillCatalog.Interface = {
        list: () => Effect.succeed([]),
        resolve: (name) =>
          Effect.succeed(
            name === "alpha"
              ? {
                  name: Skill.Name.make("alpha"),
                  description: "Alpha fixture",
                  category: "test",
                  source: { type: "git", ref: repo },
                }
              : undefined,
          ),
      }

      yield* fixture(
        (ctx) =>
          Effect.gen(function* () {
            const results = yield* ctx.install.install({ type: "index", ref: "alpha" })
            expect(results.map((item) => String(item.name))).toEqual(["alpha"])
            expect(yield* Effect.promise(() => Bun.file(path.join(ctx.skillsRoot, "alpha", "SKILL.md")).exists())).toBe(true)
            const entries = yield* ctx.install.list()
            expect(entries[0].source).toEqual({ type: "index", ref: "alpha" })
          }),
        catalog,
      )
    }),
  )

  it.live(
    "rejects skills without a frontmatter name and leaves no trace",
    fixture((ctx) =>
      Effect.gen(function* () {
        const source = path.join(ctx.tmp.path, "source", "bad")
        yield* Effect.promise(() =>
          fs.mkdir(source, { recursive: true }).then(() =>
            fs.writeFile(path.join(source, "SKILL.md"), "---\ndescription: missing name\n---\n# bad"),
          ),
        )

        const error = yield* ctx.install.install({ type: "path", ref: source }).pipe(Effect.flip)
        expect(error._tag).toBe("SkillInstall.InvalidError")
        expect(yield* Effect.promise(() => Bun.file(path.join(ctx.skillsRoot, "bad")).exists())).toBe(false)
        expect(yield* ctx.install.list()).toEqual([])
        expect(yield* Effect.promise(() => fs.readdir(ctx.configRoot))).toEqual(["skills"])
      }),
    ),
  )
})
