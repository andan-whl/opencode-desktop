import { Show, type JSX } from "solid-js"
import { FileIcon } from "@opencode/ui/file-icon"
import { getFilename } from "@opencode/util/path"

/**
 * A file tab's trigger content. The selected tab's icon colour comes from the tab CSS. `dirty` is an accessor so a
 * label that renders without an editor nearby can still follow its draft.
 */
export function FileVisual(props: {
  path: string
  temporary?: boolean
  notFound?: boolean
  dirty?: () => boolean
}): JSX.Element {
  return (
    <div class="flex items-center gap-x-2 min-w-0">
      <span class="relative inline-flex size-4 shrink-0">
        <FileIcon node={{ path: props.path, type: "file" }} class="absolute inset-0 size-4 tab-fileicon-color" />
        <FileIcon node={{ path: props.path, type: "file" }} mono class="absolute inset-0 size-4 tab-fileicon-mono" />
      </span>
      <span
        class="text-14-medium truncate"
        classList={{ italic: props.temporary, "line-through": props.notFound }}
        data-file-not-found={props.notFound ? "" : undefined}
      >
        {getFilename(props.path)}
      </span>
      {/* The tab's accessible name spells the state out; the mark itself stays decorative. */}
      <Show when={props.dirty?.()}>
        <span
          aria-hidden
          class="size-1.5 shrink-0 rounded-full"
          style={{ "background-color": "var(--icon-diff-modified-base)" }}
        />
      </Show>
    </div>
  )
}
