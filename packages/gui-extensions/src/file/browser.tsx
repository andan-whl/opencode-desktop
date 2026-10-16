import { createMemo, createUniqueId, onCleanup, Show, type Accessor, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { createQuery, keepPreviousData } from "@tanstack/solid-query"
import { useI18n } from "@opencode/ui/context/i18n"
import { ScrollView } from "@opencode/ui/scroll-view"
import { TextInput } from "@opencode/ui/text-input"
import { SessionFilePanelV2, SessionFilePanelV2Empty } from "@opencode/session-ui/v2/session-file-panel-v2"
import { SessionReviewV2Sidebar } from "@opencode/session-ui/v2/session-review-v2"
import { Icon } from "@opencode/ui/icon"
import { getFilename } from "@opencode/util/path"
import type { ChangeKind } from "../review/contract"
import {
  createKeyed,
  useExtension,
  usePanel,
  type MountedSession,
  type PanelTab,
  type SessionScreen,
} from "../sdk"
import { current, useShared } from "./context"
import SessionFileList, { applyFileListKeyDown } from "./list"
import { fileTabPath, isFileTab } from "./path"
import FileTreeV2 from "./tree-v2"
import { SessionFileView } from "./view"

const emptyFiles: string[] = []

export function SessionFileBrowserTab(props: {
  session: MountedSession
  screen: SessionScreen
  /** The file tab to show; absent while browsing. */
  id?: string
  placeholder: boolean
  active?: string
  kinds: ReadonlyMap<string, ChangeKind>
  onSelect: (path: string) => void
  onSelectPermanent: (path: string) => void
  filterRef?: (element: HTMLInputElement) => void
  mobile?: boolean
}) {
  const ctx = useExtension()
  const i18n = useI18n()
  const shared = useShared()
  const file = props.screen.file
  const resultsID = `session-file-browser-results-${createUniqueId()}`
  const [store, setStore] = createStore<{ explicitHighlight?: string }>({})
  const filter = () => shared.filter.get(props.session.key)
  const setFilter = (value: string) => shared.filter.set(props.session.key, value)
  const setExplicitHighlight = (value: string) => setStore("explicitHighlight", value)
  const query = createMemo(() => filter().trim())

  const search = createQuery(() => {
    const value = query()

    return {
      queryKey: [ctx.id, props.session.server.id, "session-open-file", file.root, value] as const,
      enabled: props.session.server.connected && value.length > 0,
      queryFn: ({ signal }) => file.search(value, { limit: 200, signal }),
      placeholderData: keepPreviousData,
    }
  })

  const files = createMemo(() => {
    if (!query() || search.isPending) return emptyFiles

    return [...new Set(search.data ?? emptyFiles)]
  })

  const highlighted = createMemo(() => {
    const values = files()

    if (values.length === 0) return undefined
    const explicit = store.explicitHighlight

    if (explicit && values.includes(explicit)) return explicit

    return values[0]
  })

  const loading = createMemo(() => query().length > 0 && search.isPending)

  const title = createMemo(() => {
    const project = props.session.listedProject ?? { worktree: file.root }

    return project.name || getFilename(project.worktree) || project.worktree
  })

  const optionID = (path: string) => `${resultsID}-option-${files().indexOf(path)}`

  const onFilterKeyDown = (event: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
    if (event.key === "Escape" && query()) {
      event.preventDefault()
      setFilter("")

      return
    }

    if (!query()) return
    applyFileListKeyDown(event, files(), highlighted(), {
      onHighlight: setExplicitHighlight,
      onSelect: props.onSelectPermanent,
    })
  }

  // The file tree and the filtered results, shared by the mobile sidebar and the desktop open-file view.
  const list: JSX.Element = (
    <Show
      when={query()}
      fallback={
        <FileTreeV2
          session={props.session}
          screen={props.screen}
          active={props.active}
          kinds={props.kinds}
          draggable={!props.mobile}
          onFileClick={(node) => props.onSelect(node.path)}
          onFileDoubleClick={(node) => props.onSelectPermanent(node.path)}
        />
      }
    >
      <Show
        when={!loading()}
        fallback={
          <div role="status" class="px-2 py-2 text-12-regular text-text-weak">
            {ctx.t("common.loading")}
            {ctx.t("common.loading.ellipsis")}
          </div>
        }
      >
        <Show
          when={files().length > 0}
          fallback={
            <div role="status" class="px-2 py-2 text-12-regular text-text-weak">
              {ctx.t("palette.empty")}
            </div>
          }
        >
          <SessionFileList
            session={props.session}
            screen={props.screen}
            id={resultsID}
            role="listbox"
            optionID={optionID}
            files={files()}
            kinds={props.kinds}
            active={props.active}
            highlighted={highlighted()}
            onFileClick={(path) => {
              setExplicitHighlight(path)
              props.onSelect(path)
            }}
            onFileDoubleClick={props.onSelectPermanent}
          />
        </Show>
      </Show>
    </Show>
  )

  return (
    <SessionFilePanelV2
      // Only the narrow screen keeps a browsing sidebar; the desktop's explorer owns the tree.
      sidebar={
        <Show when={props.mobile}>
          <SessionReviewV2Sidebar
            open
            title={<span class="truncate font-[530]">{title()}</span>}
            filter={filter()}
            onFilterChange={setFilter}
            onFilterKeyDown={onFilterKeyDown}
            filterRef={props.filterRef}
            filterControls={resultsID}
            filterActiveDescendant={highlighted() ? optionID(highlighted()!) : undefined}
            filterExpanded={query().length > 0 && files().length > 0}
          >
            {list}
          </SessionReviewV2Sidebar>
        </Show>
      }
    >
      <Show
        when={!props.placeholder}
        fallback={
          <Show
            when={props.mobile}
            fallback={
              <div data-slot="session-open-file" class="flex h-full min-h-0 flex-col">
                <div
                  data-slot="session-open-file-title"
                  class="truncate px-3 pb-1 pt-3 text-[13px] font-[530] leading-[var(--line-height-compact)] text-text-base"
                >
                  {title()}
                </div>
                <div class="shrink-0 px-3 pb-2">
                  <TextInput
                    type="search"
                    value={filter()}
                    onInput={(event) => setFilter(event.currentTarget.value)}
                    onKeyDown={onFilterKeyDown}
                    autofocus
                    ref={(element) => props.filterRef?.(element)}
                    role="combobox"
                    aria-autocomplete="list"
                    aria-controls={resultsID}
                    aria-activedescendant={highlighted() ? optionID(highlighted()!) : undefined}
                    aria-expanded={query().length > 0 && files().length > 0}
                    showClearButton={filter().length > 0}
                    clearLabel={i18n.t("ui.list.clearFilter")}
                    onClearClick={() => setFilter("")}
                    placeholder={i18n.t("ui.sessionReviewV2.filterFiles")}
                    aria-label={i18n.t("ui.sessionReviewV2.filterFiles")}
                    leadingIcon={<Icon name="magnifying-glass" size="small" />}
                  />
                </div>
                <div class="min-h-0 flex-1 overflow-hidden px-3 pb-3">
                  <ScrollView class="group/file-tree-v2 h-full" orientation="both" thumbVisibility="scroll">
                    {list}
                  </ScrollView>
                </div>
              </div>
            }
          >
            <SessionFilePanelV2Empty>
              <div class="flex flex-col items-center gap-2 text-center text-text-weak">
                <Icon name="file-tree" size="large" class="mb-2" />
                <div class="text-[13px] font-medium leading-[13px] text-text-strong">{ctx.t("command.open")}</div>
                <div class="h-5 text-13-regular leading-5">{ctx.t("selectToOpen")}</div>
              </div>
            </SessionFilePanelV2Empty>
          </Show>
        }
      >
        <div class="min-h-0 flex-1">
          <Show when={props.id} keyed>
            {(id) => <SessionFileView session={props.session} screen={props.screen} id={id} />}
          </Show>
        </div>
      </Show>
    </SessionFilePanelV2>
  )
}

/** The side panel render every file tab and the "Open file" launcher share. */
export default function FileBrowser(props: {
  tab: Accessor<PanelTab>
  session: MountedSession
  screen: SessionScreen
}) {
  const panel = usePanel()
  const shared = useShared()
  const id = () => props.tab().id
  const placeholder = () => !isFileTab(id())
  const empty = new Map<string, ChangeKind>()
  const changes = () => current(shared.changes())

  // Change markers in the tree load while a file tab shows, as the side panel did.
  createKeyed(
    () => (panel.visible() && !placeholder() ? changes() : undefined),
    (service) => onCleanup(service.watch(props.screen, "files")),
  )

  // Keep each file tab's last selection for the moment before a session's file view state loads. The handoff
  // outlives this view: the session's next view reads it.
  createKeyed(
    () => {
      const file = props.screen.file

      if (!file.ready()) return

      const files = Object.fromEntries(
        panel
          .open()
          .filter(isFileTab)
          .map((tab) => {
            const path = fileTabPath(file, tab)
            const selected = file.selection.get(path)

            return [path, selected && "start" in selected && "end" in selected ? selected : null] as const
          }),
      )

      return { session: props.session.key, files }
    },
    (handoff) => shared.handoff.set(handoff.session, handoff.files),
  )

  return (
    <SessionFileBrowserTab
      session={props.session}
      screen={props.screen}
      id={placeholder() ? undefined : id()}
      placeholder={placeholder()}
      active={placeholder() ? undefined : fileTabPath(props.screen.file, id())}
      kinds={changes()?.kinds(props.session) ?? empty}
      onSelect={(path) => shared.open(props.session, path, { tab: "preview" })}
      onSelectPermanent={(path) => shared.open(props.session, path)}
      filterRef={(element) => {
        shared.filter.element = element

        if (!shared.filter.pending) return
        shared.filter.pending = false
        queueMicrotask(() => element.focus())
      }}
    />
  )
}
