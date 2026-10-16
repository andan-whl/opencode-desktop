import { batch, createMemo, createRoot, createSignal, getOwner, lazy, onCleanup, Show, Suspense, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import type { FileDiffInfo } from "@opencode/client/promise"
import {
  bindExtension,
  createKeyed,
  LinkHandler,
  Panel,
  SettingsPage,
  usePanel,
  type SessionScreen,
  type SessionRef,
  type MountedSession,
  type Setup,
  onIdle,
} from "../sdk"
import { Changes, ScmView, type ChangeKind } from "./contract"
import type Review from "./index"
import { createReviewModel, type Demand, type ReviewModel } from "./model"

const TAB = "changes"

const KEY = `review:${TAB}`

const setup: Setup<typeof Review> = (ctx) => {
  const owner = getOwner()
  const sessions = ctx.sessions
  const layout = ctx.layout
  const panel = ctx.stores.panel

  // Who shows a screen's changes: the review render, the file tree, and file tabs. Keyed by the session screen, which
  // stays while it routes another session, so a session switch keeps the demand.
  const demands = new WeakMap<SessionScreen, ReturnType<typeof createStore<Demand>>>()

  const demand = (screen: SessionScreen) => {
    const existing = demands.get(screen)

    if (existing) return existing

    const created = createStore<Demand>({ tree: 0, files: 0, panel: 0, details: 0 })

    demands.set(screen, created)

    return created
  }

  // Views receive their screen before the public attachment is published, so initial render effects can watch it.
  const watch = (screen: SessionScreen, source: keyof Demand) => {
    const set = demand(screen)[1]

    set(source, (count) => count + 1)

    return () => set(source, (count) => Math.max(0, count - 1))
  }

  // One review model per session screen, like the review the screen created before extensions, created once the
  // screen routes a session. It follows the routed session, a new object on each switch, through `view`.
  const [entry, setEntry] = createSignal<{ screen: SessionScreen; model: ReviewModel; dispose: () => void }>()

  createKeyed(
    ctx.screen.current,
    (screen) => {
      const current = untrack(entry)
      const initial = untrack(sessions.current)

      if (current?.screen === screen || !initial) return

      current?.dispose()
      setEntry(
        createRoot((dispose) => {
          // The routed session of this screen; the last one stays while none is routed for a moment.
          const view = createMemo<MountedSession>(
            (last) => (ctx.screen.current() === screen ? sessions.current() : undefined) ?? last,
            initial,
          )

          return { screen, model: createReviewModel({ ctx, screen, view, demand: demand(screen)[0] }), dispose }
        }, owner),
      )
    },
    {
      // A screen that unmounts and remounts in one update keeps its model.
      otherwise: () => {
        const current = untrack(entry)

        queueMicrotask(() => {
          if (sessions.current() || untrack(entry) !== current) return

          current?.dispose()
          setEntry(undefined)
        })
      },
    },
  )
  onCleanup(() => untrack(entry)?.dispose())

  const modelFor = (session: SessionRef) => {
    const model = entry()?.model

    return model && model.view().key === session.key ? model : undefined
  }

  const Scm = lazy(() => import("./scm"))
  const MobileReview = lazy(() => import("./mobile"))

  onCleanup(onIdle(() => void (layout.narrow() ? MobileReview : Scm).preload()))

  // The review's source-control view, which the file extension's sidebar shows in its `scm` view.
  ctx.provide(ScmView, {
    View: bindExtension((props) => {
      const current = entry()
      const model = current && current.screen === props.screen ? current.model : undefined

      return (
        <Show when={model} keyed>
          {(model) => (
            <Suspense>
              <Scm
                review={model}
                session={props.session}
                screen={props.screen}
                expandMode={panel.value.expandMode}
              />
            </Suspense>
          )}
        </Show>
      )
    }),
  })

  // Narrow screens keep their Changes view; on wide screens the review lives in the sidebar's source-control view,
  // so the side region lists no review tab.
  ctx.add(Panel, {
    id: "main",
    region: "side",
    transient: true,
    legacy: { review: TAB },
    mobile: {
      get title() {
        return ctx.plural("mobile.title", 0)
      },
      order: 10,
      kind: "tab",
    },
    list: () => [],
    render: (props) => {
      const frame = usePanel()

      // A server switch mounts a new screen before the owned model effect runs. Never render the old screen's model.
      const model = () => {
        const current = entry()

        return current?.screen === props.screen ? current.model : undefined
      }

      return (
        <Show when={model()} keyed>
          {(model) => {
            createKeyed(frame.visible, () => onCleanup(watch(props.screen, "panel")))

            return (
              <div class="flex flex-col h-full overflow-hidden bg-v2-background-bg-base contain-strict">
                <Show when={model.panelRendered()}>
                  <Suspense>
                    <MobileReview review={model} session={props.session} />
                  </Suspense>
                </Show>
              </div>
            )
          }}
        </Show>
      )
    },
  })

  const reveals = new Set<() => void>()

  // A review comment in the composer reveals its diff.
  ctx.add(LinkHandler, {
    priority: 1,
    match: (link) => link.origin === "review",
    open(link) {
      const session = sessions.current()

      if (!session || (link.session && link.session.key !== session.key)) return

      batch(() => {
        // focusFile shows the review: the sidebar's source-control view, or the narrow-screen Changes view.
        reveals.forEach((listener) => listener())
        modelFor(session)?.focusFile(link.href)
      })
    },
  })

  const WrapLinesRow = lazy(() => import("./settings"))
  // Settings rows are small; load them while idle so settings opens without a blank row.
  onCleanup(onIdle(() => void WrapLinesRow.preload()))

  // The narrow-screen diff wrap toggle, in its place in the host's General section.
  ctx.add(SettingsPage, {
    id: "mobile-diff",
    page: "general",
    section: "general",
    get title() {
      return ctx.t("settings.wrapLines.title")
    },
    get entries() {
      return [
        { id: "settings-mobile-diff-wrap", title: ctx.t("settings.wrapLines.title"), keywords: "diff wrap lines" },
      ]
    },
    render: () => (
      <Suspense>
        <WrapLinesRow />
      </Suspense>
    ),
  })

  const none: readonly FileDiffInfo[] = []
  const noKinds: ReadonlyMap<string, ChangeKind> = new Map()

  ctx.provide(Changes, {
    diffs: (session) => modelFor(session)?.diffs() ?? none,
    ready: (session) => modelFor(session)?.ready() ?? false,
    kinds: (session) => modelFor(session)?.kinds() ?? noKinds,
    active: (session) => modelFor(session)?.activeFile(),
    details: (session) => modelFor(session)?.details(),
    focus: (session, path) => modelFor(session)?.focusFile(path),
    open(session) {
      // The session details' changes row: narrow screens switch to the Changes view; wide ones show the sidebar's
      // source-control view.
      if (layout.narrow()) return layout.open(KEY, session)

      ctx.screen.current()?.file.view.open("scm")
    },
    watch,
    onReveal(listener) {
      reveals.add(listener)

      return () => {
        reveals.delete(listener)
      }
    },
  })
}

export default setup
