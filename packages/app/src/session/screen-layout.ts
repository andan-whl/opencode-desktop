import { createMemo, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { useLayout } from "@/shell/state/layout"
import { useSettings } from "@/settings/model"
import { createSizing } from "./helpers"
import type { SessionModel } from "./model"
import { clampSessionPanelWidth, sessionPanelWidthMax } from "./session-panel-width"

export const FILE_TREE_WIDTH_MIN = 240

export const FILE_TREE_WIDTH_MAX = 480

/** wide asks for the wider session minimum; sidebar is whether any extension fills the side panel sidebar. */
export function createSessionScreenLayout(
  session: SessionModel,
  input: { wide: Accessor<boolean>; sidebar: Accessor<boolean> },
) {
  const layout = useLayout()
  const settings = useSettings()
  const size = createSizing()
  const view = session.layout.view
  const desktop = session.isDesktop

  // The middle column shows the editor tab strip with the terminal dock at its bottom edge.
  const tabsOpen = createMemo(() => desktop() && view().side.opened() && !!session.identity.params.id)
  const dockOpen = createMemo(() => desktop() && view().dock.opened())
  const middleOpen = createMemo(() => tabsOpen() || dockOpen())

  const fileTreeOpen = createMemo(
    () => desktop() && input.sidebar() && settings.visibility.fileTree() && layout.fileTree.opened(),
  )

  const fileTreeWidth = createMemo(() =>
    Math.min(FILE_TREE_WIDTH_MAX, Math.max(FILE_TREE_WIDTH_MIN, layout.fileTree.width())),
  )

  // The chat column takes a stored width while any other column is open, and the full row otherwise.
  const besideOpen = createMemo(() => fileTreeOpen() || middleOpen())

  const [rowSize, setRowSize] = createStore<{ width?: number }>({})
  let row: HTMLDivElement | undefined
  createResizeObserver(
    () => row,
    ({ width }) => setRowSize({ width }),
  )

  // What the row leaves for the chat column once the tree column and the gaps between visible columns are paid.
  const chatAvailable = createMemo<number | undefined>(() => {
    const width = rowSize.width

    if (width === undefined) return undefined

    const columns = 1 + (fileTreeOpen() ? 1 : 0) + (middleOpen() ? 1 : 0)

    return width - 8 - (fileTreeOpen() ? fileTreeWidth() : 0) - (columns - 1) * 8
  })

  const splitSide = createMemo(() => tabsOpen() && input.wide())

  const resizedWidth = createMemo(() =>
    clampSessionPanelWidth({
      width: view().session.width(),
      available: chatAvailable(),
      split: splitSide(),
    }),
  )

  const panelWidth = createMemo(() => (besideOpen() ? `${resizedWidth()}px` : "100%"))

  const panelMax = createMemo(() => {
    const width = chatAvailable()

    if (width === undefined) return 1000

    return sessionPanelWidthMax({ available: width, split: splitSide() })
  })

  return {
    centered: desktop,
    files: {
      open: fileTreeOpen,
      width: fileTreeWidth,
      resize: (width: number) => layout.fileTree.resize(width),
    },
    panel: {
      max: panelMax,
      ref: (element: HTMLDivElement) => {
        row = element
      },
      resizable: besideOpen,
      resizedWidth,
      width: panelWidth,
    },
    middle: {
      open: middleOpen,
      tabs: { open: tabsOpen },
    },
    dock: { open: dockOpen },
    size,
  }
}

export type SessionScreenLayout = ReturnType<typeof createSessionScreenLayout>
