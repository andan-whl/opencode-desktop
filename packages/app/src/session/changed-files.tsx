import { createEffect, createMemo, createResource, createSignal, For, on, Show } from "solid-js"
import { DiffChanges } from "@opencode/ui/diff-changes"
import { FileIcon } from "@opencode/ui/file-icon"
import { Icon } from "@opencode/ui/icon"
import { getFilename } from "@opencode/util/path"
import { useExtensionAttachment } from "@/runtime/extension/host-apis"
import { useExtensionHost } from "@/runtime/extension/host"
import { useLanguage } from "@/runtime/i18n/language"
import { useServer } from "@/runtime/server/current"
import type { SessionModel } from "@/session/model"

/**
 * The files the routed session changed, above the conversation. Clicking a row opens the file as the
 * middle column's tab and reveals it in the sidebar tree, so the workspace view follows the task.
 */
export function SessionChangedFiles(props: { session: SessionModel }) {
  const language = useLanguage()
  const server = useServer()
  const host = useExtensionHost()
  const extensions = useExtensionAttachment()
  const sessionID = () => props.session.identity.sessionID()
  const [expanded, setExpanded] = createSignal(true)

  const [diffs, { refetch }] = createResource(sessionID, async (id) => {
    if (!id) return []
    const result = await server.ctx.sdk.api.session.diff({ sessionID: id }).catch(() => undefined)
    return result ?? []
  })

  // A session that goes idle finished its turn, which may have changed files.
  createEffect(
    on(
      () => (sessionID() ? server.ctx.data.session.status(sessionID()!) : undefined),
      (next, previous) => {
        if (next === "idle" && previous !== undefined && previous !== "idle") void refetch()
      },
    ),
  )

  const files = createMemo(() => diffs() ?? [])
  const totals = createMemo(() =>
    files().reduce((acc, file) => ({ additions: acc.additions + file.additions, deletions: acc.deletions + file.deletions }), {
      additions: 0,
      deletions: 0,
    }),
  )

  const openFile = (path: string) => {
    const session = extensions.current()

    if (!session) return
    host.links.open({ href: path, origin: "file", exact: true, revealTree: true, session })
  }

  return (
    <Show when={files().length > 0}>
      <div
        data-component="session-changed-files"
        class="mb-2 shrink-0 overflow-hidden rounded-[8px] bg-v2-background-bg-layer-01"
      >
        <button
          type="button"
          class="flex h-8 w-full min-w-0 items-center gap-1.5 px-2 text-start text-[12px] font-medium text-v2-text-text-base transition-colors duration-100 hover:bg-v2-background-bg-layer-02 focus-visible:outline-none"
          aria-expanded={expanded()}
          onClick={() => setExpanded((value) => !value)}
        >
          <Icon
            name={expanded() ? "chevron-down" : "chevron-right"}
            size="small"
            class="shrink-0 text-v2-icon-icon-muted"
          />
          <span class="min-w-0 flex-1 truncate">
            {language.t("session.changedFiles.title")}
            <span class="ms-1.5 text-v2-text-text-faint">{files().length}</span>
          </span>
          <DiffChanges changes={totals()} />
        </button>
        <Show when={expanded()}>
          <div class="max-h-52 overflow-y-auto pb-1">
            <For each={files()}>
              {(diff) => (
                <button
                  type="button"
                  data-component="session-changed-file"
                  class="flex h-8 w-full min-w-0 items-center gap-1.5 px-2 ps-6 text-start transition-colors duration-100 hover:bg-v2-background-bg-layer-02 focus-visible:outline-none"
                  title={diff.file}
                  onClick={() => openFile(diff.file)}
                >
                  <FileIcon node={{ path: diff.file, type: "file" }} class="size-4 shrink-0" />
                  <span class="min-w-0 flex-1 truncate text-[12px] text-v2-text-text-muted">
                    <Show when={diff.file.includes("/")} fallback={diff.file}>
                      <span class="text-v2-text-text-faint">{`${directory(diff.file)}/`}</span>
                      {getFilename(diff.file)}
                    </Show>
                  </span>
                  <DiffChanges appearance="standard" changes={{ additions: diff.additions, deletions: diff.deletions }} />
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  )
}

const directory = (path: string) => path.slice(0, path.lastIndexOf("/"))
