import { parseDiffFromFile, parsePatchFiles, processFile, type FileDiffMetadata } from "@pierre/diffs"
import { parsePatch } from "diff"
import { createSignal } from "solid-js"
import { checksum } from "@opencode/util/encode"
import type { FileDiffInfo } from "@opencode/client/promise"
import type { PresentationFileDiff } from "../file-presentation"

type LegacyDiff = {
  file: string
  patch?: string
  before?: string
  after?: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
}

type ReviewDiff = (PresentationFileDiff & { file: string }) | FileDiffInfo | LegacyDiff

export type DiffSource = Pick<LegacyDiff, "file" | "patch" | "before" | "after">

export type ViewDiff = {
  file: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
  fileDiff: FileDiffMetadata
}

const diffCacheLimit = 16

const patchFileDiffCache = new Map<string, FileDiffMetadata>()

// Change sets an apply-all or revert-all settled, keyed by session id. A settled set stays dismissed everywhere it
// would show — the changed-files list and the editor's whole-file diff — until a later turn changes files again, which
// yields a different fingerprint. Module-level so remounts (tab switches) keep the dismissal.
const [settledChanges, setSettledChanges] = createSignal(new Map<string, string>())

/** The identity of a change set: the same files with the same line counts fingerprint the same, whatever their content. */
export function changesFingerprint(files: ReadonlyArray<Pick<FileDiffInfo, "file" | "additions" | "deletions">>) {
  return files.map((diff) => `${diff.file}:${diff.additions}:${diff.deletions}`).join("\n")
}

/** Records that a session's change set was applied or reverted in full, so it stays dismissed until files change again. */
export function markChangesSettled(sessionID: string, fingerprint: string) {
  setSettledChanges((current) => new Map(current).set(sessionID, fingerprint))
}

/** Whether the session's change set with this fingerprint was already applied or reverted in full. */
export function changesSettled(sessionID: string | undefined, fingerprint: string) {
  return !!sessionID && settledChanges().get(sessionID) === fingerprint
}

export function resolveFileDiff(diff: DiffSource) {
  // Untyped persisted payloads may carry `patch: null`; those render from their contents.
  if (diff.patch != null) return fileDiffFromPatch(diff.file, diff.patch)

  return fileDiffFromContent(diff.file, diff.before ?? "", diff.after ?? "")
}

/**
 * The diff of a complete patch with its single full-context hunk kept unsplit: the whole file shows as one hunk,
 * its changed lines highlighted in place, as Gerrit's file view does. A partial patch falls back to the collapsed
 * hunks of `resolveFileDiff`.
 */
export function resolveWholeFileDiff(diff: DiffSource) {
  if (diff.patch == null) return resolveFileDiff(diff)

  const key = `${diff.file}\0${diff.patch}`
  const complete = completePatch(diff.patch)

  if (!complete) return fileDiffFromPatch(diff.file, diff.patch)

  // "\\" marker lines annotate the line before them; every other line counts toward one side.
  const oldCount = complete.lines.filter((line) => !line.startsWith("+") && !line.startsWith("\\")).length
  const newCount = complete.lines.filter((line) => !line.startsWith("-") && !line.startsWith("\\")).length
  const hunk = `@@ -${oldCount === 0 ? 0 : 1},${oldCount} +${newCount === 0 ? 0 : 1},${newCount} @@\n${complete.lines.join("\n")}`

  const value =
    processFile(`--- a\n+++ a\n${hunk}`, {
      isGitDiff: false,
      oldFile: { name: diff.file, contents: complete.before },
      newFile: { name: diff.file, contents: complete.after },
    }) ?? emptyFileDiff(diff.file)

  value.name = diff.file
  value.cacheKey = highlightKey(`${key}\0whole`)

  return value
}

export function normalize(diff: ReviewDiff): ViewDiff {
  return {
    file: diff.file,
    additions: diff.additions,
    deletions: diff.deletions,
    status: diff.status,
    fileDiff: resolveFileDiff(diff),
  }
}

export function text(diff: ViewDiff, side: "deletions" | "additions") {
  if (side === "deletions") return diff.fileDiff.deletionLines.join("")

  return diff.fileDiff.additionLines.join("")
}

function fileDiffFromPatch(file: string, patch: string) {
  const key = `${file}\0${patch}`
  const hit = patchFileDiffCache.get(key)

  if (hit) {
    patchFileDiffCache.delete(key)
    patchFileDiffCache.set(key, hit)

    return hit
  }

  const complete = completePatch(patch)
  const input = complete ? undefined : patchInput(file, patch)

  const value = complete
    ? fileDiffFromCompletePatch(file, complete)
    : ((input ? parsePatchFiles(input)[0]?.files[0] : undefined) ?? emptyFileDiff(file))

  // The patch text fixes both the content and the producer's alignment, so equal keys always mean equal hunks.
  value.cacheKey = highlightKey(key)
  patchFileDiffCache.set(key, value)

  while (patchFileDiffCache.size > diffCacheLimit) patchFileDiffCache.delete(patchFileDiffCache.keys().next().value!)

  return value
}

export function completePatchContents(patch: string) {
  const complete = completePatch(patch)

  if (!complete) return

  return { before: complete.before, after: complete.after }
}

function completePatch(patch: string) {
  try {
    const parsed = parsePatch(patch)[0]

    if (!parsed || (!parsed.index && !parsed.oldFileName && !parsed.newFileName)) return

    // Snapshot and VCS producers request full context. Tool patches use jsdiff's shorter default context.
    if (!patch.startsWith("diff --git ") && !/^--- [^\n]*\t\r?\n\+\+\+ [^\n]*\t(?:\r?\n|$)/m.test(patch)) return

    // Full patches collapse into one leading hunk. Separated hunks omit ranges and must stay partial.
    if (parsed.hunks.length !== 1) return

    const hunk = parsed.hunks[0]

    if (!hunk || hunk.oldStart > 1 || hunk.newStart > 1) return

    const before: Array<{ text: string; newline: boolean }> = []
    const after: Array<{ text: string; newline: boolean }> = []
    let previous: "-" | "+" | " " | undefined

    for (const line of hunk.lines) {
      if (line.startsWith("\\")) {
        if (previous === "-" || previous === " ") {
          const value = before.at(-1)

          if (value) value.newline = false
        }

        if (previous === "+" || previous === " ") {
          const value = after.at(-1)

          if (value) value.newline = false
        }

        continue
      }

      if (line.startsWith("-")) {
        before.push({ text: line.slice(1), newline: true })
        previous = "-"
        continue
      }

      if (line.startsWith("+")) {
        after.push({ text: line.slice(1), newline: true })
        previous = "+"
        continue
      }

      if (!line.startsWith(" ")) return
      before.push({ text: line.slice(1), newline: true })
      after.push({ text: line.slice(1), newline: true })
      previous = " "
    }

    const text = (lines: Array<{ text: string; newline: boolean }>) =>
      lines.map((line) => line.text + (line.newline ? "\n" : "")).join("")

    return { before: text(before), after: text(after), lines: hunk.lines }
  } catch {
    return
  }
}

// A complete patch already carries the producer's line diff. Splitting its single full-context hunk at long
// unchanged runs yields, in linear time, the collapsed hunks Pierre would get by diffing the reconstructed files
// again whenever both algorithms choose the same alignment.
function fileDiffFromCompletePatch(file: string, patch: { before: string; after: string; lines: string[] }) {
  // Pierre reads names back from header text, so a fixed header keeps tabs, quotes, and newlines in `file` intact.
  const value =
    processFile(`--- a\n+++ a\n${splitHunk(patch.lines)}`, {
      isGitDiff: false,
      oldFile: { name: file, contents: patch.before },
      newFile: { name: file, contents: patch.after },
    }) ?? emptyFileDiff(file)

  value.name = file

  return value
}

// Pierre's file diffs use jsdiff's default of four context lines; longer unchanged runs end one hunk and start the next.
const hunkContext = 4

function splitHunk(lines: string[]) {
  const rows = lines.reduce<{ line: string; marker?: string }[]>((result, line) => {
    const previous = result.at(-1)

    // A marker annotates the line before it; completePatch ignores a marker with nothing to annotate.
    if (line.startsWith("\\")) {
      if (previous) previous.marker = line

      return result
    }

    result.push({ line })

    return result
  }, [])

  const changes = rows.flatMap((row, index) => (row.line.startsWith(" ") ? [] : [index]))

  const ranges = changes.reduce<{ start: number; end: number }[]>((result, index) => {
    const previous = result.at(-1)
    const start = Math.max(0, index - hunkContext)
    const end = Math.min(rows.length - 1, index + hunkContext)

    if (previous && start <= previous.end + 1) {
      previous.end = end

      return result
    }

    result.push({ start, end })

    return result
  }, [])

  const positions = rows.reduce<{ old: number; new: number }[]>(
    (result, row) => {
      const current = result.at(-1)!

      result.push({
        old: current.old + (row.line.startsWith("+") ? 0 : 1),
        new: current.new + (row.line.startsWith("-") ? 0 : 1),
      })

      return result
    },
    [{ old: 0, new: 0 }],
  )

  return ranges
    .map((range) => {
      const start = positions[range.start]!
      const end = positions[range.end + 1]!
      const oldCount = end.old - start.old
      const newCount = end.new - start.new

      const body = rows
        .slice(range.start, range.end + 1)
        .map((row) => (row.marker ? `${row.line}\n${row.marker}` : row.line))
        .join("\n")

      return `@@ -${oldCount === 0 ? start.old : start.old + 1},${oldCount} +${newCount === 0 ? start.new : start.new + 1},${newCount} @@\n${body}`
    })
    .join("\n")
}

function patchInput(file: string, patch: string) {
  try {
    const parsed = parsePatch(patch)[0]

    if (!parsed) return

    if (parsed.index || parsed.oldFileName || parsed.newFileName) return patch

    if (!parsed.hunks.length) return

    return `Index: ${file}\n===================================================================\n--- ${file}\t\n+++ ${file}\t\n${patch}`
  } catch {
    return
  }
}

function fileDiffFromContent(file: string, before: string, after: string) {
  if (!before && !after) return emptyFileDiff(file)
  const value = parseDiffFromFile({ name: file, contents: before }, { name: file, contents: after })
  value.cacheKey = highlightKey(`${file}\0${before}\0${after}`)

  return value
}

// Pierre reuses and dedups worker highlighting only for diffs that carry a cacheKey, and it treats diffs with equal
// keys as the same target. Derive the key from every input that shapes the highlighted output: the file name selects
// the language and the content selects the lines.
function highlightKey(value: string) {
  return `${value.length}:${checksum(value) ?? 0}`
}

function emptyFileDiff(file: string) {
  return parseDiffFromFile({ name: file, contents: "" }, { name: file, contents: "" })
}
