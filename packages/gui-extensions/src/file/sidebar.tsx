import { createMemo, Match, onCleanup, Show, Switch } from "solid-js"
import { Dynamic } from "solid-js/web"
import {
  displayName,
  getProjectAvatarSource,
  getProjectAvatarVariant,
  ProjectAvatar,
} from "@opencode/ui/project-avatar"
import type { ChangeKind } from "../review/contract"
import { createKeyed, useExtension, type MountedSession, type SessionScreen } from "../sdk"
import { current, useShared } from "./context"
import FileTree from "./tree"
import FileSearchView from "./search-view"

/** The file tree beside the side panel: the view the activity bar selects, or every workspace file. */
export default function FileSidebar(props: { session: MountedSession; screen: SessionScreen }) {
  const ctx = useExtension()
  const shared = useShared()
  const file = props.screen.file
  const empty = new Map<string, ChangeKind>()
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

  // Without the review extension the source control view falls back to the workspace files, as its tree always did.
  const files = () => (
    <div class="flex min-h-0 flex-1 flex-col bg-background-stronger px-3 py-0">
      <Switch>
        <Match when={nofiles()}>{emptyState(ctx.t("tree.empty"))}</Match>
        <Match when={true}>
          <FileTree
            session={props.session}
            screen={props.screen}
            path=""
            class="pt-3"
            modified={diffFiles()}
            kinds={kinds()}
            onFileClick={(node) => shared.open(props.session, node.path)}
          />
        </Match>
      </Switch>
    </div>
  )

  return (
    <div class="flex h-full flex-col" data-scope="filetree">
      <Show when={!(view() === "scm" && scmView())}>
        <div class="flex h-8 shrink-0 items-center justify-between px-3">
          <div class="truncate text-11-medium uppercase tracking-wide text-text-weak">{title()}</div>
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
