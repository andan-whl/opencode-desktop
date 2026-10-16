import { createMemo, createSignal, For, Show } from "solid-js"
import { createQuery, keepPreviousData } from "@tanstack/solid-query"
import { Icon } from "@opencode/ui/icon"
import { TextInput } from "@opencode/ui/text-input"
import { useExtension, type MountedSession, type SessionScreen } from "../sdk"
import { useShared } from "./context"

interface ContentMatch {
  readonly path: string
  readonly line: number
  readonly text: string
  readonly hit: string
}

interface SearchResults {
  readonly names: readonly string[]
  readonly content: readonly ContentMatch[]
}

const emptyResults: SearchResults = { names: [], content: [] }

/** Full-text search beside the side panel: file names and content matches, grouped per file. */
export default function FileSearchView(props: { session: MountedSession; screen: SessionScreen }) {
  const ctx = useExtension()
  const shared = useShared()
  const file = props.screen.file
  const [input, setInput] = createSignal("")
  const [query, setQuery] = createSignal("")
  const [caseSensitive, setCaseSensitive] = createSignal(false)
  const [literal, setLiteral] = createSignal(false)

  // One quiet debounce: typing settles before the server sees the pattern.
  let timer: ReturnType<typeof setTimeout> | undefined
  const onInput = (value: string) => {
    setInput(value)
    clearTimeout(timer)
    timer = setTimeout(() => setQuery(value.trim()), 250)
  }

  const search = createQuery(() => {
    const value = query()

    return {
      queryKey: [ctx.id, props.session.server.id, "file-search", file.root, value, caseSensitive(), literal()] as const,
      enabled: props.session.server.connected && value.length >= 2,
      placeholderData: keepPreviousData,
      queryFn: async ({ signal }): Promise<SearchResults> => {
        const names = await file.search(value, { kind: "file", limit: 50, signal }).catch(() => [])
        // Submatch offsets are byte-based; indexOf keeps the highlight useful for ASCII-dominant text.
        const content = await props.session.server.client.file
          .grep(
            {
              location: { directory: file.root },
              pattern: value,
              literal: literal(),
              caseSensitive: caseSensitive(),
              limit: 200,
            },
            { signal },
          )
          .then((result) =>
            result.data.flatMap((match) => {
              const text = match.text.trimEnd()
              const hit = match.submatches[0]?.text

              return hit === undefined || !text.includes(hit)
                ? []
                : [{ path: match.entry.path, line: match.line, text, hit }]
            }),
          )
          .catch(() => [])

        return { names, content }
      },
    }
  })

  const results = createMemo(() => search.data ?? emptyResults)
  const searching = createMemo(() => query().length >= 2 && search.isFetching)
  const byFile = createMemo(() => {
    const groups = new Map<string, ContentMatch[]>()

    for (const match of results().content) {
      const list = groups.get(match.path)

      if (list) list.push(match)
      else groups.set(match.path, [match])
    }

    return [...groups.entries()]
  })

  const open = (path: string, line?: number) => {
    if (line !== undefined) file.selection.set(path, { start: line, end: line })
    shared.open(props.session, path)
  }

  const highlight = (match: ContentMatch) => {
    const at = match.text.indexOf(match.hit)

    return (
      <>
        {match.text.slice(0, at)}
        <span class="rounded-[2px] bg-v2-icon-icon-accent px-0.5 text-v2-background-bg-deep">
          {match.text.slice(at, at + match.hit.length)}
        </span>
        {match.text.slice(at + match.hit.length)}
      </>
    )
  }

  const toggle = (active: () => boolean, apply: (value: boolean) => void, label: string) => (
    <button
      type="button"
      aria-pressed={active()}
      aria-label={label}
      title={label}
      classList={{
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-11-medium": true,
        "bg-surface-raised-base-hover text-text-strong": active(),
        "text-text-weak hover:bg-surface-raised-base-hover": !active(),
      }}
      onClick={() => apply(!active())}
    >
      {label === ctx.t("search.caseSensitive") ? "Aa" : ".*"}
    </button>
  )

  return (
    <div class="flex h-full flex-col">
      <div class="flex items-center gap-1.5 px-3 pt-3">
        <TextInput
          type="text"
          spellcheck={false}
          autocapitalize="off"
          autocomplete="off"
          aria-label={ctx.t("search.placeholder")}
          placeholder={ctx.t("search.placeholder")}
          value={input()}
          onInput={(event) => onInput(event.currentTarget.value)}
          class="flex-1"
        />
        {toggle(caseSensitive, setCaseSensitive, ctx.t("search.caseSensitive"))}
        {toggle(literal, setLiteral, ctx.t("search.literal"))}
      </div>
      <Show when={query().length >= 2 && !searching() && results().names.length === 0 && byFile().length === 0}>
        <div class="flex flex-1 items-center justify-center px-6 pb-64 text-center text-12-regular text-text-weak">
          {ctx.t("search.empty")}
        </div>
      </Show>
      <div class="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-2">
        <Show when={results().names.length > 0}>
          <div class="px-2 pb-1 text-10-medium uppercase tracking-wide text-text-weak">
            {ctx.t("search.filesSection")}
          </div>
          <ul class="mb-3">
            <For each={results().names}>
              {(path) => (
                <li>
                  <button
                    type="button"
                    class="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-12-regular hover:bg-surface-raised-base-hover"
                    onClick={() => open(path)}
                  >
                    <Icon name="file" class="shrink-0 text-icon-base" />
                    <span class="truncate text-text-strong">{path}</span>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <Show when={byFile().length > 0}>
          <div class="px-2 pb-1 text-10-medium uppercase tracking-wide text-text-weak">
            {ctx.t("search.contentSection")}
          </div>
          <For each={byFile()}>
            {([path, matches]) => (
              <div class="mb-2">
                <button
                  type="button"
                  class="flex w-full items-center gap-2 rounded-[6px] px-2 py-1 text-left font-mono text-11-regular text-text-strong hover:bg-surface-raised-base-hover"
                  onClick={() => open(path, matches[0].line)}
                >
                  <Icon name="file" class="shrink-0 text-icon-base" />
                  <span class="truncate">{path}</span>
                </button>
                <ul>
                  <For each={matches}>
                    {(match) => (
                      <li>
                        <button
                          type="button"
                          class="flex w-full items-baseline gap-2 rounded-[6px] px-2 py-1 text-left hover:bg-surface-raised-base-hover"
                          onClick={() => open(match.path, match.line)}
                        >
                          <span class="w-8 shrink-0 text-right font-mono text-10-regular text-text-faint tabular-nums">
                            {match.line}
                          </span>
                          <span class="min-w-0 truncate font-mono text-11-regular text-text-weak">
                            {highlight(match)}
                          </span>
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  )
}
