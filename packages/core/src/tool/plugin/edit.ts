/**
 * Model-facing exact-edit leaf. Relative paths resolve within the active
 * Location. Absolute paths inside that Location are accepted, while explicit
 * absolute external paths retain mutation capability through a separate
 * external_directory approval before edit approval.
 */
export * as EditTool from "./edit.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { ToolFailure } from "@opencode/ai"
import { FileDiff } from "@opencode/schema/file-diff"
import { Bom } from "@opencode/util/bom"
import { Effect, Schema } from "effect"
import { Environment } from "../../environment/index.js"
import { FileMutation } from "../../file-mutation.js"
import { Formatter } from "../../formatter.js"
import { Location } from "../../location.js"
import { FileAccess } from "../../file-access.js"
import { Permission } from "../../permission.js"
import { fileDiff } from "./file-diff.js"

export const name = "edit"

export const Input = Schema.Struct({
  path: Schema.String.annotate({
    description: "File to edit",
  }),
  oldString: Schema.String.annotate({ description: "Exact text to find and replace" }),
  newString: Schema.String.annotate({ description: "Text to replace oldString with (must differ from oldString)" }),
  replaceAll: Schema.optionalKey(Schema.Boolean).annotate({
    description:
      "Whether to replace every occurrence of oldString. When false, oldString must match exactly once. Defaults to false.",
  }),
})

export const Output = Schema.Struct({
  files: Schema.Array(FileDiff.Info),
  replacements: Schema.Number,
})
export type Output = typeof Output.Type

const crlf = "\r\n"

interface Match {
  readonly start: number
  readonly end: number
}

const normalizeForMatch = (value: string) =>
  value
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ")

const findOccurrences = (content: string, search: string) => {
  const result: Match[] = []
  let offset = 0
  while ((offset = content.indexOf(search, offset)) !== -1) {
    result.push({ start: offset, end: offset + search.length })
    offset += search.length
  }
  return result
}

const findLineOccurrences = (content: string, search: string) => {
  const lines = splitLines(content)
  return matchLineSequences(lines, search, (actual, expected) =>
    normalizeForMatch(actual.trimEnd()) === normalizeForMatch(expected.trimEnd()),
  )
}

type LineSequence = ReturnType<typeof splitLines>[number]

const splitLines = (content: string) =>
  [...content.matchAll(/[^\n]*(?:\n|$)/g)]
    .filter((match) => match[0] !== "")
    .map((match) => {
      const newline = match[0].endsWith("\n")
      const text = newline ? match[0].slice(0, -1) : match[0]
      return {
        start: match.index,
        end: match.index + match[0].length,
        text,
        contentEnd: match.index + text.length - (text.endsWith("\r") ? 1 : 0),
        newline,
      }
    })

/** Compares each line with `compare` and returns the non-overlapping whole-line match windows. */
const matchLineSequences = (
  lines: readonly LineSequence[],
  search: string,
  compare: (actual: string, expected: string) => boolean,
) => {
  const trailingNewline = search.endsWith("\n")
  const expected = search.split("\n")
  if (trailingNewline) expected.pop()
  const candidates = lines.flatMap((line, index) => {
    const actual = lines.slice(index, index + expected.length)
    if (actual.length !== expected.length) return []
    if (!actual.every((item, lineIndex) => compare(item.text, expected[lineIndex]!))) return []
    const last = actual.at(-1)!
    if (trailingNewline && !last.newline) return []
    return [{ start: line.start, end: trailingNewline ? last.end : last.contentEnd, lines: actual }]
  })
  return candidates.reduce<{ start: number; end: number; lines: readonly LineSequence[] }[]>((result, candidate) => {
    if (result.some((match) => match.end > candidate.start && match.start < candidate.end)) return result
    result.push(candidate)
    return result
  }, [])
}

const leadingWhitespace = (line: string) => /^[ \t]*/.exec(line)![0]!

/**
 * Matches each line ignoring its leading whitespace, so a model that copied Read output with tabs expanded to
 * spaces, or lost or added a level of indentation, still matches. Returns each match's file-side indents so the
 * replacement can carry the file's real indentation.
 */
const findIndentOccurrences = (content: string, search: string) =>
  matchLineSequences(splitLines(content), search, (actual, expected) =>
    normalizeForMatch(actual.trim()) === normalizeForMatch(expected.trim()),
  ).map((match) => ({
    start: match.start,
    end: match.end,
    indents: match.lines.map((line) => leadingWhitespace(line.text)),
  }))

/** The dominant line ending in text, or fallback when there is none. */
const lineEnding = (text: string, fallback: string) => {
  const crlfCount = text.split(crlf).length - 1
  const lfCount = text.split("\n").length - 1 - crlfCount
  if (crlfCount === lfCount) return fallback
  return crlfCount > lfCount ? crlf : "\n"
}

/**
 * Joins the replacement's lines with line endings taken from the matched source region. A replacement line that
 * keeps a region line (longest common subsequence, compared like the trailing-whitespace tier) reuses that line's
 * ending; a line that changes in place reuses the ending of the line it replaces; only lines beyond those take
 * `fallback`. Unchanged context inside a match therefore keeps its bytes even in a mixed-ending file.
 */
const withRegionEndings = (region: string, replacement: string, fallback: string) => {
  const before = region.split(/\r?\n/)
  const endings = [...region.matchAll(/\r?\n/g)].map((match) => match[0])
  const after = replacement.split("\n")
  const key = (line: string) => normalizeForMatch(line.trimEnd())
  const source = alignLines(before.map(key), after.map(key))
  return after.map((line, index) => (index === after.length - 1 ? line : line + (endings[source[index]!] ?? fallback))).join("")
}

/**
 * For each line of `after`, the index of the `before` line it keeps (longest common subsequence) or, between kept
 * lines, the line it takes the place of; undefined for lines with no counterpart.
 */
const alignLines = (before: string[], after: string[]) => {
  const width = after.length + 1
  const table = new Uint32Array((before.length + 1) * width)
  for (let i = before.length - 1; i >= 0; i--)
    for (let j = after.length - 1; j >= 0; j--)
      table[i * width + j] =
        before[i] === after[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
  const result: (number | undefined)[] = []
  const gap = { before: [] as number[], after: [] as number[] }
  const flush = () => {
    gap.after.forEach((j, k) => (result[j] = gap.before[k]))
    gap.before = []
    gap.after = []
  }
  let i = 0
  let j = 0
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      flush()
      result[j++] = i++
      continue
    }
    if (table[(i + 1) * width + j] >= table[i * width + j + 1]) gap.before.push(i++)
    else gap.after.push(j++)
  }
  while (i < before.length) gap.before.push(i++)
  while (j < after.length) gap.after.push(j++)
  flush()
  return result
}

/**
 * Matches against the LF view Read shows the model, then maps offsets back to the source, so CRLF and mixed line
 * endings neither block matches nor leak into untouched regions.
 */
const matchView = (source: string, oldString: string, newString: string) => {
  const view = source.replaceAll(crlf, "\n")
  const removed = [...source.matchAll(/\r\n/g)].map((match, index) => match.index - index)
  const fileEnding = lineEnding(source, "\n")
  const search = oldString.replaceAll(crlf, "\n")
  const replacement = newString.replaceAll(crlf, "\n")
  const exact = findOccurrences(view, search)
  // These one-to-one mappings preserve offsets into the LF view.
  const unicode = exact.length > 0 ? [] : findOccurrences(normalizeForMatch(view), normalizeForMatch(search))
  const trailing = exact.length > 0 || unicode.length > 0 ? [] : findLineOccurrences(view, search)
  // Last tier: the model's copy differs only in leading whitespace, e.g. tabs expanded to spaces or a lost or
  // added indentation level. The file's own indents carry into the replacement.
  const indents = exact.length > 0 || unicode.length > 0 || trailing.length > 0 ? [] : findIndentOccurrences(view, search)
  const mappings = new Map(indents.map((match) => [match.start, match.indents] as const))
  return {
    matches: (exact.length > 0 ? exact : unicode.length > 0 ? unicode : trailing.length > 0 ? trailing : indents).map(
      (match) => ({
        start: match.start + countBefore(removed, match.start),
        end: match.end + countBefore(removed, match.end),
      }),
    ),
    // Whether the matches came from the indentation-tolerant tier; the failures below say so.
    indent: indents.length > 0 && exact.length === 0 && unicode.length === 0 && trailing.length === 0,
    replace: (match: Match) => {
      const region = source.slice(match.start, match.end)
      const regionEnding = lineEnding(region, fileEnding)
      const carried = mappings.get(
        // The LF-view start of a source offset: every removed \r before it pushed the source offset further.
        match.start - countBefore(removed, match.start),
      )
      return carried
        ? withRegionEndings(region, reindent(search, replacement, carried), regionEnding)
        : withRegionEndings(region, replacement, regionEnding)
    },
  }
}

/**
 * Rewrites `replacement` so its lines keep the file's indentation. Lines that align with an oldString line (same
 * trimmed content, longest common subsequence) map that line's declared prefix onto the file's own; changed and
 * added lines borrow the nearest aligned line's prefix transformation, repeating it for deeper levels. Lines with
 * nothing to borrow keep the model's own indentation.
 */
const reindent = (search: string, replacement: string, indents: readonly string[]) => {
  const expected = search.split("\n")
  const after = replacement.split("\n")
  const aligned = alignLines(
    expected.map((line) => normalizeForMatch(line.trim())),
    after.map((line) => normalizeForMatch(line.trim())),
  )
  // The nearest aligned line at or before `index`, else the first aligned line.
  const shift = (index: number) => {
    for (let at = index; at >= 0; at--) if (aligned[at] !== undefined) return aligned[at]
    return aligned.find((value) => value !== undefined)
  }
  return after
    .map((line, index) => {
      const at = aligned[index] ?? shift(index)
      if (at === undefined) return line
      const declared = leadingWhitespace(expected[at]!)
      const actual = indents[at]!
      if (declared === "") return actual + line
      let rest = line
      let count = 0
      while (rest.startsWith(declared)) {
        rest = rest.slice(declared.length)
        count++
      }
      return count === 0 ? line : actual.repeat(count) + rest
    })
    .join("\n")
}

/** Number of sorted positions strictly before offset. */
const countBefore = (positions: number[], offset: number) => {
  let low = 0
  let high = positions.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (positions[middle] < offset) low = middle + 1
    else high = middle
  }
  return low
}

/** Matches the "N: " line prefix Read puts in front of every text line. */
const readLinePrefix = /^[0-9]+:\s/

/**
 * Read prefixes every line with "N: ", and a model that copies that prefix into its strings can never match
 * the file. When every non-empty line carries the prefix, return the value with the prefixes removed;
 * otherwise return undefined. Files whose lines genuinely start with "N: " are unaffected because the
 * original strings still run through every tier first and the stripped pair is only a fallback.
 */
const stripReadLineNumbers = (value: string) => {
  const lines = value.split("\n")
  if (!lines.every((line) => line === "" || readLinePrefix.test(line))) return
  return lines.map((line) => line.replace(readLinePrefix, "")).join("\n")
}

/** Deferred edit behavior and UX integrations remain visible at the model-facing seam. */
// TODO: Publish watcher/file-edit events after watcher integration exists.
// TODO: Add snapshots / undo after design exists.
// TODO: Add LSP notification and diagnostics after LSP runtime exists.

export const Plugin = {
  id: "opencode.tool.edit",
  effect: Effect.fn("EditTool.Plugin")(function* (ctx: Context) {
    const access = yield* FileAccess.Service
    const fileMutation = yield* FileMutation.Service
    const environment = yield* Environment.Service
    const formatter = yield* Formatter.Service
    const location = yield* Location.Service
    const permission = yield* Permission.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false, permission: "edit" },
          description:
            "Edit the contents of a file by finding and replacing exact text. When editing text from Read output, preserve the exact indentation (tabs or spaces) and omit the line-number prefix, such as `1: `. Never include the prefix in oldString or newString. Write line breaks as \\n; the file's existing CRLF or LF line endings are matched and preserved. To change line endings themselves, make oldString and newString differ only in \\r; that edit applies to the exact bytes. If there is no exact match, the edit retries while ignoring typographic quote, dash, and space variants, then trailing whitespace on each line. The edit fails if oldString is not found. By default, oldString must identify a UNIQUE location. Multiple matches FAIL unless replaceAll is true. Add more surrounding context to disambiguate, or set replaceAll to true to replace every occurrence. Use replaceAll when the change should apply to every occurrence, such as renaming a variable.",
          input: Input,
          output: Output,
          execute: (input, context) => {
            return Effect.gen(function* () {
              const permissionSource = {
                type: "tool" as const,
                messageID: context.messageID,
                id: context.id,
              }
              if (input.oldString === input.newString) {
                return yield* new ToolFailure({
                  message:
                    "No changes to apply: oldString and newString are identical. If the intended change is already in the file, read the file to confirm; otherwise put the surrounding context in oldString and the same context with your change in newString.",
                })
              }
              if (input.oldString === "") {
                return yield* new ToolFailure({
                  message: "oldString must not be empty. Use write to create or overwrite a file.",
                })
              }

              const target = yield* access.resolve({ path: input.path, kind: "file" })
              yield* access.authorizeExternal([target], context)

              const original = yield* FileMutation.readText(environment.files, target.absolute).pipe(
                Effect.catchTag("Environment.NotFound", () =>
                  Effect.fail(new ToolFailure({ message: `File not found: ${input.path}` })),
                ),
                Effect.catchTag("Environment.WrongKind", (error) =>
                  error.actual === "directory"
                    ? Effect.fail(new ToolFailure({ message: `Path is a directory, not a file: ${input.path}` }))
                    : Effect.fail(new ToolFailure({ message: `Unable to edit ${input.path}`, error })),
                ),
              )
              const source = original.text
              // Strings that differ only in \r ask to change line endings themselves, so they apply to the exact
              // bytes. Every other edit matches the LF view Read shows the model and keeps the file's endings.
              const attempt = (oldString: string, newString: string) => {
                const endingsOnly = oldString.replaceAll("\r", "") === newString.replaceAll("\r", "")
                return {
                  endingsOnly,
                  ...(endingsOnly
                    ? { matches: findOccurrences(source, oldString), replace: () => newString, indent: false }
                    : matchView(source, oldString, newString)),
                }
              }
              let { matches, replace, endingsOnly, indent } = attempt(input.oldString, input.newString)
              // Read prefixes every text line with "N: "; when the model copied those prefixes along, retry
              // without them. newString keeps its own prefixes unless every one of its lines carries them too.
              const unprefixedOld = stripReadLineNumbers(input.oldString)
              if (matches.length === 0 && unprefixedOld !== undefined && unprefixedOld !== "" && unprefixedOld !== input.oldString)
                ({ matches, replace, endingsOnly, indent } = attempt(
                  unprefixedOld,
                  stripReadLineNumbers(input.newString) ?? input.newString,
                ))
              const replacements = matches.length
              const replaced = (input.replaceAll === true ? matches : matches.slice(0, 1))
                .toReversed()
                .reduce(
                  (content, match) => `${content.slice(0, match.start)}${replace(match)}${content.slice(match.end)}`,
                  source,
                )
              const preview =
                replacements > 0 && (replacements === 1 || input.replaceAll === true)
                  ? fileDiff(target.resource, source, replaced)
                  : undefined
              yield* permission.assert({
                action: "edit",
                resources: [target.resource],
                save: ["*"],
                metadata: preview ? { files: [preview] } : undefined,
                sessionID: context.sessionID,
                agent: context.agent,
                source: permissionSource,
              })
              if (replacements === 0) {
                // A line that carries Read's prefix while not every line does keeps the strip fallback from
                // applying, so point the model at the prefix it left in.
                const hint =
                  unprefixedOld === undefined && input.oldString.split("\n").some((line) => readLinePrefix.test(line))
                    ? " Hint: remove the 'N: ' line-number prefixes that Read adds; they are not part of the file."
                    : ""
                return yield* new ToolFailure({
                  message: `Could not find oldString in ${input.path}. It must match exactly, including whitespace and indentation. The file may have changed since it was last read, or the copied text differs in indentation (tabs vs spaces); re-read the file and retry with its current content.${hint}`,
                })
              }
              if (replacements > 1 && input.replaceAll !== true) {
                return yield* new ToolFailure({
                  message: indent
                    ? `oldString matches ${replacements} locations only when indentation is ignored, and not exactly anywhere. Check tabs vs spaces, re-read the file, and add surrounding context to make oldString unique.`
                    : `Found ${replacements} matches for oldString, but expected exactly one. Add more surrounding context to make oldString unique, or set replaceAll to true to replace every occurrence.`,
                })
              }
              if (replaced === source) {
                return yield* new ToolFailure({
                  message: endingsOnly
                    ? `No changes to apply: ${input.path} already has those line endings.`
                    : `No changes to apply: the edit leaves ${input.path} unchanged. Line endings follow the file; to change them, write \\r explicitly in oldString or newString.`,
                })
              }
              const replacementBom = replaced.startsWith("\uFEFF")
              const result = yield* fileMutation.write({
                target,
                content: Bom.join(replaced, original.bom || replacementBom),
              })
              const bom = original.bom || replacementBom
              const formatted = (yield* formatter.file(target.absolute))
                ? yield* FileMutation.syncTextBom(environment.files, target.absolute, bom)
                : (yield* FileMutation.readText(environment.files, target.absolute)).text
              return {
                files: [fileDiff(result.resource, source, formatted)],
                replacements,
              } satisfies Output
            }).pipe(
              fileMutation.withLock([FileAccess.resolvePath(location.directory, input.path)]),
              Effect.map((output) => ({
                output,
                content: `Edited ${output.files[0]?.file} (${output.replacements} replacement${output.replacements === 1 ? "" : "s"})`,
                metadata: { files: output.files },
              })),
              Effect.mapError((error) =>
                error instanceof ToolFailure
                  ? error
                  : new ToolFailure({ message: `Unable to edit ${input.path}`, error }),
              ),
            )
          },
        }),
      )
      .pipe(Effect.orDie)
  }),
}
