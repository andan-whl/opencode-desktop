import { describe, expect, test } from "bun:test"
import path from "node:path"
import { inferSource } from "../src/commands/handlers/skill/add"

const missing = () => false

describe("skill add source inference", () => {
  test("treats existing local paths as path sources", () => {
    expect(inferSource("/skills/review", (ref) => ref === "/skills/review")).toEqual({
      type: "path",
      ref: path.resolve("/skills/review"),
    })
    expect(inferSource("review", (ref) => ref === "review")).toEqual({
      type: "path",
      ref: path.resolve("review"),
    })
  })

  test("keeps plain URLs as url sources", () => {
    expect(inferSource("https://example.com/skills/review/SKILL.md", missing)).toEqual({
      type: "url",
      ref: "https://example.com/skills/review/SKILL.md",
    })
    expect(inferSource("https://example.com/skills/index.json", missing)).toEqual({
      type: "url",
      ref: "https://example.com/skills/index.json",
    })
    expect(inferSource("https://raw.githubusercontent.com/owner/repo/main/SKILL.md", missing)).toEqual({
      type: "url",
      ref: "https://raw.githubusercontent.com/owner/repo/main/SKILL.md",
    })
  })

  test("treats git specifiers as git sources", () => {
    expect(inferSource("git@github.com:owner/repo.git", missing)).toEqual({
      type: "git",
      ref: "git@github.com:owner/repo.git",
    })
    expect(inferSource("ssh://git@github.com/owner/repo.git", missing)).toEqual({
      type: "git",
      ref: "ssh://git@github.com/owner/repo.git",
    })
    expect(inferSource("https://github.com/owner/repo.git", missing)).toEqual({
      type: "git",
      ref: "https://github.com/owner/repo.git",
    })
    expect(inferSource("https://github.com/owner/repo", missing)).toEqual({
      type: "git",
      ref: "https://github.com/owner/repo",
    })
    expect(inferSource("https://github.com/owner/repo#skills/review", missing)).toEqual({
      type: "git",
      ref: "https://github.com/owner/repo#skills/review",
    })
  })

  test("falls back to catalog names when nothing else matches", () => {
    expect(inferSource("code-review", missing)).toBeUndefined()
    expect(inferSource("code-review", (ref) => ref === "unrelated")).toBeUndefined()
  })

  test("prefers URL and git shapes over filesystem checks", () => {
    expect(inferSource("https://github.com/owner/repo", () => true)).toEqual({
      type: "git",
      ref: "https://github.com/owner/repo",
    })
  })
})
