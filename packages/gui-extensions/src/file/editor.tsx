import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { showToast } from "@opencode/ui/toast"
import { getDirectory } from "@opencode/util/path"
import { Compartment, EditorState, type Extension } from "@codemirror/state"
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  scrollPastEnd,
} from "@codemirror/view"
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
import { bracketMatching, foldGutter, HighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language"
import {
  findNext,
  findPrevious,
  highlightSelectionMatches,
  SearchCursor,
  SearchQuery,
  search,
  searchKeymap,
  setSearchQuery,
} from "@codemirror/search"
import { tags } from "@lezer/highlight"
import type { FileSearchHandle } from "@opencode/session-ui/file"
import { createKeyed, useExtension, type LineRange, type MountedSession, type SessionScreen } from "../sdk"
import { useShared } from "./context"
import { editorLanguage } from "./editor-language"

// Syntax colors read the app's `--syntax-*` tokens, so the light and dark themes both hold without a second style.
const highlight = HighlightStyle.define([
  { tag: tags.comment, color: "var(--syntax-comment)" },
  { tag: tags.string, color: "var(--syntax-string)" },
  { tag: tags.regexp, color: "var(--syntax-regexp)" },
  {
    tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword, tags.operatorKeyword, tags.moduleKeyword],
    color: "var(--syntax-keyword)",
  },
  { tag: [tags.atom, tags.bool, tags.null, tags.number], color: "var(--syntax-primitive)" },
  { tag: tags.variableName, color: "var(--syntax-variable)" },
  { tag: [tags.propertyName, tags.attributeName], color: "var(--syntax-property)" },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "var(--syntax-type)" },
  { tag: [tags.standard(tags.variableName), tags.constant(tags.variableName)], color: "var(--syntax-constant)" },
  { tag: tags.operator, color: "var(--syntax-operator)" },
  { tag: [tags.punctuation, tags.bracket], color: "var(--syntax-punctuation)" },
  { tag: tags.heading, color: "var(--markdown-heading)" },
  { tag: tags.link, color: "var(--markdown-link)" },
  { tag: tags.emphasis, color: "var(--markdown-emph)", fontStyle: "italic" },
  { tag: tags.strong, color: "var(--markdown-strong)", fontWeight: "670" },
  { tag: tags.invalid, color: "var(--syntax-critical)" },
])

// Chrome colors read the app's theme tokens the same way, instead of CodeMirror's own light defaults.
const theme = () =>
  EditorView.theme(
    {
      "&": { color: "var(--text-base)", backgroundColor: "transparent", height: "100%", fontSize: "13px" },
      ".cm-scroller": { fontFamily: "var(--font-family-mono)", lineHeight: "20px" },
      ".cm-content": { caretColor: "var(--text-strong)" },
      ".cm-cursor, .cm-dropCursor": { borderLeft: "2px solid var(--text-strong)" },
      "&.cm-focused": { outline: "none" },
      ".cm-gutters": { backgroundColor: "transparent", color: "var(--text-weaker)", border: "none" },
      ".cm-activeLine": { backgroundColor: "var(--surface-base)" },
      ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text-weak)" },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
        backgroundColor: "var(--surface-raised-base)",
      },
      ".cm-searchMatch": { backgroundColor: "var(--surface-weak)" },
      ".cm-searchMatch-selected": { backgroundColor: "var(--surface-strong)" },
      ".cm-panels": {
        backgroundColor: "var(--background-base)",
        color: "var(--text-base)",
        borderBottom: "1px solid var(--border-weak-base)",
      },
      ".cm-panel input, .cm-panel button": {
        backgroundColor: "var(--background-weak)",
        color: "var(--text-base)",
        border: "1px solid var(--border-weak-base)",
        borderRadius: "4px",
      },
      ".cm-foldPlaceholder": {
        backgroundColor: "var(--surface-weak)",
        border: "none",
        color: "var(--text-weak)",
      },
    },
    // Only a hint for CodeMirror's own defaults; the colors above follow the app theme either way.
    { dark: window.matchMedia("(prefers-color-scheme: dark)").matches },
  )

/** Loads the path's language package; a file without one edits as plain text. */
async function languageExtension(path: string): Promise<Extension> {
  const language = editorLanguage(path)

  switch (language) {
    case "javascript":
    case "jsx":
    case "typescript":
    case "tsx": {
      const { javascript } = await import("@codemirror/lang-javascript")

      return javascript({
        typescript: language === "typescript" || language === "tsx",
        jsx: language === "jsx" || language === "tsx",
      })
    }

    case "json": {
      const { json } = await import("@codemirror/lang-json")

      return json()
    }

    case "html": {
      const { html } = await import("@codemirror/lang-html")

      return html()
    }

    case "css": {
      const { css } = await import("@codemirror/lang-css")

      return css()
    }

    case "markdown": {
      const { markdown } = await import("@codemirror/lang-markdown")

      return markdown()
    }

    case "python": {
      const { python } = await import("@codemirror/lang-python")

      return python()
    }

    default:
      return []
  }
}

/**
 * The middle column's editable text view: CodeMirror with dirty tracking, Ctrl/Cmd+S writing the document back
 * through `fs.write`, and a draft that survives tab switches. A save that fails turns the document read-only with
 * the error and a way back to editing, never dropping the text.
 */
export default function FileEditor(props: {
  session: MountedSession
  screen: SessionScreen
  path: string
  content: string
  search: { register(handle: FileSearchHandle | null): void }
}) {
  const ctx = useExtension()
  const shared = useShared()
  const file = props.screen.file
  const draft = shared.edit.get(file.root, props.path)
  // The disk content the editor last knew; the dirty check compares the document against it. A restored draft
  // keeps the baseline it was written against, so an externally rewritten file conflicts rather than hiding
  // behind the model's current content.
  let saved = draft?.text !== undefined ? (draft.baseline ?? props.content) : props.content
  let saving = false
  let view: EditorView | undefined
  let host: HTMLDivElement | undefined
  const language = new Compartment()
  const editable = new Compartment()
  const [failed, setFailed] = createSignal<string>()
  // The disk changed behind unsaved edits, e.g. the task or another program rewrote the file; a save would
  // silently drop those external changes, so the user decides between them first.
  const [conflict, setConflict] = createSignal(false)
  const [savedFlash, setSavedFlash] = createSignal(false)
  const [findOpen, setFindOpen] = createSignal(false)
  const [findText, setFindText] = createSignal("")
  // Bumped by the editor's update listener, so the find bar's counter follows typing and selection moves.
  const [findTick, setFindTick] = createSignal(0)
  let findInput: HTMLInputElement | undefined
  let flashTimer: ReturnType<typeof setTimeout> | undefined

  // The find bar's x/y counter: how many matches the document holds, and which one a find steps to next.
  const matches = createMemo(() => {
    const text = findText()
    findTick()
    const current = view

    if (!current || !text) return { total: 0, active: 0 }

    let total = 0
    let before = 0
    const head = current.state.selection.main.head
    // The lowercasing normalize makes the count case-insensitive, like the find bar's stepping.
    const cursor = new SearchCursor(current.state.doc, text, 0, undefined, (value) => value.toLowerCase())

    while (!cursor.next().done) {
      total++

      if (cursor.value.from < head) before++
    }

    return { total, active: total === 0 ? 0 : (before % total) + 1 }
  })

  const findStep = (forward: boolean) => {
    const current = view

    if (!current) return

    if (forward) findNext(current)
    else findPrevious(current)
  }

  const closeFind = () => {
    setFindOpen(false)
    view?.focus()
    view?.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "" })) })
  }

  // The editor's search query follows the find bar's text: the query drives CodeMirror's match
  // highlighting, and findNext/findPrevious step through its results.
  createKeyed(() => findText(), (text) => {
    view?.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: text })) })
  })

  // The unsaved text is kept only while it differs from disk, so an idle draft costs no memory beyond its view.
  // The baseline travels with it, so a later view knows which disk version the edits sit on.
  const storeDraft = () => {
    const current = view

    if (!current) return

    const selection = current.state.selection.main
    const text = current.state.doc.toString()

    shared.edit.set(file.root, props.path, {
      text: text === saved ? undefined : text,
      baseline: text === saved ? undefined : saved,
      top: current.scrollDOM.scrollTop,
      anchor: selection.anchor,
      head: selection.head,
    })
  }

  const applyRange = (range: LineRange | null | undefined) => {
    const current = view

    if (!current || !range) return

    const doc = current.state.doc
    const first = doc.line(Math.max(1, Math.min(range.start, range.end)))
    const last = doc.line(Math.min(doc.lines, Math.max(range.start, range.end)))

    current.dispatch({
      selection: { anchor: first.from, head: last.to },
      effects: EditorView.scrollIntoView(first.from),
    })
  }

  // Writes the document without further checks; the save path calls this once the disk baseline holds or the
  // user chose to overwrite.
  const write = () => {
    const current = view

    if (!current || saving) return

    const text = current.state.doc.toString()

    saving = true
    const path = props.path

    // A workspace-relative path writes against the root; an absolute one names its own target, as reads resolve them.
    const target = file.absolute(path)
      ? { path, location: { directory: getDirectory(path) } }
      : { path, location: { directory: file.root } }

    void props.session.server.client.file
      .write({ ...target, payload: new TextEncoder().encode(text) })
      .then(() => {
        saving = false

        if (!view) return

        saved = text
        setFailed(undefined)
        setConflict(false)
        storeDraft()

        setSavedFlash(true)

        if (flashTimer !== undefined) clearTimeout(flashTimer)

        flashTimer = setTimeout(() => setSavedFlash(false), 1500)

        // Refresh the model's content and uncommitted-change view; the reconcile below sees the saved text.
        void file.sync(path, { force: true })
      })
      .catch((error) => {
        saving = false

        if (!view) return

        const message = error instanceof Error ? error.message : String(error)

        setFailed(message)
        showToast({ variant: "error", title: ctx.t("editor.saveFailed"), description: message })
      })
  }

  // A save first checks the disk still holds the content the editor last knew: a task or another program may
  // have rewritten the file since, and writing the document would silently drop those changes.
  const save = () => {
    const current = view

    if (!current || saving) return true

    const text = current.state.doc.toString()

    if (text === saved) return true

    saving = true
    const path = props.path

    void file
      .sync(path, { force: true })
      .then(() => {
        saving = false

        if (!view) return

        // The disk content the editor never saw means the baseline moved; the user decides between the versions.
        if ((file.get(path)?.content?.content ?? saved) !== saved) {
          setConflict(true)

          return
        }

        write()
      })
      .catch(() => {
        saving = false

        // The check failed, e.g. the server is unreachable; keep the old direct-save behaviour.
        write()
      })

    return true
  }

  // Replaces the document with the disk's current content, dropping the edits that sat on the old baseline.
  const loadDiskVersion = () => {
    const current = view

    if (!current) return

    void file
      .sync(props.path, { force: true })
      .then(() => {
        const content = file.get(props.path)?.content?.content

        if (!view || content === undefined) return

        saved = content
        const top = current.scrollDOM.scrollTop

        current.dispatch({ changes: { from: 0, to: current.state.doc.length, insert: content } })
        current.scrollDOM.scrollTop = top
        storeDraft()
        setConflict(false)
      })
      .catch(() => {
        if (!view) return

        setConflict(false)
      })
  }

  onMount(() => {
    if (!host) return

    const created = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: draft?.text ?? props.content,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          foldGutter(),
          drawSelection(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          syntaxHighlighting(highlight),
          // Holds the find bar's query, which lights the document's matches.
          search(),
          bracketMatching(),
          rectangularSelection(),
          crosshairCursor(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          scrollPastEnd(),
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            indentWithTab,
            { key: "Mod-s", preventDefault: true, run: save },
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) storeDraft()

            if (update.docChanged || update.selectionSet) setFindTick((tick) => tick + 1)
          }),
          language.of([]),
          editable.of([]),
          theme(),
        ],
      }),
    })

    view = created

    // A returning draft restores where the user left; a fresh view opens on the range a link selected.
    if (draft) {
      created.dispatch({ selection: { anchor: draft.anchor, head: draft.head } })
      created.scrollDOM.scrollTop = draft.top
    } else {
      applyRange(file.ready() ? file.selection.get(props.path) : shared.handoff.get(props.session.key, props.path))
    }

    void languageExtension(props.path).then((extension) => {
      // The view can be gone or remounted while the package loaded; only the one that asked applies it.
      if (view !== created) return

      created.dispatch({ effects: language.reconfigure(extension) })
    })

    props.search.register({
      focus: () => {
        setFindOpen(true)
        requestAnimationFrame(() => {
          findInput?.focus()
          findInput?.select()
        })
      },
    })
  })

  onCleanup(() => {
    props.search.register(null)
    storeDraft()
    view?.destroy()
    view = undefined

    if (flashTimer !== undefined) clearTimeout(flashTimer)
  })

  // A reloaded file replaces the document only while it holds no unsaved edits: the user's text wins until saved.
  createKeyed(
    () => props.content,
    (content) => {
      const current = view

      if (!current) return

      const text = current.state.doc.toString()

      if (text === content) {
        saved = content
        setConflict(false)

        return
      }

      if (text !== saved) {
        // Unsaved edits on a baseline the disk no longer holds: a save would drop the external changes, so
        // the conflict shows now rather than at the save.
        if (content !== saved) setConflict(true)

        return
      }

      saved = content
      const top = current.scrollDOM.scrollTop

      current.dispatch({ changes: { from: 0, to: current.state.doc.length, insert: content } })
      current.scrollDOM.scrollTop = top
      storeDraft()
    },
  )

  // A failed save leaves the document read-only, so edits cannot drift further from a file that will not take them.
  createKeyed(failed, () => {
    const current = view

    if (!current) return

    current.dispatch({ effects: editable.reconfigure(EditorState.readOnly.of(true)) })

    onCleanup(() => {
      if (!view) return

      view.dispatch({ effects: editable.reconfigure([]) })
    })
  })

  // A link that targets the open file reveals its range here, as it scrolls the read-only code view.
  createKeyed(
    () => ({ session: props.session.key, path: props.path }),
    (target) =>
      onCleanup(
        shared.reveal.register(target.session, target.path, () => {
          applyRange(file.selection.get(target.path))
        }),
      ),
    { equals: (previous, next) => previous.session === next.session && previous.path === next.path },
  )

  return (
    <div class="relative min-h-0 flex-1">
      <div ref={host} class="h-full overflow-hidden" />
      {/* The in-file find bar: text, a x/y counter, and stepping; Enter and Shift+Enter step, Escape closes. */}
      <Show when={findOpen()}>
        <div class="absolute end-3 top-3 z-10 flex items-center gap-1 rounded-md border border-v2-border-border-muted bg-v2-background-bg-base px-2 py-1 shadow-[var(--v2-elevation-raised)]">
          <input
            ref={findInput}
            class="w-44 bg-transparent text-12-regular text-text-base outline-none placeholder:text-text-faint"
            placeholder={ctx.t("editor.find.placeholder")}
            aria-label={ctx.t("editor.find.placeholder")}
            value={findText()}
            onInput={(event) => setFindText(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                findStep(!event.shiftKey)
              }

              if (event.key === "Escape") {
                event.preventDefault()
                closeFind()
              }
            }}
          />
          <span class="shrink-0 text-11-regular text-text-weak">
            {ctx.t("editor.find.matches", { active: matches().active, total: matches().total })}
          </span>
          <IconButton
            size="small"
            variant="ghost"
            icon={<Icon name="chevron-up" size="small" />}
            aria-label={ctx.t("editor.find.previous")}
            onClick={() => findStep(false)}
          />
          <IconButton
            size="small"
            variant="ghost"
            icon={<Icon name="chevron-down" size="small" />}
            aria-label={ctx.t("editor.find.next")}
            onClick={() => findStep(true)}
          />
          <IconButton
            size="small"
            variant="ghost"
            icon={<Icon name="close" size="small" />}
            aria-label={ctx.t("editor.find.close")}
            onClick={closeFind}
          />
        </div>
      </Show>
      <Show when={savedFlash()}>
        <div class="pointer-events-none absolute end-3 top-3 rounded-md bg-v2-background-bg-base px-2 py-1 text-12-medium text-text-weak shadow-[var(--v2-elevation-raised)]">
          {ctx.t("editor.saved")}
        </div>
      </Show>
      <Show when={conflict() && !failed()}>
        <div class="absolute inset-x-3 top-3 flex items-center gap-2 rounded-md border border-v2-border-border-muted bg-v2-background-bg-base px-3 py-2 text-12-regular text-text-base shadow-[var(--v2-elevation-raised)]">
          <span class="min-w-0 flex-1 truncate">{ctx.t("editor.conflict")}</span>
          <Button size="small" variant="ghost" onClick={loadDiskVersion}>
            {ctx.t("editor.conflict.reload")}
          </Button>
          <Button size="small" variant="ghost" onClick={write}>
            {ctx.t("editor.conflict.overwrite")}
          </Button>
          <Button size="small" variant="ghost" onClick={() => setConflict(false)}>
            {ctx.t("editor.conflict.keepEditing")}
          </Button>
        </div>
      </Show>
      <Show when={failed()}>
        {(message) => (
          <div class="absolute inset-x-3 top-3 flex items-center gap-2 rounded-md border border-v2-border-border-muted bg-v2-background-bg-base px-3 py-2 text-12-regular text-text-base shadow-[var(--v2-elevation-raised)]">
            <span class="shrink-0 text-text-strong">{ctx.t("editor.readonly")}</span>
            <span class="min-w-0 flex-1 truncate">{message()}</span>
            <Button size="small" variant="ghost" onClick={() => setFailed(undefined)}>
              {ctx.t("editor.keepEditing")}
            </Button>
          </div>
        )}
      </Show>
    </div>
  )
}
