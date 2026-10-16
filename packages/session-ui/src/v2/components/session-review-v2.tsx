import { useI18n } from "@opencode/ui/context/i18n"
import { ResizeHandle } from "@opencode/ui/resize-handle"
import { ScrollView } from "@opencode/ui/scroll-view"
import { TextInput } from "@opencode/ui/text-input"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createEffect, createSignal, Show, type JSX } from "solid-js"
import "./session-review-v2.css"

export const SESSION_REVIEW_V2_SIDEBAR_WIDTH_DEFAULT = 240

export const SESSION_REVIEW_V2_SIDEBAR_WIDTH_MIN = 200

export const SESSION_REVIEW_V2_SIDEBAR_WIDTH_MAX = 480

export type SessionReviewExpandMode = "expand" | "collapse"

export type SessionReviewV2SidebarProps = {
  open: boolean
  transition?: boolean
  title?: JSX.Element
  stats?: JSX.Element
  filter: string
  onFilterChange: (value: string) => void
  onFilterKeyDown?: JSX.EventHandlerUnion<HTMLInputElement, KeyboardEvent>
  filterAutofocus?: boolean
  filterRef?: (element: HTMLInputElement) => void
  filterControls?: string
  filterActiveDescendant?: string
  filterExpanded?: boolean
  width?: number
  onWidthChange?: (width: number) => void
  minWidth?: number
  maxWidth?: number
  viewportRef?: (element: HTMLDivElement) => void
  children?: JSX.Element
}

export function SessionReviewV2Sidebar(props: SessionReviewV2SidebarProps) {
  const i18n = useI18n()
  const [resizing, setResizing] = createSignal(false)
  const width = () => props.width ?? SESSION_REVIEW_V2_SIDEBAR_WIDTH_DEFAULT
  const minWidth = () => props.minWidth ?? SESSION_REVIEW_V2_SIDEBAR_WIDTH_MIN
  const maxWidth = () => props.maxWidth ?? SESSION_REVIEW_V2_SIDEBAR_WIDTH_MAX

  createEffect(() => {
    if (!resizing()) return
    const stop = () => setResizing(false)
    makeEventListener(document, "pointerup", stop)
    makeEventListener(document, "pointercancel", stop)
  })

  return (
    <div data-component="session-review-v2-sidebar-root">
      <Show when={props.open}>
        <aside
          data-slot="session-review-v2-sidebar"
          data-transition={props.transition ? "" : undefined}
          data-resizing={resizing() ? "" : undefined}
          style={{ width: `${width()}px` }}
        >
          <div data-slot="session-review-v2-sidebar-header">
            <div data-slot="session-review-v2-sidebar-title">{props.title}</div>
            {props.stats}
          </div>
          <div data-slot="session-review-v2-sidebar-filter">
            <TextInput
              type="search"
              value={props.filter}
              onInput={(event) => props.onFilterChange(event.currentTarget.value)}
              onKeyDown={props.onFilterKeyDown}
              autofocus={props.filterAutofocus}
              ref={props.filterRef}
              role={props.filterControls ? "combobox" : undefined}
              aria-autocomplete={props.filterControls ? "list" : undefined}
              aria-controls={props.filterControls}
              aria-activedescendant={props.filterActiveDescendant}
              aria-expanded={props.filterControls ? props.filterExpanded : undefined}
              showClearButton={props.filter.length > 0}
              clearLabel={i18n.t("ui.list.clearFilter")}
              onClearClick={() => props.onFilterChange("")}
              placeholder={i18n.t("ui.sessionReviewV2.filterFiles")}
              aria-label={i18n.t("ui.sessionReviewV2.filterFiles")}
              leadingIcon={
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden="true"
                >
                  <path
                    d="M12.25 12.25L10.0625 10.0625M11.0833 6.41667C11.0833 8.994 8.994 11.0833 6.41667 11.0833C3.83934 11.0833 1.75 8.994 1.75 6.41667C1.75 3.83934 3.83934 1.75 6.41667 1.75C8.994 1.75 11.0833 3.83934 11.0833 6.41667Z"
                    stroke="currentColor"
                    stroke-linecap="square"
                  />
                </svg>
              }
            />
          </div>
          <ScrollView
            data-slot="session-review-v2-sidebar-tree"
            class="group/file-tree-v2"
            orientation="both"
            thumbVisibility="scroll"
            viewportRef={props.viewportRef}
          >
            {props.children}
          </ScrollView>
        </aside>
      </Show>
      <Show when={props.open && props.onWidthChange}>
        <div data-slot="session-review-v2-sidebar-resize" onPointerDown={() => setResizing(true)}>
          <ResizeHandle
            direction="horizontal"
            size={width()}
            min={minWidth()}
            max={maxWidth()}
            onResize={(next) => props.onWidthChange?.(next)}
            onDblClick={() => props.onWidthChange?.(SESSION_REVIEW_V2_SIDEBAR_WIDTH_DEFAULT)}
          />
        </div>
      </Show>
    </div>
  )
}
