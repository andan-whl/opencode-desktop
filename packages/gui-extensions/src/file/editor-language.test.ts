import { describe, expect, test } from "bun:test"
import { editorLanguage, MAX_EDIT_CHARS } from "./editor-language"

describe("editorLanguage", () => {
  test("maps each javascript and typescript flavor", () => {
    expect(editorLanguage("src/app.js")).toBe("javascript")
    expect(editorLanguage("src/app.mjs")).toBe("javascript")
    expect(editorLanguage("src/app.cjs")).toBe("javascript")
    expect(editorLanguage("src/component.jsx")).toBe("jsx")
    expect(editorLanguage("src/app.ts")).toBe("typescript")
    expect(editorLanguage("src/app.mts")).toBe("typescript")
    expect(editorLanguage("src/app.cts")).toBe("typescript")
    expect(editorLanguage("src/component.tsx")).toBe("tsx")
  })

  test("maps data, markup, and script languages", () => {
    expect(editorLanguage("package.json")).toBe("json")
    expect(editorLanguage("tsconfig.jsonc")).toBe("json")
    expect(editorLanguage("index.html")).toBe("html")
    expect(editorLanguage("index.htm")).toBe("html")
    expect(editorLanguage("styles/css/main.css")).toBe("css")
    expect(editorLanguage("README.md")).toBe("markdown")
    expect(editorLanguage("notes.mdx")).toBe("markdown")
    expect(editorLanguage("scripts/run.py")).toBe("python")
    expect(editorLanguage("scripts/__init__.pyi")).toBe("python")
  })

  test("separates on the last extension and both separators", () => {
    expect(editorLanguage("src\\lib\\app.tsx")).toBe("tsx")
    expect(editorLanguage("archive.tar.gz")).toBeUndefined()
  })

  test("files without an editable extension edit as plain text", () => {
    expect(editorLanguage("Makefile")).toBeUndefined()
    expect(editorLanguage(".env")).toBeUndefined()
    expect(editorLanguage("Dockerfile")).toBeUndefined()
  })
})

describe("MAX_EDIT_CHARS", () => {
  test("keeps editable documents within a megabyte of text", () => {
    expect(MAX_EDIT_CHARS).toBe(1_000_000)
  })
})
