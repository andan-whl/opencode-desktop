export * as SkillInstall from "./install.js"

import path from "path"
import { Context, DateTime, Effect, Layer, Option, Schedule, Schema } from "effect"
import { HttpClient, HttpClientError, HttpClientRequest } from "effect/http"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Hash } from "@opencode/util/hash"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { httpClient } from "@opencode/util/effect/app-node-platform"
import { ConfigMarkdown } from "../config/markdown.js"
import { AbsolutePath } from "../schema.js"
import { Skill } from "../skill.js"
import { SkillCatalog } from "./catalog.js"
import { SkillDiscovery } from "./discovery.js"
import { gitExecutable } from "../util/git-executable.js"

export class NotManagedError extends Schema.TaggedError<NotManagedError>()("SkillInstall.NotManagedError", {
  name: Schema.String,
}) {}

export class ConflictError extends Schema.TaggedError<ConflictError>()("SkillInstall.ConflictError", {
  name: Schema.String,
  path: Schema.String,
}) {}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("SkillInstall.NotFoundError", {
  name: Schema.String,
}) {}

export class InvalidError extends Schema.TaggedError<InvalidError>()("SkillInstall.InvalidError", {
  name: Schema.String,
  reason: Schema.String,
}) {}

export class GitError extends Schema.TaggedError<GitError>()("SkillInstall.GitError", {
  message: Schema.String,
}) {}

export class SourceError extends Schema.TaggedError<SourceError>()("SkillInstall.SourceError", {
  ref: Schema.String,
  message: Schema.String,
}) {}

export type Error =
  | NotManagedError
  | ConflictError
  | NotFoundError
  | InvalidError
  | GitError
  | SourceError
  | FSUtil.Error
  | HttpClientError.HttpClientError

export interface Interface {
  readonly install: (source: Skill.InstallSource) => Effect.Effect<ReadonlyArray<Skill.InstallResult>, Error>
  readonly uninstall: (name: string) => Effect.Effect<void, Error>
  readonly update: (name: string) => Effect.Effect<Skill.InstallResult, Error>
  readonly list: () => Effect.Effect<ReadonlyArray<Skill.ManifestEntry>, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SkillInstall") {}

type FetchedSkill = {
  readonly name: string
  readonly stagingDir: string
  readonly version: string
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const catalog = yield* SkillCatalog.Service
    const discovery = yield* SkillDiscovery.Service
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const skill = yield* Skill.Service
    const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)

    const skillsRoot = path.join(global.config, "skills")
    const manifestPath = path.join(global.config, "skills.json")

    const readManifest = Effect.fn("SkillInstall.readManifest")(function* () {
      const raw = yield* fs.readJson(manifestPath).pipe(Effect.option)
      return Option.getOrElse(
        Option.flatMap(raw, (value) => Schema.decodeUnknownOption(Skill.Manifest)(value)),
        () => Skill.Manifest.make({ version: 1, entries: [] }),
      )
    })

    const writeManifest = (manifest: Skill.Manifest) =>
      fs.writeJson(manifestPath, Schema.encodeSync(Skill.Manifest)(manifest))

    const readSkillName = Effect.fn("SkillInstall.readSkillName")(function* (directory: string) {
      const content = yield* fs.readFileStringSafe(path.join(directory, "SKILL.md"))
      return content ? skillName(content) : undefined
    })

    const hashDirectory = Effect.fn("SkillInstall.hashDirectory")(function* (directory: string) {
      const files = (yield* fs.scan("**/*", { cwd: directory, absolute: false, include: "file", dot: true })).toSorted()
      const digests = yield* Effect.forEach(files, (file) =>
        fs
          .readFileStringSafe(path.join(directory, file))
          .pipe(
            Effect.orElseSucceed(() => undefined),
            Effect.map((content) => `${file}:${Hash.sha256(content ?? "")}`),
          ),
      )
      return Hash.sha256(digests.join("\n"))
    })

    const stageSkill = Effect.fn("SkillInstall.stageSkill")(function* (
      directory: string,
      stagingRoot: string,
      version: string,
    ) {
      const name = yield* readSkillName(directory)
      if (!name) {
        return yield* new InvalidError({
          name: path.basename(directory),
          reason: "SKILL.md frontmatter is missing a valid name",
        })
      }
      const stagingDir = path.join(stagingRoot, name)
      yield* fs.copy(directory, stagingDir)
      return { name, stagingDir, version }
    })

    const fetchPath = Effect.fn("SkillInstall.fetchPath")(function* (ref: string, stagingRoot: string) {
      if (yield* fs.isDir(ref)) {
        const version = yield* hashDirectory(ref)
        return [yield* stageSkill(ref, stagingRoot, version)]
      }
      const content = yield* fs.readFileStringSafe(ref)
      if (content === undefined) return yield* new SourceError({ ref, message: "path does not exist" })
      const name = skillName(content)
      if (!name) {
        return yield* new InvalidError({ name: path.basename(ref), reason: "SKILL.md frontmatter is missing a valid name" })
      }
      const stagingDir = path.join(stagingRoot, name)
      yield* fs.writeWithDirs(path.join(stagingDir, "SKILL.md"), content)
      return [{ name, stagingDir, version: Hash.sha256(content) }]
    })

    const findSkillDirs = Effect.fn("SkillInstall.findSkillDirs")(function* (root: string) {
      const dirs: string[] = []
      if (yield* fs.exists(path.join(root, "SKILL.md")).pipe(Effect.orDie)) dirs.push(root)
      for (const sub of ["skills", "skill"]) {
        const files = yield* fs
          .scan("*/SKILL.md", { cwd: path.join(root, sub), absolute: true, include: "file" })
          .pipe(Effect.orElseSucceed(() => [] as string[]))
        dirs.push(...files.map((file) => path.dirname(file)))
      }
      return dirs.toSorted()
    })

    const fetchGit = Effect.fn("SkillInstall.fetchGit")(function* (ref: string, stagingRoot: string) {
      const hashIndex = ref.indexOf("#")
      const repoUrl = hashIndex === -1 ? ref : ref.slice(0, hashIndex)
      const subdir = hashIndex === -1 ? undefined : ref.slice(hashIndex + 1)
      if (!repoUrl || subdir === "") return yield* new SourceError({ ref, message: "missing repository URL" })

      const repoDir = path.join(stagingRoot, "repo")
      // Repository content must land on disk byte-for-byte: a global core.autocrlf would rewrite
      // line endings on checkout and break scripts shipped inside skills.
      yield* gitRun(["-c", "core.autocrlf=false", "clone", "--depth", "1", repoUrl, repoDir])
      const version = (yield* gitRun(["rev-parse", "HEAD"], repoDir)).trim()

      const searchRoot = subdir ? path.resolve(repoDir, subdir) : repoDir
      if (!FSUtil.contains(repoDir, searchRoot)) {
        return yield* new SourceError({ ref, message: "subdirectory escapes the repository" })
      }
      const roots = yield* findSkillDirs(searchRoot)
      if (roots.length === 0) return yield* new SourceError({ ref, message: "no SKILL.md found in repository" })
      return yield* Effect.forEach(roots, (root) => stageSkill(root, stagingRoot, version))
    })

    const fetchUrl = Effect.fn("SkillInstall.fetchUrl")(function* (ref: string, stagingRoot: string) {
      if (!URL.canParse(ref)) return yield* new SourceError({ ref, message: "invalid URL" })
      const url = new URL(ref)
      if (url.pathname.endsWith("/index.json")) {
        const directories = yield* discovery.pull(new URL("./", url).href)
        if (directories.length === 0) return yield* new SourceError({ ref, message: "skill index is empty" })
        return yield* Effect.forEach(directories, (directory) =>
          Effect.gen(function* () {
            const version = yield* hashDirectory(directory)
            return yield* stageSkill(directory, stagingRoot, version)
          }),
        )
      }
      const content = yield* HttpClientRequest.get(ref).pipe(
        http.execute,
        Effect.flatMap((response) => response.text),
      )
      const name = skillName(content)
      if (!name) {
        return yield* new InvalidError({
          name: path.basename(url.pathname) || url.hostname,
          reason: "SKILL.md frontmatter is missing a valid name",
        })
      }
      const stagingDir = path.join(stagingRoot, name)
      yield* fs.writeWithDirs(path.join(stagingDir, "SKILL.md"), content)
      return [{ name, stagingDir, version: Hash.sha256(content) }]
    })

    const fetchIndex = Effect.fn("SkillInstall.fetchIndex")(function* (name: string, stagingRoot: string) {
      const entry = yield* catalog.resolve(name)
      if (!entry) return yield* new NotFoundError({ name })
      return yield* entry.source.type === "git"
        ? fetchGit(entry.source.ref, stagingRoot)
        : fetchUrl(entry.source.ref, stagingRoot)
    })

    const waitForSkills = (names: string[]) =>
      Effect.filterOrFail(
        skill.list(),
        (skills) => names.every((name) => skills.some((item) => item.id === Skill.ID.make(name))),
        () => new InvalidError({ name: names[0] ?? "", reason: "installed skill did not appear in the skill list" }),
      ).pipe(Effect.retry({ times: 100, schedule: Schedule.spaced("100 millis") }))

    const rollback = (swapped: { target: string; backup: string | undefined }[]) =>
      Effect.uninterruptible(
        Effect.forEach(swapped, ({ target, backup }) =>
          Effect.gen(function* () {
            yield* fs.remove(target, { recursive: true, force: true }).pipe(Effect.ignore)
            if (backup) yield* fs.rename(backup, target).pipe(Effect.ignore)
          }),
        ),
      )

    const apply = Effect.fn("SkillInstall.apply")(function* (
      source: Skill.InstallSource,
      previous?: ReadonlyMap<string, string>,
    ) {
      const manifest = yield* readManifest()
      yield* fs.ensureDir(skillsRoot)
      const token = crypto.randomUUID()
      const stagingRoot = path.join(global.config, `.skill-staging-${token}`)
      yield* fs.ensureDir(stagingRoot)

      return yield* Effect.gen(function* () {
        const skills: FetchedSkill[] = yield* (source.type === "path"
          ? fetchPath(source.ref, stagingRoot)
          : source.type === "git"
            ? fetchGit(source.ref, stagingRoot)
            : source.type === "url"
              ? fetchUrl(source.ref, stagingRoot)
              : fetchIndex(source.ref, stagingRoot))

        for (const item of skills) {
          const target = path.join(skillsRoot, item.name)
          const exists = yield* fs.exists(target)
          const managed = manifest.entries.some((entry) => entry.name === item.name)
          if (exists && !managed) return yield* new ConflictError({ name: item.name, path: target })
        }

        if (previous && skills.length > 0 && skills.every((item) => previous.get(item.name) === item.version)) {
          return skills.map((item) =>
            Skill.InstallResult.make({
              status: "noop",
              name: Skill.Name.make(item.name),
              version: item.version,
              path: AbsolutePath.make(path.join(skillsRoot, item.name)),
            }),
          )
        }

        const swapped: { target: string; backup: string | undefined; existed: boolean }[] = []
        return yield* Effect.gen(function* () {
          yield* Effect.uninterruptible(
            Effect.forEach(skills, (item) =>
              Effect.gen(function* () {
                const target = path.join(skillsRoot, item.name)
                const existed = yield* fs.exists(target)
                const backup = existed ? `${target}.old-${token}` : undefined
                if (backup) yield* fs.rename(target, backup)
                yield* fs.rename(item.stagingDir, target).pipe(
                  Effect.catch((error) =>
                    Effect.gen(function* () {
                      if (backup) yield* fs.rename(backup, target).pipe(Effect.ignore)
                      return yield* Effect.fail(error)
                    }),
                  ),
                )
                swapped.push({ target, backup, existed })
              }),
            ),
          )

          yield* skill.reload()
          yield* waitForSkills(skills.map((item) => item.name))

          const names = new Set(skills.map((item) => item.name))
          const installedAt = DateTime.makeUnsafe(Date.now())
          yield* writeManifest(
            Skill.Manifest.make({
              version: 1,
              entries: [
                ...manifest.entries.filter((entry) => !names.has(entry.name)),
                ...skills.map((item) =>
                  Skill.ManifestEntry.make({
                    name: Skill.Name.make(item.name),
                    source,
                    version: item.version,
                    installedAt,
                  }),
                ),
              ],
            }),
          )
          // Backups stay in place until the manifest is durably written so a failure anywhere above can restore the
          // previous skill directories.
          yield* Effect.forEach(swapped, ({ backup }) =>
            backup ? fs.remove(backup, { recursive: true, force: true }).pipe(Effect.ignore) : Effect.void,
          )
          return skills.map((item, index) =>
            Skill.InstallResult.make({
              status: swapped[index].existed ? "updated" : "installed",
              name: Skill.Name.make(item.name),
              version: item.version,
              path: AbsolutePath.make(path.join(skillsRoot, item.name)),
            }),
          )
        }).pipe(Effect.catch((error) => rollback(swapped).pipe(Effect.andThen(Effect.fail(error)))))
      }).pipe(Effect.ensuring(fs.remove(stagingRoot, { recursive: true, force: true }).pipe(Effect.ignore)))
    })

    return Service.of({
      install: Effect.fn("SkillInstall.install")(function* (source) {
        return yield* apply(source)
      }),
      uninstall: Effect.fn("SkillInstall.uninstall")(function* (name) {
        const manifest = yield* readManifest()
        const entry = manifest.entries.find((entry) => entry.name === name)
        if (!entry) return yield* new NotManagedError({ name })
        yield* fs.remove(path.join(skillsRoot, name), { recursive: true, force: true })
        yield* writeManifest(
          Skill.Manifest.make({ version: 1, entries: manifest.entries.filter((entry) => entry.name !== name) }),
        )
        yield* skill.reload()
      }),
      update: Effect.fn("SkillInstall.update")(function* (name) {
        const manifest = yield* readManifest()
        const entry = manifest.entries.find((entry) => entry.name === name)
        if (!entry) return yield* new NotFoundError({ name })
        const previous = new Map<string, string>(
          manifest.entries
            .filter((item) => item.source.type === entry.source.type && item.source.ref === entry.source.ref)
            .map((item) => [item.name, item.version]),
        )
        return (yield* apply(entry.source, previous))[0]
      }),
      list: Effect.fn("SkillInstall.list")(function* () {
        return (yield* readManifest()).entries
      }),
    })
  }),
)

function skillName(content: string): string | undefined {
  const parsed = ConfigMarkdown.parseOption(content)
  const name = parsed?.data?.name
  if (typeof name !== "string") return undefined
  const trimmed = name.trim()
  return isSafeSegment(trimmed) ? trimmed : undefined
}

function isSafeSegment(value: string) {
  return (
    value.length > 0 &&
    value !== "." &&
    value !== ".." &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !value.includes("\0")
  )
}

async function execGit(args: string[], cwd?: string) {
  const proc = Bun.spawn({ cmd: [gitExecutable, ...args], cwd, stdout: "pipe", stderr: "pipe", stdin: "ignore" })
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  return { exitCode, stdout, stderr }
}

const gitRun = Effect.fn("SkillInstall.git")(function* (args: string[], cwd?: string) {
  const result = yield* Effect.promise(() => execGit(args, cwd))
  if (result.exitCode !== 0) {
    return yield* new GitError({
      message: `git ${args.join(" ")} failed with exit code ${result.exitCode}: ${result.stderr.trim()}`,
    })
  }
  return result.stdout
})

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Skill.node, SkillCatalog.node, SkillDiscovery.node, FSUtil.node, Global.node, httpClient],
})
