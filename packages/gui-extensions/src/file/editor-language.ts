/** The languages the file editor highlights, by a file's extension. */
export type EditorLanguage =
  | "javascript"
  | "jsx"
  | "typescript"
  | "tsx"
  | "json"
  | "html"
  | "css"
  | "markdown"
  | "python"

/**
 * The language a path's editor highlights, so its language package loads only for files that have one. Undefined
 * means plain text.
 *
 * @param path - A workspace-relative or absolute file path.
 */
export function editorLanguage(path: string): EditorLanguage | undefined {
  const name = path.split(/[\\/]/).pop() ?? ""
  const index = name.lastIndexOf(".")

  if (index <= 0) return undefined

  switch (name.slice(index + 1).toLowerCase()) {
    case "js":
    case "mjs":
    case "cjs":
      return "javascript"
    case "jsx":
      return "jsx"
    case "ts":
    case "mts":
    case "cts":
      return "typescript"
    case "tsx":
      return "tsx"
    case "json":
    case "jsonc":
      return "json"
    case "html":
    case "htm":
      return "html"
    case "css":
      return "css"
    case "md":
    case "markdown":
    case "mdx":
      return "markdown"
    case "py":
    case "pyi":
      return "python"
    default:
      return undefined
  }
}

/** Files longer than this many characters open read-only: an editable document of that size slows editing down. */
export const MAX_EDIT_CHARS = 1_000_000
