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

/** The activity bar stays beside the tree column whenever the tree column can appear at all. */
export const ACTIVITY_BAR_WIDTH = 48

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

  // The activity bar is the tree column's permanent rail; the tree panel it selects opens beside it.
  const activityBar = createMemo(() => desktop() && input.sidebar() && settings.visibility.fileTree())

  const fileTreeOpen = createMemo(() => activityBar() && layout.fileTree.opened())

  const fileTreeWidth = createMemo(() =>
    Math.min(FILE_TREE_WIDTH_MAX, Math.max(FILE_TREE_WIDTH_MIN, layout.fileTree.width())),
  )

  // The chat column takes a stored width while any other column is open, and the full row otherwise.
  const besideOpen = createMemo(() => activityBar() || middleOpen())

  const [rowSize, setRowSize] = createStore<{ width?: number }>({})
  let row: HTMLDivElement | undefined
  createResizeObserver(
    () => row,
    ({ width }) => setRowSize({ width }),
  )

  // What the row leaves for the chat column once the fused sidebar card and the gaps between whole columns are paid.
  const chatAvailable = createMemo<number | undefined>(() => {
    const width = rowSize.width

    if (width === undefined) return undefined

    // The bar and the panel it opens form one fused column, so only whole columns pay the gaps between them.
    const columns = 1 + (activityBar() ? 1 : 0) + (middleOpen() ? 1 : 0)

    return (
      width -
      8 -
      (activityBar() ? ACTIVITY_BAR_WIDTH : 0) -
      (fileTreeOpen() ? fileTreeWidth() : 0) -
      (columns - 1) * 8
    )
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
      bar: activityBar,
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
