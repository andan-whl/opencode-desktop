import { createEffect, For, Show, type JSX } from "solid-js"
import { FileIcon } from "@opencode/ui/file-icon"
import { Icon } from "@opencode/ui/icon"
import { ScrollView } from "@opencode/ui/scroll-view"
import type { FileNode } from "@/runtime/server/types"
import { useFile } from "@/workspaces/files/model"

/**
 * The draft page's workspace tree. The session screen keeps its own richer sidebar; this one only
 * needs to browse and to feed the composer, so clicking a file inserts an @-reference instead of
 * opening an editor tab the draft page does not have.
 */
export function NewSessionFileTree(props: { onPick: (path: string) => void }) {
  const files = useFile()
  // The store ships with the root expanded; listing it starts the tree.
  createEffect(() => void files.tree.list(""))

  return (
    <ScrollView class="h-full">
      <div class="px-2 pt-2 pb-3" data-component="new-session-file-tree">
        <TreeRows dir="" level={0} onPick={props.onPick} />
      </div>
    </ScrollView>
  )
}

function TreeRows(props: { dir: string; level: number; onPick: (path: string) => void }) {
  const files = useFile()

  return (
    <For each={files.tree.children(props.dir)}>
      {(node) => (
        <Show
          when={node.type === "directory"}
          fallback={<FileRow node={node} level={props.level} onPick={props.onPick} />}
        >
          <DirectoryRow node={node} level={props.level} onPick={props.onPick} />
        </Show>
      )}
    </For>
  )
}

function DirectoryRow(props: { node: FileNode; level: number; onPick: (path: string) => void }) {
  const files = useFile()
  const expanded = () => files.tree.state(props.node.path)?.expanded ?? false

  return (
    <>
      <TreeRow
        node={props.node}
        level={props.level}
        icon={
          <>
            <Icon
              name={expanded() ? "chevron-down" : "chevron-right"}
              size="small"
              class="shrink-0 text-v2-icon-icon-muted"
            />
            <FileIcon node={props.node} expanded={expanded()} class="size-4 shrink-0" />
          </>
        }
        onClick={() => (expanded() ? files.tree.collapse(props.node.path) : files.tree.expand(props.node.path))}
      />
      <Show when={expanded()}>
        <TreeRows dir={props.node.path} level={props.level + 1} onPick={props.onPick} />
      </Show>
    </>
  )
}

function FileRow(props: { node: FileNode; level: number; onPick: (path: string) => void }) {
  return (
    <TreeRow
      node={props.node}
      level={props.level}
      icon={
        <>
          {/* Placeholder for the directory chevron so every icon column lines up. */}
          <span class="w-4 shrink-0" aria-hidden="true" />
          <FileIcon node={props.node} class="size-4 shrink-0" />
        </>
      }
      onClick={() => props.onPick(props.node.path)}
    />
  )
}

function TreeRow(props: { node: FileNode; level: number; icon: JSX.Element; onClick: () => void }) {
  return (
    <button
      type="button"
      data-path={props.node.path}
      class="flex h-6 w-full min-w-0 items-center gap-1 rounded-[4px] px-1.5 text-start text-[13px] leading-text-compact text-v2-text-text-muted transition-colors duration-100 hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base focus-visible:outline-none"
      style={{ "padding-left": `${props.level * 12 + 6}px` }}
      onClick={props.onClick}
    >
      {props.icon}
      <span class="truncate">{props.node.name}</span>
    </button>
  )
}
