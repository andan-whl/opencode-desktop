import { Badge } from "@opencode/ui/badge"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Spinner } from "@opencode/ui/spinner"
import { Tabs } from "@opencode/ui/tabs"
import { TextField } from "@opencode/ui/text-field"
import { useMutation } from "@tanstack/solid-query"
import type { SkillCatalogEntry, SkillInstallResult, SkillInstallSource } from "@opencode/client/promise"
import { batch, createEffect, createMemo, createResource, createSignal, For, Show, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { ExternalLink } from "@/runtime/platform/external-link"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { showToast } from "@/shell/notifications/toast"
import { SettingsList } from "@/settings/list"
import "@/settings/settings.css"

type Language = ReturnType<typeof useLanguage>
type InstallType = SkillInstallSource["type"]

const SOURCE_KEYS = {
  path: "settings.skills.source.path",
  url: "settings.skills.source.url",
  git: "settings.skills.source.git",
  index: "settings.skills.source.index",
} as const

const REF_LABELS = {
  path: "settings.skills.install.ref.path.label",
  url: "settings.skills.install.ref.url.label",
  git: "settings.skills.install.ref.git.label",
} as const

const REF_PLACEHOLDERS = {
  path: "settings.skills.install.ref.path.placeholder",
  url: "settings.skills.install.ref.url.placeholder",
  git: "settings.skills.install.ref.git.placeholder",
} as const

function requestMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function resultsToast(results: SkillInstallResult[], language: Language) {
  const names = (status: SkillInstallResult["status"]) =>
    results
      .filter((result) => result.status === status)
      .map((result) => result.name)
      .join(", ")

  const installed = names("installed")
  const updated = names("updated")
  const upToDate = names("noop")

  if (installed) {
    showToast({
      variant: "success",
      icon: "circle-check",
      title: language.t("settings.skills.toast.installed.title"),
      description: installed,
    })
  }

  if (updated) {
    showToast({
      variant: "success",
      icon: "circle-check",
      title: language.t("settings.skills.toast.updated.title"),
      description: updated,
    })
  }

  if (upToDate && !installed && !updated) {
    showToast({
      title: language.t("settings.skills.toast.upToDate.title"),
      description: upToDate,
    })
  }
}

export const SettingsSkills: Component = () => {
  const language = useLanguage()
  const serverSdk = useServerSDK()
  const data = useData()
  const dialog = useDialog()

  createEffect(() => {
    if (serverSdk.connection.status() !== "connected") return
    void data.location.skill.sync().catch(() => undefined)
  })

  const [installedList, { refetch: refetchInstalled }] = createResource(
    () => serverSdk.connection.status() === "connected",
    () => serverSdk.api.skill.installed().then((result) => result.data),
    { initialValue: [] },
  )

  const installed = createMemo(() => installedList.latest ?? [])
  const managedNames = createMemo(() => new Set(installed().map((entry) => entry.name)))
  const discovered = createMemo(() =>
    (data.location.skill.list() ?? []).filter((skill) => !managedNames().has(skill.name)),
  )

  const refresh = () => {
    void refetchInstalled()
    void data.location.skill.sync().catch(() => undefined)
  }

  const update = useMutation(() => ({
    mutationFn: (name: string | undefined) =>
      serverSdk.api.skill.update(name ? { name } : undefined).then((result) => result.data),
    onSuccess: (results) => resultsToast(results, language),
    onError: (error) => {
      showToast({ title: language.t("settings.skills.toast.failed.title"), description: requestMessage(error) })
    },
    onSettled: refresh,
  }))

  const uninstall = useMutation(() => ({
    mutationFn: (name: string) => serverSdk.api.skill.uninstall({ name }).then(() => undefined),
    onSuccess: (_result, name) => {
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.skills.toast.uninstalled.title"),
        description: name,
      })
    },
    onError: (error) => {
      showToast({ title: language.t("settings.skills.toast.failed.title"), description: requestMessage(error) })
    },
    onSettled: refresh,
  }))

  const confirmUninstall = (name: string) => {
    void dialog.push(() => (
      <DialogUninstallSkill name={name} onUninstall={() => uninstall.mutateAsync(name)} />
    ))
  }

  const openInstall = () => {
    void dialog.push(() => (
      <DialogInstallSkill isManaged={(name) => managedNames().has(name)} onInstalled={refresh} />
    ))
  }

  const dateFormatter = createMemo(() => new Intl.DateTimeFormat(language.intl(), { dateStyle: "medium" }))

  return (
    <div class="flex flex-col gap-6">
      <div class="settings-section">
        <div class="flex items-center justify-between">
          <span class="settings-extension-heading text-13-medium">{language.t("settings.skills.installed")}</span>
          <div class="flex shrink-0 items-center gap-2">
            <Show when={installed().length > 0}>
              <Button
                size="small"
                variant="ghost-muted"
                icon="refresh"
                disabled={update.isPending}
                onClick={() => update.mutate(undefined)}
              >
                {language.t("settings.skills.updateAll")}
              </Button>
            </Show>
            <Button size="small" variant="neutral" icon="plus" onClick={openInstall}>
              {language.t("settings.skills.install")}
            </Button>
          </div>
        </div>
        <Show
          when={installed().length > 0}
          fallback={
            <span class="text-11-regular text-v2-text-text-muted">
              {language.t("settings.skills.installed.empty")}
            </span>
          }
        >
          <SettingsList variant="catalog">
            <For each={installed()}>
              {(entry) => (
                <div class="settings-extension-row">
                  <div class="settings-extension-lead">
                    <Icon name="post-skill" class="text-v2-icon-icon-muted shrink-0" />
                    <div class="flex min-w-0 flex-col gap-0.5">
                      <span class="settings-extension-name truncate">{entry.name}</span>
                      <span class="text-11-regular text-v2-text-text-muted truncate">
                        {language.t(SOURCE_KEYS[entry.source.type])} · {entry.version.slice(0, 8)} ·{" "}
                        {dateFormatter().format(entry.installedAt)}
                      </span>
                    </div>
                  </div>
                  <div class="flex shrink-0 items-center gap-1.5">
                    <Button
                      size="small"
                      variant="ghost-muted"
                      disabled={update.isPending}
                      onClick={() => update.mutate(entry.name)}
                    >
                      {language.t("settings.skills.update")}
                    </Button>
                    <IconButton
                      type="button"
                      variant="ghost"
                      icon={<Icon name="trash" />}
                      aria-label={language.t("settings.skills.uninstall")}
                      onClick={() => confirmUninstall(entry.name)}
                    />
                  </div>
                </div>
              )}
            </For>
          </SettingsList>
        </Show>
      </div>

      <div class="settings-section">
        <div class="flex items-center justify-between">
          <div class="flex flex-col gap-1">
            <span class="settings-extension-heading text-13-medium">
              {language.t("settings.extensions.availableAll")}
            </span>
            <span class="text-11-regular text-v2-text-text-muted">
              {language.t("settings.skills.discovered.hint")}
            </span>
          </div>
          <ExternalLink class="settings-extension-link text-13-regular" href="https://opencode.ai/docs/skills/">
            {language.t("settings.extensions.addSkills")}
          </ExternalLink>
        </div>
        <Show when={discovered().length > 0}>
          <SettingsList variant="catalog">
            <For each={discovered()}>
              {(skill) => (
                <div class="settings-extension-row">
                  <div class="settings-extension-lead">
                    <Icon name="post-skill" class="text-v2-icon-icon-muted shrink-0" />
                    <span class="settings-extension-name truncate">{skill.name}</span>
                  </div>
                </div>
              )}
            </For>
          </SettingsList>
        </Show>
      </div>
    </div>
  )
}

function DialogUninstallSkill(props: { name: string; onUninstall: () => Promise<void> }) {
  const dialog = useDialog()
  const language = useLanguage()

  const remove = () => {
    const removing = props.onUninstall()
    dialog.close()
    void removing
  }

  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitleGroup
          title={language.t("settings.skills.uninstall.confirm.title", { name: props.name })}
          description={language.t("settings.skills.uninstall.confirm.description")}
        />
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="neutral" onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </Button>
        <Button type="button" variant="danger" onClick={remove}>
          {language.t("settings.skills.uninstall")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function DialogInstallSkill(props: { isManaged: (name: string) => boolean; onInstalled: () => void }) {
  const language = useLanguage()
  const serverSdk = useServerSDK()
  const dialog = useDialog()

  const [form, setForm] = createStore<{ type: InstallType; ref: string; error: string | undefined }>({
    type: "index",
    ref: "",
    error: undefined,
  })

  const [catalogList] = createResource(
    () => serverSdk.connection.status() === "connected",
    () => serverSdk.api.skill.catalog().then((result) => result.data),
    { initialValue: [] },
  )
  const catalog = createMemo<SkillCatalogEntry[]>(() => catalogList.latest ?? [])

  const [query, setQuery] = createSignal("")
  const filtered = createMemo(() => {
    const needle = query().trim().toLowerCase()
    const entries = catalog().slice().sort((a, b) => a.name.localeCompare(b.name))
    if (!needle) return entries
    return entries.filter(
      (entry) =>
        entry.name.toLowerCase().includes(needle) ||
        entry.description.toLowerCase().includes(needle) ||
        entry.category.toLowerCase().includes(needle),
    )
  })

  const install = useMutation(() => ({
    mutationFn: (source: { type: InstallType; ref: string }) =>
      serverSdk.api.skill.install(source).then((result) => result.data),
    onSuccess: (results) => {
      props.onInstalled()
      if (form.type !== "index") dialog.close()
      resultsToast(results, language)
    },
    onError: (error) => setForm("error", requestMessage(error)),
  }))

  const submit = (event: SubmitEvent) => {
    event.preventDefault()
    if (install.isPending) return
    if (form.ref.trim() === "") {
      batch(() => {
        setForm("ref", "")
        setForm("error", language.t("settings.skills.install.ref.required"))
      })
      return
    }
    install.mutate({ type: form.type, ref: form.ref.trim() })
  }

  return (
    <Dialog
      size={form.type === "index" ? "large" : undefined}
      fit={form.type !== "index"}
      variant="settings"
    >
      <DialogHeader>
        <DialogTitleGroup
          title={language.t("settings.skills.install.title")}
          description={language.t("settings.skills.install.description")}
        />
      </DialogHeader>
      <DialogBody class="flex min-h-0 flex-1 flex-col gap-3">
        <div class="px-4">
          <Tabs
            variant="pill"
            value={form.type}
            onChange={(value) => {
              if (value !== "index" && value !== "path" && value !== "url" && value !== "git") return
              if (value === form.type) return
              setForm({ type: value, ref: "", error: undefined })
            }}
            class="settings-subtabs"
          >
            <Tabs.List>
              <Tabs.Trigger value="index">{language.t(SOURCE_KEYS.index)}</Tabs.Trigger>
              <Tabs.Trigger value="path">{language.t(SOURCE_KEYS.path)}</Tabs.Trigger>
              <Tabs.Trigger value="url">{language.t(SOURCE_KEYS.url)}</Tabs.Trigger>
              <Tabs.Trigger value="git">{language.t(SOURCE_KEYS.git)}</Tabs.Trigger>
            </Tabs.List>
          </Tabs>
        </div>
        <Show
          when={form.type === "index" ? undefined : form.type}
          keyed
          fallback={
            <Show
              when={!catalogList.loading}
              fallback={
                <div class="flex flex-1 items-center justify-center gap-2 text-12-regular text-v2-text-text-muted">
                  <Spinner class="w-3.5" />
                  {language.t("common.loading")}
                  {language.t("common.loading.ellipsis")}
                </div>
              }
            >
              <div class="flex min-h-0 flex-1 flex-col gap-3">
                <div class="settings-skill-search mx-4">
                  <Icon name="magnifying-glass" class="shrink-0 text-v2-icon-icon-muted" />
                  <TextField
                    autofocus
                    variant="ghost"
                    class="flex-1"
                    type="text"
                    value={query()}
                    onChange={setQuery}
                    placeholder={language.t("common.search.placeholder")}
                    spellcheck={false}
                    autocorrect="off"
                    autocomplete="off"
                    autocapitalize="off"
                  />
                  <Show when={query()}>
                    <IconButton
                      icon={<Icon name="circle-x" />}
                      variant="ghost"
                      aria-label={language.t("common.clear")}
                      onClick={() => setQuery("")}
                    />
                  </Show>
                </div>
                <Show
                  when={filtered().length > 0}
                  fallback={
                    <div class="flex flex-1 items-center justify-center text-12-regular text-v2-text-text-muted">
                      {language.t(
                        query() ? "settings.skills.install.catalog.noMatch" : "settings.skills.install.catalog.empty",
                      )}
                    </div>
                  }
                >
                  <div class="settings-skill-grid min-h-0 flex-1 overflow-y-auto px-4 pb-1">
                    <For each={filtered()}>
                      {(entry) => (
                        <div class="settings-skill-card">
                          <div class="flex items-start gap-2.5">
                            <Icon name="post-skill" class="mt-0.5 shrink-0 text-v2-icon-icon-muted" />
                            <div class="flex min-w-0 flex-1 flex-col gap-1">
                              <span class="settings-extension-name truncate">{entry.name}</span>
                              <span class="line-clamp-2 text-11-regular text-v2-text-text-muted">
                                {entry.description}
                              </span>
                            </div>
                          </div>
                          <div class="flex items-center justify-between gap-2">
                            <Badge class="truncate">{entry.category}</Badge>
                            <Button
                              size="small"
                              variant={props.isManaged(entry.name) ? "neutral" : "contrast"}
                              disabled={props.isManaged(entry.name) || install.isPending}
                              onClick={() => install.mutate({ type: "index", ref: entry.name })}
                            >
                              {language.t(
                                props.isManaged(entry.name)
                                  ? "settings.skills.install.catalog.installed"
                                  : "settings.skills.install.catalog.install",
                              )}
                            </Button>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </Show>
          }
        >
          {(type) => (
            <form onSubmit={submit} class="flex min-h-0 flex-1 flex-col">
              <div class="flex flex-1 flex-col justify-center gap-4 px-4 py-2">
                <TextField
                  autofocus
                  label={language.t(REF_LABELS[type])}
                  placeholder={language.t(REF_PLACEHOLDERS[type])}
                  value={form.ref}
                  onChange={(value) => {
                    batch(() => {
                      setForm("ref", value)
                      setForm("error", undefined)
                    })
                  }}
                  validationState={form.error ? "invalid" : undefined}
                  error={form.error}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="neutral" onClick={() => dialog.close()}>
                  {language.t("common.cancel")}
                </Button>
                <Button type="submit" variant="contrast" disabled={install.isPending}>
                  {install.isPending
                    ? language.t("settings.skills.install.installing")
                    : language.t("settings.skills.install.button")}
                </Button>
              </DialogFooter>
            </form>
          )}
        </Show>
        <Show when={form.type === "index" && install.isPending}>
          <div class="flex items-center gap-2 px-4 text-12-regular text-v2-text-text-muted" role="status">
            <Spinner class="w-3.5 shrink-0" />
            {language.t("settings.skills.install.installing")}
          </div>
        </Show>
        <Show when={form.type === "index" && form.error}>
          <div class="flex items-center gap-2 px-4 text-12-regular text-v2-state-fg-danger" role="alert">
            <Icon name="circle-x" class="shrink-0" />
            {form.error}
          </div>
        </Show>
      </DialogBody>
    </Dialog>
  )
}
