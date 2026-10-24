import { createMemo, createSignal, Match, onCleanup, Show, Switch } from "solid-js"
import { Dynamic } from "solid-js/web"
import { debounce } from "@solid-primitives/scheduled"
import { createQuery, useQueryClient } from "@tanstack/solid-query"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import {
  displayName,
  getProjectAvatarSource,
  getProjectAvatarVariant,
  ProjectAvatar,
} from "@opencode/ui/project-avatar"
import { ScrollView } from "@opencode/ui/scroll-view"
import type { ChangeKind } from "../review/contract"
import { createKeyed, useExtension, type MountedSession, type SessionScreen } from "../sdk"
import { current, useShared } from "./context"
import { useOpenInApp } from "./open-in-app"
import FileTree, { type FileGitStatus } from "./tree"
import FileSearchView from "./search-view"

/** The file tree beside the side panel: the view the activity bar selects, or every workspace file. */
export default function FileSidebar(props: { session: MountedSession; screen: SessionScreen }) {
  const ctx = useExtension()
  const shared = useShared()
  const file = props.screen.file
  const empty = new Map<string, ChangeKind>()
  // The row the user last clicked or right-clicked, distinct from the active file the editor focuses.
  const [selected, setSelected] = createSignal<string>()
  const openIn = ctx.desktop ? useOpenInApp({ session: props.session, path: () => file.root }) : undefined
  const changes = () => current(shared.changes())
  const view = createMemo(() => file.view.get())
  // The review's own source-control view, which replaces the plain tree while the review extension is active.
  const scmView = () => current(shared.scm())

  // The host mounts this only while the tree is open, which is when its changes should stay loaded.
  createKeyed(shared.changes, (service) => onCleanup(service.watch(props.screen, "tree")))

  // The activity bar's view owns which panel shows; a review reveal still switches to the changed files.
  createKeyed(view, (view) => shared.tree.setTab(view === "scm" ? "changes" : "all"))
  createKeyed(
    () => shared.tree.tab(),
    (tab) => {
      if (tab === "changes") file.view.set("scm")
    },
  )

  // Lists the root again when the directory, the visible tree or the connection changes, and whenever the root
  // listing is unloaded: the workspace's tree resets to a new root entry. Loading that listing is the same key.
  createKeyed(
    () => {
      const directory = file.root

      if (!props.session.server.connected) return

      return { directory, view: view(), root: file.tree.state("") }
    },
    (listing) => {
      const refresh = shared.tree.directory !== listing.directory

      shared.tree.directory = listing.directory
      void file.tree.sync("", refresh ? { force: true } : undefined)
    },
    {
      equals: (previous, next) =>
        previous.directory === next.directory && previous.view === next.view && previous.root === next.root,
    },
  )

  const diffFiles = createMemo(() => (changes()?.diffs(props.session) ?? []).map((diff) => diff.file))
  const kinds = createMemo(() => changes()?.kinds(props.session) ?? empty)

  const queryClient = useQueryClient()
  const statusKey = createMemo(() => [ctx.id, props.session.server.id, "file-tree-vcs-status", file.root] as const)

  // The workspace's uncommitted Git state, which colors the tree. Providers without a VCS never load it.
  const statusQuery = createQuery(() => ({
    queryKey: statusKey(),
    enabled: props.session.server.connected && !!props.session.project?.vcs,
    refetchOnMount: "always" as const,
    queryFn: () =>
      props.session.server.client.vcs
        .status({ location: { directory: file.root } })
        .then((result) => result.data)
        .catch(() => []),
  }))

  const refreshStatus = debounce(() => void queryClient.invalidateQueries({ queryKey: statusKey() }), 100)

  // Git changes files in the workspace, including the writes apply-all and revert-all make.
  createKeyed(
    () => ({ directory: file.root, data: props.session.server.data }),
    (current) =>
      onCleanup(
        current.data.listen(({ details }) => {
          if (details.type === "filesystem.changed" && details.location?.directory === current.directory) refreshStatus()
        }),
      ),
    { equals: (previous, next) => previous.directory === next.directory && previous.data === next.data },
  )

  // Each changed file, and every directory above it, so the tree can color both.
  const status = createMemo(() => {
    const rows = statusQuery.isFetched ? (statusQuery.data ?? []) : []

    if (rows.length === 0) return

    const prefix = relativePrefix(props.session.project?.worktree, file.root)
    const out = new Map<string, FileGitStatus>()

    for (const row of rows) {
      const path = stripPrefix(normalizeStatusPath(row.file), prefix)

      if (!path) continue

      const value: FileGitStatus = { status: row.status, staged: !!row.staged }
      const parts = path.split("/")

      out.set(path, value)
      parts.slice(0, -1).forEach((_, index) => {
        const dir = parts.slice(0, index + 1).join("/")

        if (!dir) return

        const known = out.get(dir)

        out.set(dir, known ? mergeGitStatus(known, value) : value)
      })
    }

    return out
  })

  // The middle column's file, shown as the tree's active row. The tree keys paths with forward slashes, and a
  // path outside the workspace never lists in it, so both stay out of the highlight.
  const activeFile = createMemo(() => {
    const path = shared.focusedFile(props.session, props.screen)

    if (!path || file.absolute(path)) return

    return path.replace(/[\\/]+$/, "").replaceAll("\\", "/")
  })

  const nofiles = createMemo(() => {
    const state = file.tree.state("")

    if (!state?.loaded) return false

    return file.tree.list("").length === 0
  })

  const title = createMemo(() => {
    if (view() === "search") return ctx.t("search.title")

    return view() === "scm" ? ctx.t("view.scm") : ctx.t("view.explorer")
  })

  const emptyState = (message: string) => (
    <div class="flex flex-1 items-center justify-center pt-16 text-center">
      <div class="text-12-regular text-text-weak">{message}</div>
    </div>
  )

  let treeHost: HTMLDivElement | undefined

  // Without the review extension the source control view falls back to the workspace files, as its tree always did.
  // The ScrollView is the tree's only scroll container; the panel around it clips without scrolling.
  const files = () => (
    <div class="flex min-h-0 flex-1 flex-col bg-background-stronger px-3 py-0">
      <Switch>
        <Match when={nofiles()}>{emptyState(ctx.t("tree.empty"))}</Match>
        <Match when={true}>
          <div ref={treeHost} class="min-h-0 flex-1 overflow-hidden">
            <ScrollView class="h-full">
              <FileTree
                session={props.session}
                screen={props.screen}
                path=""
                class="pt-3"
                active={activeFile()}
                selected={selected()}
                onSelect={setSelected}
                openIn={openIn}
                modified={diffFiles()}
                kinds={kinds()}
                status={status()}
                onFileClick={(node) => {
                  setSelected(node.path)
                  shared.open(props.session, node.path)
                }}
              />
            </ScrollView>
          </div>
        </Match>
      </Switch>
    </div>
  )

  // Reveals the middle column's file: the explorer view shows, every ancestor directory expands, and the row
  // scrolls into view once the tree has loaded it. Expansion loads asynchronously, so the row is polled for.
  const revealActiveFile = () => {
    const path = activeFile()

    if (!path) return

    if (view() !== "explorer") file.view.set("explorer")

    const parts = path.split("/")

    parts
      .slice(0, -1)
      .map((_, idx) => parts.slice(0, idx + 1).join("/"))
      .forEach((dir) => file.tree.expand(dir))

    const deadline = Date.now() + 2000

    const tick = () => {
      if (!treeHost) return

      const node = [...treeHost.querySelectorAll<HTMLElement>("[data-path]")].find(
        (el) => el.dataset.path === path,
      )

      if (node) {
        node.scrollIntoView({ block: "center" })

        return
      }

      if (Date.now() < deadline) setTimeout(tick, 60)
    }

    tick()
  }

  return (
    <div class="flex h-full flex-col" data-scope="filetree">
      <Show when={!(view() === "scm" && scmView())}>
        <div class="flex h-8 shrink-0 items-center justify-between px-3">
          <div class="truncate text-11-medium uppercase tracking-wide text-text-weak">{title()}</div>
          <IconButton
            size="small"
            variant="ghost"
            icon={<Icon name="locate" size="small" />}
            aria-label={ctx.t("tree.locate")}
            title={ctx.t("tree.locate")}
            disabled={!activeFile()}
            onClick={revealActiveFile}
          />
        </div>
      </Show>
      <Switch>
        <Match when={view() === "search"}>
          <div class="min-h-0 flex-1">
            <FileSearchView session={props.session} screen={props.screen} />
          </div>
        </Match>
        <Match when={view() === "scm" && scmView()}>
          {(scm) => (
            <div class="min-h-0 flex-1">
              <Dynamic component={scm().View} session={props.session} screen={props.screen} />
            </div>
          )}
        </Match>
        <Match when={view() === "scm"}>{files()}</Match>
        <Match when={true}>
          <div class="flex min-h-0 flex-1 flex-col bg-background-stronger">
            <ProjectHeader session={props.session} />
            {files()}
          </div>
        </Match>
      </Switch>
    </div>
  )
}

const normalizeAbsolute = (value: string) =>
  value.replaceAll("\\", "/").replace(/\/{2,}/g, "/").replace(/\/+$/, "")

// Git lists paths from the worktree root; when the session runs below it, that prefix is not part of the workspace.
function relativePrefix(worktree: string | undefined, directory: string) {
  if (!worktree) return ""

  const root = normalizeAbsolute(worktree)
  const dir = normalizeAbsolute(directory)

  if (root.toLowerCase() === dir.toLowerCase()) return ""

  return dir.toLowerCase().startsWith(`${root.toLowerCase()}/`) ? dir.slice(root.length + 1) : ""
}

const normalizeStatusPath = (value: string) =>
  value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "").replace(/\/+$/, "")

// Status rows may already be workspace-relative; the prefix only strips when it actually leads the path.
function stripPrefix(path: string, prefix: string) {
  if (!prefix) return path

  return path.toLowerCase().startsWith(`${prefix.toLowerCase()}/`) ? path.slice(prefix.length + 1) : path
}

// A directory shows one mark: its children's state when they agree, otherwise a modified mark, staged only as a whole.
function mergeGitStatus(a: FileGitStatus, b: FileGitStatus): FileGitStatus {
  return { status: a.status === b.status ? a.status : "modified", staged: a.staged && b.staged }
}

/** The workspace header of the explorer view: the project the session runs in, and its directory. */
function ProjectHeader(props: { session: MountedSession }) {
  const ctx = useExtension()
  const project = () => props.session.project
  const directory = () => props.session.directory
  const name = () => displayName(project() ?? { worktree: directory() })

  return (
    <button
      type="button"
      class="flex shrink-0 items-center gap-2 px-3 pb-1 pt-2 text-start"
      aria-label={ctx.t("project.openDirectory")}
      title={directory()}
      disabled={!ctx.desktop}
      onClick={() => void ctx.desktop?.reveal(directory())}
    >
      <ProjectAvatar
        class="shrink-0"
        aria-hidden="true"
        fallback={name()}
        src={getProjectAvatarSource(project()?.id, project()?.icon)}
        variant={getProjectAvatarVariant(project()?.icon?.color)}
      />
      <span class="min-w-0 flex-1">
        <span class="block truncate text-12-medium text-text-base">{name()}</span>
        <span dir="ltr" class="block truncate text-11-regular text-text-faint">
          {directory()}
        </span>
      </span>
    </button>
  )
}
