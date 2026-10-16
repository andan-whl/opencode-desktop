import type { SessionInfo } from "@opencode/client/promise"
import { useServer } from "@/runtime/server/current"
import { useLanguage } from "@/runtime/i18n/language"
import { createMemo, For, Show, type ParentProps } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { tabKey, useTabs } from "@/shell/tabs/tabs"
import { sessionHref } from "@/shell/routes/session"
import { sessionTitle } from "./title"
import { SessionWorkingIndicator } from "./header/session-working-indicator"
import "./session-identity-header.css"

export function SessionTitleHeader(props: ParentProps) {
  return (
    <>
      {/* The bottom inset reserves room for the fade without covering rows stuck below the bar. */}
      <div data-session-title class="pointer-events-none sticky top-0 z-30 w-full pb-4">
        <div class="pointer-events-auto bg-v2-background-bg-base pe-3 ps-2.5">{props.children}</div>
      </div>
      {/* Stuck timeline headers stack above this fade, so it only fades content scrolling under the bar. */}
      <div
        aria-hidden="true"
        class="pointer-events-none sticky top-12 z-[5] -mt-4 h-4 w-full bg-[linear-gradient(to_bottom,var(--v2-background-bg-base),transparent)]"
      />
    </>
  )
}

export function SessionAncestorTrail(props: {
  sessionID: string
  parentID: string
  parentTitle?: string
  trailing: boolean
}) {
  const server = useServer()
  const language = useLanguage()
  const open = useOpenSessionRoute()

  const ancestors = createMemo(() => {
    const path: { id: string; title: string; direct: boolean }[] = []
    const seen = new Set([props.sessionID])
    let id: string | undefined = props.parentID

    while (id && !seen.has(id)) {
      seen.add(id)
      const info = server.ctx.data.session.get(id)
      path.unshift({
        id,
        title:
          sessionTitle(info?.title ?? (id === props.parentID ? props.parentTitle : undefined)) ??
          language.t("session.tab.session"),
        direct: id === props.parentID,
      })
      id = info?.parentID
    }

    return path
  })

  return (
    <div class="flex min-w-0 max-w-full items-center">
      <div
        data-slot="session-title-ancestors"
        class="flex min-w-0 items-center overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <For each={ancestors()}>
          {(ancestor, index) => (
            <>
              <button
                type="button"
                data-slot={ancestor.direct ? "session-title-parent" : "session-title-ancestor"}
                data-session-id={ancestor.id}
                title={ancestor.title}
                class="max-w-[min(200px,40vw)] shrink-0 truncate text-[13px] font-[530] leading-4 tracking-[-0.04px] text-v2-text-text-faint transition-colors hover:text-v2-text-text-muted"
                classList={{ "ps-1": index() === 0, "ps-2": index() > 0 }}
                onClick={() => open(props.sessionID, ancestor.id)}
              >
                <bdi dir="auto">{ancestor.title}</bdi>
              </button>
              <Show when={index() < ancestors().length - 1}>
                <span
                  data-slot="session-title-separator"
                  class="-translate-y-[0.5px] shrink-0 ps-2 pe-1 text-[11px] font-medium text-v2-text-text-faint"
                  aria-hidden="true"
                >
                  /
                </span>
              </Show>
            </>
          )}
        </For>
      </div>
      <Show when={props.trailing}>
        <span
          data-slot="session-title-separator"
          class="-translate-y-[0.5px] shrink-0 ps-2 pe-1 text-[11px] font-medium text-v2-text-text-faint"
          aria-hidden="true"
        >
          /
        </span>
      </Show>
    </div>
  )
}

// Opens a related session in the tab showing `from`, and records its parent so the tab's route stays consistent.
// `reveal` names a tool call or shell the opened timeline scrolls to and expands.
export function useOpenSessionRoute() {
  const server = useServer()
  const tabs = useTabs()
  const navigate = useNavigate()

  return (from: string, id: string, reveal?: string) => {
    const tab = tabs.store.find(
      (item) =>
        item.type === "session" &&
        item.server === server.key &&
        (item.sessionId === from || item.routeSessionId === from),
    )

    if (tab?.type === "session") tabs.rememberSessionRoute(tab, id, server.ctx.data.session.get(id)?.parentID)
    navigate(sessionHref(server.key, id), reveal ? { state: { reveal } } : undefined)
  }
}

export function SessionIdentityHeader(props: ParentProps<{ sessionID: string; session?: SessionInfo }>) {
  const server = useServer()
  const tabs = useTabs()
  const language = useLanguage()
  const pending = createMemo(() => tabs.pendingSession(server.key, props.sessionID))

  const tab = createMemo(() =>
    tabs.store.find(
      (item) =>
        item.type === "session" &&
        item.server === server.key &&
        (item.sessionId === props.sessionID || item.routeSessionId === props.sessionID),
    ),
  )

  const info = createMemo(() => {
    const current = tab()

    return current ? tabs.info[tabKey(current)] : undefined
  })

  const parentID = createMemo(() => {
    if (props.session?.parentID) return props.session.parentID
    const current = tab()

    if (current?.type !== "session" || current.routeSessionId !== props.sessionID) return

    return current.routeParentId ?? current.sessionId
  })

  const parent = createMemo(() => {
    const id = parentID()

    return id ? server.ctx.data.session.get(id) : undefined
  })

  const parentTitle = createMemo(() => {
    const id = parentID()
    const current = tab()

    return sessionTitle(
      parent()?.title ?? (current?.type === "session" && current.sessionId === id ? info()?.title : undefined),
    )
  })

  const title = createMemo(() =>
    pending()
      ? language.t("session.tab.session")
      : sessionTitle(props.session?.title ?? (parentID() ? undefined : info()?.title)),
  )

  return (
    <Show when={title() || parentTitle()}>
      <SessionTitleHeader>
        <div class="flex h-12 w-full items-center justify-between gap-2">
          <div class="flex min-w-0 flex-1 items-center gap-1">
            <div class="flex min-w-0 w-full flex-1 items-center gap-0.5">
              <Show when={parentID()}>
                {(id) => (
                  <SessionAncestorTrail
                    sessionID={props.sessionID}
                    parentID={id()}
                    parentTitle={parentTitle()}
                    trailing={!!title()}
                  />
                )}
              </Show>
              <Show when={parentID() && props.children}>{props.children}</Show>
              <Show when={!parentID() || !props.children}>
                <SessionWorkingIndicator sessionID={props.sessionID} />
              </Show>
              <Show when={(!parentID() || !props.children) && title()}>
                {(value) => (
                  <h1
                    data-slot={parentID() ? "session-title-child" : undefined}
                    dir="auto"
                    class="w-fit truncate rounded-[6px] px-1 py-1 text-[13px] font-[530] leading-4 tracking-[-0.04px] text-v2-text-text-base"
                    classList={{ "max-w-[45%] shrink-0": !!parentID() }}
                  >
                    {value()}
                  </h1>
                )}
              </Show>
              <Show when={!parentID()}>{props.children}</Show>
            </div>
          </div>
        </div>
      </SessionTitleHeader>
    </Show>
  )
}
