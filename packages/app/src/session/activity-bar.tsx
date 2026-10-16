import { For } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { useLayout } from "@/shell/state/layout"
import { useLanguage } from "@/runtime/i18n/language"

const VIEWS = [
  { id: "explorer", icon: "filetree", label: "activity.explorer" },
  { id: "search", icon: "magnifying-glass", label: "activity.search" },
  { id: "scm", icon: "branch", label: "activity.scm" },
] as const

/**
 * The IDE-style activity bar inside the fused sidebar card's rail: one icon per sidebar view, with
 * the selected view's panel one click away. Clicking the selected icon toggles the panel itself.
 */
export function SessionActivityBar() {
  const layout = useLayout()
  const language = useLanguage()
  const selected = () => layout.activity.view()

  return (
    <nav
      aria-label={language.t("activity.ariaLabel")}
      class="flex w-12 shrink-0 flex-col items-center gap-1 bg-v2-background-bg-layer-01 py-2"
    >
      <For each={VIEWS}>
        {(view) => (
          <button
            type="button"
            aria-label={language.t(view.label)}
            aria-current={selected() === view.id ? "true" : undefined}
            title={language.t(view.label)}
            classList={{
              "relative flex h-9 w-9 items-center justify-center rounded-[6px] transition-colors": true,
              "text-v2-text-text-base": selected() === view.id,
              "text-v2-text-text-muted hover:bg-v2-background-bg-layer-02": selected() !== view.id,
            }}
            onClick={() => {
              if (selected() === view.id) return layout.fileTree.toggle()

              layout.activity.setView(view.id)
              layout.fileTree.open()
            }}
          >
            <Icon name={view.icon} />
            {/* The active view carries a quiet accent edge on the bar's leading side. */}
            <span
              classList={{
                "absolute start-[-8px] top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-v2-icon-icon-accent":
                  selected() === view.id,
              }}
            />
          </button>
        )}
      </For>
    </nav>
  )
}
