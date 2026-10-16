import type { OpenCodeEvent, SessionMessageInfo } from "@opencode/client/promise"
import { expect, test, type Locator, type Page } from "@playwright/test"
import { base64Encode } from "@opencode/util/encode"
import { SERVER, holdRoute, project, provider, session, workspaceKey } from "../utils/app"
import { mockOpenCodeServer } from "../utils/mock-server"
import { fileDiff, fileNode, openSession } from "../utils/workspace"
import { expectSessionTitle } from "../utils/waits"

test.use({ viewport: { width: 1440, height: 900 } })

for (const view of ["desktop", "mobile"] as const) {
  test(`offers Git initialization for a project without VCS (${view})`, async ({ page }) => {
    if (view === "mobile") await page.setViewportSize({ width: 390, height: 844 })
    const requests: { directory: string; provider?: string }[] = []

    const workspace = await openSession(page, {
      name: "ReviewWithoutGit",
      project: { vcs: undefined },
      onVcsInit: (input) => requests.push(input),
    })

    if (view === "desktop") await page.getByRole("button", { name: "Toggle review" }).click()
    else await page.getByRole("tablist", { name: "Session view" }).getByRole("tab", { name: "Changes" }).click()

    // The review lives in the sidebar's source-control view on wide screens.
    const panel =
      view === "desktop" ? page.locator("#file-tree-panel") : page.locator('[data-component="session-review"]')
    await expect(panel.getByText("Track, review, and undo changes in this project")).toBeVisible()
    await expect(panel.getByRole("button", { name: "Git changes" })).toHaveCount(0)
    const init = panel.getByRole("button", { name: "Create Git repository" })
    await init.click()
    await expect.poll(() => requests).toEqual([{ directory: workspace.directory, provider: "git" }])
    await expect(panel.getByRole("button", { name: "Git changes" })).toBeVisible()
    await expect(init).toHaveCount(0)
  })
}

test("Git initialization belongs to its session and refreshes after a session switch", async ({ page }) => {
  const requests: { directory: string; provider?: string }[] = []

  const workspace = await openSession(page, {
    name: "ReviewInitSwitch",
    project: { vcs: undefined },
    onVcsInit: (input) => requests.push(input),
    sessions: [
      { id: "ses_init_a", title: "Initialize Alpha" },
      { id: "ses_init_b", title: "Initialize Beta" },
    ],
  })
  await page.getByRole("button", { name: "Toggle review" }).click()

  // The successful init finishes while another session is routed.
  const request = await holdRoute(page, (url) => url.pathname === "/api/vcs/init", { method: "POST" })
  const panel = page.locator("#file-tree-panel")
  const init = panel.getByRole("button", { name: "Create Git repository", exact: true })
  const pending = panel.getByRole("button", { name: "Creating Git repository…", exact: true })
  await expect(init).toBeEnabled()
  await init.click()
  await request.arrived
  await expect(pending).toBeDisabled()

  await page.locator("[data-titlebar-tab-slot]", { hasText: "Initialize Beta" }).click()
  await expectSessionTitle(page, "Initialize Beta")
  await expect(init).toBeEnabled()
  await expect(pending).toHaveCount(0)

  await page.locator("[data-titlebar-tab-slot]", { hasText: "Initialize Alpha" }).click()
  await expectSessionTitle(page, "Initialize Alpha")
  await expect(pending).toBeDisabled()
  await page.locator("[data-titlebar-tab-slot]", { hasText: "Initialize Beta" }).click()
  await expectSessionTitle(page, "Initialize Beta")
  await expect(init).toBeEnabled()

  const response = page.waitForResponse((item) => new URL(item.url()).pathname === "/api/vcs/init")
  // The worktree event can refresh project-wide UI by itself; the completed action must also reload Alpha's cache.
  const refreshed = page.waitForResponse((item) => new URL(item.url()).pathname === "/api/session/ses_init_a")
  request.release()
  expect((await response).status()).toBe(204)
  expect((await refreshed).status()).toBe(200)
  expect(requests).toEqual([{ directory: workspace.directory, provider: "git" }])
  await expect(panel.getByRole("button", { name: "Git changes", exact: true })).toBeVisible()
  await expect(init).toHaveCount(0)
  await expect(page.getByText("Request failed", { exact: true })).toHaveCount(0)

  await page.locator("[data-titlebar-tab-slot]", { hasText: "Initialize Alpha" }).click()
  await expectSessionTitle(page, "Initialize Alpha")
  await expect(panel.getByRole("button", { name: "Git changes", exact: true })).toBeVisible()
  await expect(pending).toHaveCount(0)
})

test("a rejected Git init releases its session's button without showing an error in another session", async ({ page }) => {
  await openSession(page, {
    name: "ReviewInitFailure",
    project: { vcs: undefined },
    sessions: [
      { id: "ses_init_failure_a", title: "Initialize Alpha" },
      { id: "ses_init_failure_b", title: "Initialize Beta" },
    ],
  })
  await page.getByRole("button", { name: "Toggle review" }).click()
  const request = await holdRoute(page, (url) => url.pathname === "/api/vcs/init", { method: "POST" })
  const init = page.locator("#file-tree-panel").getByRole("button", { name: "Create Git repository", exact: true })
  await init.click()
  await request.arrived
  await page.locator("[data-titlebar-tab-slot]", { hasText: "Initialize Beta" }).click()
  await expectSessionTitle(page, "Initialize Beta")
  await expect(init).toBeEnabled()
  const response = page.waitForResponse((item) => new URL(item.url()).pathname === "/api/vcs/init")
  request.release()
  expect((await response).status()).toBe(501)
  await expect(page.getByText("Request failed", { exact: true })).toHaveCount(0)
  await page.locator("[data-titlebar-tab-slot]", { hasText: "Initialize Alpha" }).click()
  await expectSessionTitle(page, "Initialize Alpha")
  await expect(init).toBeEnabled()
})

test("open file tab browses, searches, and tracks missing files", async ({ page }) => {
  const searches: { query: string; dirs?: string; limit?: number }[] = []
  const directory = "C:/OpenCode/ReviewOpenFile"
  const files = Array.from({ length: 80 }, (_, index) => `file-${String(index).padStart(2, "0")}.ts`)

  const workspace = await openSession(page, {
    name: "ReviewOpenFile",
    vcsDiff: [fileDiff("src/changed.ts")],
    fileList: (path) =>
      path
        ? []
        : [
            fileNode(directory, "README.md"),
            fileNode(directory, "src", "directory"),
            ...files.map((file) => fileNode(directory, file)),
          ],
    fileContent: (path) => ({ type: "text", content: `contents:${path}` }),
    findFiles: (input) => {
      searches.push(input)

      return input.query === "nested" ? [fileNode(directory, "src/nested.ts")] : []
    },
    seed: {
      panes: { ses_reviewopenfile: { review: true } },
    },
  })

  const panel = page.locator("#review-panel")
  // The launcher tab's own view: the workspace title, the filter, and the tree or the results below.
  const openView = panel.locator('[data-slot="session-open-file"]')
  const contextButton = page.getByRole("button", { name: "View context usage" })
  const openFile = panel.getByRole("button", { name: "Open file" })
  const tab = (name: string) => panel.getByRole("tab", { name, exact: true })
  await contextButton.click()
  await expect(tab("Context")).toHaveAttribute("aria-selected", "true")
  await openFile.click()
  await expect(tab("Open file")).toHaveAttribute("aria-selected", "true")
  const filter = panel.getByRole("combobox", { name: "Filter files" })
  await expect(filter).toBeFocused()
  await expect(openView.locator('[data-slot="session-open-file-title"]')).toHaveText("ReviewOpenFile")
  await expect(openView.getByRole("button", { name: "README.md" })).toBeVisible()

  await openView.getByRole("button", { name: "README.md" }).click()
  await expect(tab("README.md")).toHaveAttribute("aria-selected", "true")
  await expect(panel.getByText("contents:README.md", { exact: true })).toBeVisible()
  // The browsing view belongs to the launcher tab, so selecting a file tab replaces it.
  await expect(openView).toHaveCount(0)

  const missingRead = "**/api/fs/read/README.md*"
  await page.route(missingRead, (route) =>
    route.fulfill({
      status: 404,
      headers: { "access-control-allow-origin": "*" },
      // SAFETY: the server's wire body for a missing file, which the client decodes into its own error.
      // oxlint-disable-next-line anti-slop-effect/no-manual-tagged-construction -- see SAFETY above
      json: { _tag: "FileNotFoundError", path: "README.md", message: "File not found: README.md" },
    }),
  )
  const missingResponse = page.waitForResponse((response) => response.url().includes("/api/fs/read/README.md"))
  await workspace.push([filesystemEvent(directory, "README.md", "unlink")])
  await missingResponse
  await expect(page.getByText("Failed to load file", { exact: true })).toBeVisible()
  await expect(tab("File not found: README.md")).toHaveAttribute("aria-selected", "true")
  await expect(panel.getByText("File not found: README.md", { exact: true })).toBeVisible()

  await page.unroute(missingRead)
  await workspace.push([filesystemEvent(directory, "README.md", "add")])
  await expect(tab("README.md")).toHaveAttribute("aria-selected", "true")
  await expect(panel.getByText("contents:README.md", { exact: true })).toBeVisible()

  await openFile.click()
  await expect(tab("README.md")).toHaveCount(0)
  await filter.fill("nested")
  const result = panel.getByRole("option", { name: /nested\.ts/ })
  await expect(result).toBeVisible()
  await expect(filter).toHaveAttribute("aria-activedescendant", (await result.getAttribute("id"))!)
  await filter.press("Enter")
  await expect(tab("nested.ts")).toHaveAttribute("aria-selected", "true")
  await expect(panel.getByText("contents:src/nested.ts", { exact: true })).toBeVisible()
  expect(searches).toContainEqual({ query: "nested", dirs: "file", limit: 200 })

  await openFile.click()
  await expect(tab("nested.ts")).toHaveCount(1)
  await expect(tab("Open file")).toHaveAttribute("aria-selected", "true")
  await tab("nested.ts").click()
  await tab("Open file").click()
  await page.keyboard.press("Control+w")
  await expect(tab("Open file")).toHaveCount(0)
  await expect(tab("nested.ts")).toHaveAttribute("aria-selected", "true")

  // Tree rows still open files: a single click previews, a double click pins.
  await openFile.click()
  const tree = openView.locator('[data-component="file-tree-v2"]')
  await tree.getByRole("button", { name: "file-79.ts" }).click()
  await expect(tab("file-79.ts")).toHaveAttribute("aria-selected", "true")
  await expect(panel.getByText("contents:file-79.ts", { exact: true })).toBeVisible()
  await openFile.click()
  await tree.getByRole("button", { name: "file-78.ts" }).dblclick()
  await expect(tab("file-78.ts")).toHaveAttribute("aria-selected", "true")

  // Context opens in front and keeps the preview tab, so closing it selects the first remaining tab.
  await tab("Context").click({ button: "middle" })
  await expect(tab("Context")).toHaveCount(0)
  await contextButton.click()
  await expect(tab("Context")).toHaveAttribute("aria-selected", "true")
  await expect(tab("file-79.ts")).toHaveCount(1)
  await contextButton.click()
  await expect(tab("Context")).toHaveCount(0)
  await expect(tab("nested.ts")).toHaveAttribute("aria-selected", "true")
})

for (const listed of [false, true]) {
  test(`the open file heading names a subfolder session ${listed ? "after its listed project" : "after its folder"}`, async ({
    page,
  }) => {
    const root = "C:/OpenCode/BrowserRepo"
    const directory = `${root}/packages/app`
    await openSession(page, {
      name: "BrowserRepo",
      sessions: [{ id: "ses_browserrepo", title: "BrowserRepo", directory }],
      fileList: (path) => (path ? [] : [fileNode(directory, "README.md")]),
      seed: {
        panes: { ses_browserrepo: { review: true } },
        // The user also opened the subfolder as its own sidebar project and renamed it there.
        ...(listed && {
          projects: {
            local: [
              { worktree: root, expanded: true },
              { worktree: directory, expanded: true },
            ],
          },
          storage: { [workspaceKey(directory, "project")]: { value: { name: "Custom app" } } },
        }),
      },
    })
    const panel = page.locator("#review-panel")
    const openView = panel.locator('[data-slot="session-open-file"]')
    await panel.getByRole("button", { name: "Open file" }).click()
    await expect(openView.getByRole("button", { name: "README.md" })).toBeVisible()
    await expect(openView.locator('[data-slot="session-open-file-title"]')).toHaveText(
      listed ? "Custom app" : "app",
    )
  })
}

test("context closes the side region only when its button opened it", async ({ page }) => {
  // A /btw tab saved before extensions must not linger as a hidden tab that keeps the region open.
  await openSession(page, {
    name: "ReviewContextOpener",
    seed: {
      storage: {
        "opencode.global.dat:layout": {
          sessionTabs: {
            [`local\u0000${base64Encode("C:/OpenCode/ReviewContextOpener")}/ses_reviewcontextopener`]: {
              all: ["btw"],
              active: "btw",
            },
          },
        },
      },
    },
  })
  const panel = page.locator("#review-panel")
  const contextButton = page.getByRole("button", { name: "View context usage" })
  const context = panel.getByRole("tab", { name: "Context", exact: true })

  await contextButton.click()
  await expect(context).toHaveAttribute("aria-selected", "true")
  await contextButton.click()
  await expect(context).toHaveCount(0)
  await expect(panel).toBeHidden()

  // Opening the file browser by hand makes the region the user's, so closing Context leaves it open.
  await contextButton.click()
  await expect(context).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("Control+P")
  const openFile = panel.getByRole("tab", { name: "Open file", exact: true })
  await expect(openFile).toHaveAttribute("aria-selected", "true")
  await contextButton.click()
  await expect(context).toHaveCount(0)
  await expect(openFile).toHaveAttribute("aria-selected", "true")
  await expect(panel).toBeVisible()
})

test("file tree expands Windows paths and scrolls long names in both directions", async ({ page }) => {
  const directory = "C:/OpenCode/OpenFileExpand"
  const longFilename = "a-very-long-file-name-that-must-overflow-the-file-sidebar-instead-of-being-truncated.ts"
  const longPath = `frontend/${longFilename}`
  await openSession(page, {
    name: "OpenFileExpand",
    vcsDiff: [
      {
        file: longPath,
        additions: 1,
        deletions: 0,
        status: "added",
        patch: "@@ -0,0 +1 @@\n+export const added = true\n",
      },
    ],
    fileList: (path) => {
      if (path === "frontend\\" || path === "frontend") {
        return [
          { ...fileNode(directory, "frontend/app.ts"), path: "frontend\\app.ts" },
          { ...fileNode(directory, longPath), path: `frontend\\${longFilename}` },
        ]
      }

      if (path) return []

      return [
        { ...fileNode(directory, "frontend", "directory"), name: "", path: "frontend\\" },
        fileNode(directory, "README.md"),
      ]
    },
    findFiles: ({ query }) => (longPath.includes(query) ? [fileNode(directory, longPath)] : []),
    fileContent: (path) => ({ type: "text", content: `contents:${path}` }),
    seed: {
      panes: { ses_openfileexpand: { review: true } },
    },
  })

  const panel = page.locator("#review-panel")
  await panel.getByRole("button", { name: "Open file" }).click()
  await expect(panel.getByRole("tab", { name: "Open file" })).toHaveAttribute("aria-selected", "true")
  const openView = panel.locator('[data-slot="session-open-file"]')
  const frontend = openView.locator('[data-slot="file-tree-v2-row"][data-path="frontend"]')
  await expect(frontend.getByText("frontend", { exact: true })).toBeVisible()
  await expect(frontend).toHaveAttribute("aria-expanded", "false")
  await frontend.click()
  await expect(frontend).toHaveAttribute("aria-expanded", "true")

  const viewport = openView.locator(".scroll-view__viewport")
  const longRow = openView.getByRole("button", { name: longFilename })
  const status = longRow.locator('[data-slot="file-tree-v2-change"]')
  await expect(longRow).toBeVisible()
  await expect.poll(() => viewport.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeGreaterThan(0)
  await expect(longRow.locator('[data-slot="file-tree-v2-label"]')).toHaveCSS("text-overflow", "clip")
  await expect(status).toHaveText("A")
  await expect.poll(() => statusInset(status, "right")).toBeLessThanOrEqual(24)
  await viewport.hover()
  await page.mouse.wheel(1_000, 0)
  await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
  await expect.poll(() => statusInset(status, "right")).toBeLessThanOrEqual(24)
  const thumb = openView.locator('.scroll-view__thumb[data-orientation="horizontal"]')
  const scrolled = await viewport.evaluate((element) => element.scrollLeft)
  await dragThumb(page, thumb, -40)
  await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeLessThan(scrolled)

  const filter = panel.getByRole("combobox", { name: "Filter files" })
  await filter.fill(longFilename)
  const filteredStatus = panel.getByRole("option", { name: longFilename }).locator('[data-slot="file-tree-v2-change"]')
  await expect(filteredStatus).toHaveText("A")
  await viewport.evaluate((element) => {
    element.setAttribute("dir", "rtl")
    element.scrollLeft = 0
    element.dispatchEvent(new Event("scroll"))
  })
  await viewport.hover()
  await dragThumb(page, thumb, -40)
  await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeLessThan(0)
  await expect.poll(() => statusInset(filteredStatus, "left")).toBeLessThanOrEqual(24)
  await viewport.evaluate((element) => {
    element.removeAttribute("dir")
    element.scrollLeft = 0
  })

  await filter.fill("")
  await openView.locator('[data-slot="file-tree-v2-row"][data-path="frontend/app.ts"]').click()
  await expect(panel.getByRole("tab", { name: "app.ts" })).toHaveAttribute("aria-selected", "true")
  await expect(panel.getByText("contents:frontend/app.ts", { exact: true })).toBeVisible()
})

test("a restored file tab keeps the sidebar on the source-control view", async ({ page }) => {
  const directory = "C:/OpenCode/TreeRestore"
  await openSession(page, {
    name: "TreeRestore",
    vcsDiff: [fileDiff("src/changed.ts")],
    fileList: (path) => (path ? [] : [fileNode(directory, "README.md")]),
    fileContent: (path) => ({ type: "text", content: `contents:${path}` }),
    seed: { panes: { ses_treerestore: { review: true } } },
  })
  const panel = page.locator("#review-panel")
  const tree = page.locator("#file-tree-panel")
  const explorer = page.getByRole("button", { name: "Explorer", exact: true })
  const sourceControl = page.getByRole("button", { name: "Source Control", exact: true })
  const readme = panel.getByRole("tab", { name: "README.md", exact: true })

  // The explorer's tree opens the file in the editor region.
  await tree.getByRole("button", { name: "README.md" }).click()
  await expect(readme).toHaveAttribute("aria-selected", "true")

  // The source-control view lists the changed files below the review's header.
  await sourceControl.click()
  await expect(sourceControl).toHaveAttribute("aria-current", "true")
  await expect(tree.getByRole("button", { name: "changed.ts" })).toBeVisible()

  await page.reload()
  await expect(readme).toHaveAttribute("aria-selected", "true")
  await expect(panel.getByText("contents:README.md", { exact: true })).toBeVisible()
  await expect(sourceControl).toHaveAttribute("aria-current", "true")
  await expect(tree.getByRole("button", { name: "changed.ts" })).toBeVisible()

  // Selecting a file tab after load still shows it among all files.
  await readme.click()
  await expect(explorer).toHaveAttribute("aria-current", "true")
  await expect(tree.getByRole("button", { name: "README.md" })).toBeVisible()
})

test("rereads a file each time an artifact link opens it", async ({ page }) => {
  const file = { content: "first draft" }

  const messages = [
    { id: "msg_prompt", type: "user", text: "Write the shopping list", time: { created: 1 } },
    {
      id: "msg_reply",
      type: "assistant",
      agent: "build",
      model: { id: "test", providerID: "opencode" },
      content: [{ type: "text", text: "Updated [shopping.txt](shopping.txt)." }],
      time: { created: 2, completed: 3 },
    },
  ] satisfies SessionMessageInfo[]

  await openSession(page, {
    name: "ArtifactReopen",
    fileList: () => [],
    fileContent: (path) => (path === "shopping.txt" ? file : ""),
    pageMessages: () => ({ items: messages }),
  })

  const link = page.getByRole("link", { name: "shopping.txt", exact: true })
  const panel = page.locator("#review-panel")
  const tab = panel.getByRole("tab", { name: "shopping.txt" })
  await link.click()
  await expect(tab).toHaveAttribute("aria-selected", "true")
  await expect(panel.getByText("first draft", { exact: true })).toBeVisible()

  file.content = "second draft"
  await tab.locator("..").getByRole("button", { name: "Close tab" }).click()
  await expect(tab).toHaveCount(0)
  await link.click()
  await expect(tab).toHaveAttribute("aria-selected", "true")
  await expect(panel.getByText("second draft", { exact: true })).toBeVisible()
  await expect(panel.getByText("first draft", { exact: true })).toHaveCount(0)
})

/** What the image case's frame probe records on the window. */
type ImageProbe = { problems: string[]; frames: number; running: boolean }

test("image files load into the review view and keep it painted while loading", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 900 })
  const directory = "C:/OpenCode/ReviewImage"
  const image = "assets/preview.png"
  const read = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  await openSession(page, {
    name: "ReviewImage",
    vcsDiff: [fileDiff("src/example.ts"), { file: image, patch: "", additions: 1, deletions: 0, status: "added" }],
    fileContent: async (path) => {
      if (path !== image) return undefined
      read.resolve()
      await release.promise

      // A 1x1 PNG.
      return {
        type: "binary",
        content: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
        encoding: "base64",
        mimeType: "image/png",
      }
    },
    fileList: (path) => {
      if (!path) return [fileNode(directory, "assets", "directory"), fileNode(directory, "src", "directory")]

      if (path === "assets") return [fileNode(directory, image)]

      if (path === "src") return [fileNode(directory, "src/example.ts")]

      return []
    },
  })
  await page.getByRole("button", { name: "Toggle review" }).click()
  await expect(page.locator('#file-tree-panel [data-scope="review-scm"]')).toBeVisible()

  // Records every painted frame from before the click until after the image read completes.
  await page.evaluate(() => {
    const probe: ImageProbe = { problems: [], frames: 0, running: true }

    const sample = () => {
      const panel = document.querySelector<HTMLElement>('#file-tree-panel [data-scope="review-scm"]')
      const rect = panel?.getBoundingClientRect()

      const hit =
        rect?.width && rect.height ? document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) : null

      const frame = [
        !panel?.checkVisibility() && "hidden",
        !panel?.textContent?.trim() && "blank",
        !(hit && document.querySelector("#file-tree-panel")?.contains(hit)) && "outside the review view",
        hit && getComputedStyle(hit).backgroundColor === "rgb(0, 0, 0)" && "black",
      ].filter((problem) => problem !== false && problem !== null)

      probe.problems.push(...frame)
      probe.frames += 1

      if (probe.running) requestAnimationFrame(sample)
    }

    // The evaluates below read it.
    Object.assign(window, { e2eImageProbe: probe })
    requestAnimationFrame(sample)
  })

  const frames = () =>
    // SAFETY: the evaluate above stored the probe on the window before any frame is counted.
    page.evaluate(() => (window as Window & { e2eImageProbe?: ImageProbe }).e2eImageProbe!.frames)

  const response = page.waitForResponse((item) => item.url().includes(`/api/fs/read/${image}`))
  await page.getByRole("button", { name: /preview\.png/ }).click()
  await read.promise
  const pending = await frames()
  await expect.poll(frames).toBeGreaterThan(pending)
  release.resolve()
  await response
  await expect(page.locator('[data-slot="session-review-v2-file-name"]')).toHaveText("preview.png")
  await expect(page.locator("#file-tree-panel").getByRole("img", { name: image, exact: true })).toHaveJSProperty(
    "naturalWidth",
    1,
  )
  const loaded = await frames()
  await expect.poll(frames).toBeGreaterThan(loaded)
  expect(
    await page.evaluate(() => {
      // SAFETY: the evaluate above stored the probe on the window.
      const probe = (window as Window & { e2eImageProbe?: ImageProbe }).e2eImageProbe!
      probe.running = false

      return probe.problems
    }),
  ).toEqual([])
})

test("video files expand into an in-window theatre overlay and collapse on Escape without remounting", async ({
  page,
}) => {
  const directory = "C:/OpenCode/ReviewVideo"
  const file = "demo.webm"

  const webm = Buffer.from(
    "GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAH5EU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggEyTbuMU6uEHFO7a1OsggHj7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjMuMS4xMDJXQYxMYXZmNjMuMS4xMDJEiYhAj0AAAAAAABZUrmvXrgEAAAAAAABO14EBc8WIiQeUklk95R2cgQAitZyDdW5kiIEAhoVWX1ZQOIOBASPjg4Q7msoA4JCwgUC6gSSagQJVsIRVuYEBVe6BAOwBAAAAAAAAAgAAElTDZ/pzc59jwIBnyJlFo4dFTkNPREVSRIeMTGF2ZjYzLjEuMTAyc3PVY8CLY8WIiQeUklk95R1nyKBFo4dFTkNPREVSRIeTTGF2YzYzLjEuMTAyIGxpYnZweGfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDEuMDAwMDAwMDAwAB9DtnWt54EAo6iBAACAsAIAnQEqQAAkAABHCIWFiJmEiAICAAaOT8zHm/FYAP7/q1CAHFO7a5G7j7OBALeK94EB8YIBsfCBAw==",
    "base64",
  )

  await openSession(page, {
    name: "ReviewVideo",
    fileList: (path) => (path ? [] : [fileNode(directory, file)]),
    seed: {
      panes: { ses_reviewvideo: { review: true } },
    },
  })
  await page.route(`**/api/fs/read/${file}*`, (route) =>
    route.fulfill({
      status: 200,
      headers: { "access-control-allow-origin": "*", "content-type": "application/octet-stream" },
      body: webm,
    }),
  )

  const panel = page.locator("#review-panel")
  await panel.getByRole("button", { name: "Open file" }).click()
  await panel.getByRole("button", { name: file }).click()
  await expect(panel.getByRole("tab", { name: file, exact: true })).toHaveAttribute("aria-selected", "true")

  const stage = panel.locator('[data-slot="artifact-stage"]')
  const video = stage.locator('video[data-slot="artifact-media"]')
  const fullscreen = stage.getByRole("button", { name: "Enter full screen", exact: true })
  const exitFullscreen = stage.getByRole("button", { name: "Exit full screen", exact: true })

  await expect(video).toBeVisible()
  await expect(fullscreen).toHaveAttribute("aria-pressed", "false")
  const inlineBounds = (await stage.boundingBox())!
  expect(inlineBounds.width).toBeLessThan(1000)

  await video.evaluate((element) => {
    element.dataset.e2eProbe = "retained"
  })

  await fullscreen.click()
  await expect(exitFullscreen).toHaveAttribute("aria-pressed", "true")
  await expect(stage).toHaveAttribute("data-expanded", "")
  expect(await stage.evaluate((element) => element.matches(":popover-open"))).toBe(true)
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull()
  expect(await video.evaluate((element) => element.dataset.e2eProbe)).toBe("retained")
  await expect.poll(() => stage.boundingBox()).toEqual({ x: 0, y: 0, width: 1440, height: 900 })

  await page.keyboard.press("Escape")
  await expect(fullscreen).toHaveAttribute("aria-pressed", "false")
  await expect(stage).not.toHaveAttribute("data-expanded")
  expect(await stage.evaluate((element) => element.matches(":popover-open"))).toBe(false)
  expect(await video.evaluate((element) => element.dataset.e2eProbe)).toBe("retained")
  await expect.poll(() => stage.boundingBox()).toEqual(inlineBounds)

  await video.dblclick()
  await expect(exitFullscreen).toHaveAttribute("aria-pressed", "true")
  await page.mouse.click(8, 8)
  await expect(fullscreen).toHaveAttribute("aria-pressed", "false")
  expect(await video.evaluate((element) => element.dataset.e2eProbe)).toBe("retained")
})

test("restores review state and editor tabs per session", async ({ page }) => {
  const sessions = [
    { id: "ses_review_state_a", title: "Alpha review state" },
    { id: "ses_review_state_b", title: "Beta review state" },
    { id: "ses_review_state_c", title: "Gamma review state" },
  ]

  const directory = "C:/OpenCode/ReviewState"
  await openSession(page, {
    name: "ReviewState",
    sessions,
    vcs: { current: "feature", default: "dev" },
    vcsDiff: ({ mode }) =>
      mode === "branch"
        ? [fileDiff("src/alpha.ts"), fileDiff("src/beta.ts")]
        : [fileDiff("src/alpha.ts"), fileDiff("src/gamma.ts")],
    fileList: () => [fileNode(directory, "README.md")],
    fileContent: (path) => ({ type: "text", content: `contents:${path}` }),
  })
  const panel = page.locator("#review-panel")
  const tree = page.locator("#file-tree-panel")
  const toggle = page.getByRole("button", { name: "Toggle review" })

  const selectedTab = (name: string) =>
    expect(panel.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true")

  const selectedFile = (file: string) =>
    expect(page.locator('[data-slot="session-review-v2-file-name"]')).toHaveText(file)

  const switchSession = async (title: string) => {
    await page.locator("[data-titlebar-tab-slot]", { hasText: title }).click()
    await expectSessionTitle(page, title)
  }

  // Each session selects a review file other than the first, which the review would show without a stored selection.
  await tree.getByRole("button", { name: "README.md" }).click()
  await selectedTab("README.md")
  await toggle.click()
  await tree.getByRole("button", { name: "gamma.ts" }).click()
  await selectedFile("gamma.ts")

  await switchSession("Beta review state")
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  await page.getByRole("button", { name: "Git changes" }).click()
  await page.getByRole("option", { name: "Branch changes" }).click()
  await tree.getByRole("button", { name: "beta.ts" }).click()
  await selectedFile("beta.ts")
  await page.getByRole("button", { name: "View context usage" }).click()
  await selectedTab("Context")

  await switchSession("Gamma review state")
  await page.keyboard.press("Control+P")
  await selectedTab("Open file")

  // Each session keeps its own review selection and editor tab.
  await switchSession("Alpha review state")
  await selectedTab("README.md")
  await selectedFile("gamma.ts")
  await switchSession("Beta review state")
  await selectedTab("Context")
  await expect(page.getByRole("button", { name: "Branch changes" })).toBeVisible()
  await selectedFile("beta.ts")
  await switchSession("Gamma review state")
  await selectedTab("Open file")

  await page.reload()
  await expectSessionTitle(page, "Gamma review state")
  await selectedTab("Open file")
  await switchSession("Beta review state")
  await selectedTab("Context")
  await expect(page.getByRole("button", { name: "Branch changes" })).toBeVisible()
  await selectedFile("beta.ts")
  await switchSession("Alpha review state")
  await selectedTab("README.md")
  await selectedFile("gamma.ts")

  // Close Tab claims the editor's file tab while the region shows one, and the session tab once it does not.
  await page.keyboard.press("Control+w")
  await expect(panel.getByRole("tab", { name: "README.md", exact: true })).toHaveCount(0)
  await expect(panel).toBeHidden()
  await page.keyboard.press("Control+w")
  await expect(page.locator("[data-titlebar-tab-slot]", { hasText: "Alpha review state" })).toHaveCount(0)
  await expectSessionTitle(page, "Beta review state")
  await page.keyboard.press("Control+Shift+T")
  await expectSessionTitle(page, "Alpha review state")
})

test("shows and restores last turn changes from the session diff", async ({ page }) => {
  const sessionID = "ses_reviewturn"
  await openSession(page, { name: "ReviewTurn", vcsDiff: [fileDiff("src/alpha.ts")] })
  await page.route(`**/api/session/${sessionID}/diff**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [fileDiff("src/delta.ts")] }),
    }),
  )
  const panel = page.locator("#file-tree-panel")
  await page.getByRole("button", { name: "Toggle review" }).click()
  await page.getByRole("button", { name: "Git changes" }).click()
  await page.getByRole("option", { name: "Last turn changes" }).click()
  await expect(page.getByRole("button", { name: "Last turn changes" })).toBeVisible()
  await expect(panel.locator('[data-slot="session-review-v2-file-name"]')).toHaveText("delta.ts")

  await page.reload()
  await expectSessionTitle(page, "ReviewTurn")
  await expect(page.getByRole("button", { name: "Last turn changes" })).toBeVisible()
  await expect(panel.locator('[data-slot="session-review-v2-file-name"]')).toHaveText("delta.ts")
})

test("keeps the review state a session stored before extensions", async ({ page }) => {
  const directory = "C:/OpenCode/ReviewLegacy"
  await openSession(page, {
    name: "ReviewLegacy",
    vcs: { current: "feature", default: "dev" },
    vcsDiff: ({ mode }) =>
      mode === "branch" ? [fileDiff("alpha.ts"), fileDiff("beta.ts")] : [fileDiff("alpha.ts"), fileDiff("gamma.ts")],
    seed: {
      storage: {
        "opencode.global.dat:layout": {
          sessionView: {
            [`local\u0000${base64Encode(directory)}/ses_reviewlegacy`]: {
              scroll: {},
              reviewMode: "branch",
              reviewFile: "beta.ts",
              reviewOpen: ["beta.ts"],
            },
          },
        },
      },
    },
  })
  const mode = (name: string) => page.getByRole("button", { name, exact: true })
  const changes = page.getByRole("tablist", { name: "Session view", exact: true }).getByRole("tab", { name: "Changes" })

  const trigger = (file: string) =>
    page
      .locator(`[data-component="session-review"] [data-file="${file}"]`)
      .getByRole("button", { name: file, exact: true })

  await page.getByRole("button", { name: "Toggle review" }).click()
  await expect(mode("Branch changes")).toBeVisible()
  await expect(page.locator('[data-slot="session-review-v2-file-name"]')).toHaveText("beta.ts")
  // The narrow review lists every file and expands the ones left open.
  await page.setViewportSize({ width: 390, height: 844 })
  await changes.click()
  await expect(trigger("beta.ts")).toHaveAttribute("aria-expanded", "true")
  await expect(trigger("alpha.ts")).toHaveAttribute("aria-expanded", "false")

  // The copy happens once: a later change survives a reload, although the old state is still stored.
  await mode("Branch changes").click()
  await page.getByRole("option", { name: "Git changes" }).click()
  await expect(trigger("gamma.ts")).toBeVisible()
  await page.reload()
  await changes.click()
  await expect(mode("Git changes")).toBeVisible()
  await expect(trigger("gamma.ts")).toBeVisible()
})

test("desktop review waits for the session's stored mode before it loads changes", async ({ page }) => {
  const directory = "C:/OpenCode/ReviewDesktop"
  const id = "ses_review_desktop"
  const title = "Desktop review"
  await mockOpenCodeServer(page, {
    directory,
    project: project({ id: "proj_review_desktop", directory }),
    provider: provider(),
    sessions: [session({ id, directory, title })],
    pageMessages: () => ({ items: [] }),
    vcs: { current: "feature", default: "dev" },
    vcsDiff: ({ mode }) => (mode === "branch" ? [fileDiff("beta.ts")] : [fileDiff("gamma.ts")]),
  })
  const working: string[] = []
  page.on("request", (request) => {
    const url = new URL(request.url())

    if (url.pathname.endsWith("/vcs/diff") && url.searchParams.get("mode") === "working") working.push(request.url())
  })

  const desktop = (hold?: string) =>
    `/e2e/utils/settings-wsl.html?${new URLSearchParams({
      server: SERVER,
      mode: "stopped",
      storage: "async",
      path: `/server/${base64Encode("sidecar")}/session/${id}`,
      ...(hold && { hold }),
    })}`

  const mode = (name: string) => page.getByRole("button", { name, exact: true })
  const file = page.locator('[data-slot="session-review-v2-file-name"]')
  const toggle = page.getByRole("button", { name: "Toggle review", exact: true })

  await page.goto(desktop())
  await expectSessionTitle(page, title)
  await toggle.click()
  await mode("Git changes").click()
  await page.getByRole("option", { name: "Branch changes" }).click()
  await expect(file).toHaveText("beta.ts")
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.entries(localStorage).some(
          ([key, value]) => key.includes("extension.review.session") && value.includes('"branch"'),
        ),
      ),
    )
    .toBe(true)

  // The reopened window's review mounts before its session store has loaded.
  working.length = 0
  await page.goto(desktop("extension.review.session"))
  await expectSessionTitle(page, title)
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  await expect(page.locator("#file-tree-panel").getByText("Loading changes…", { exact: true })).toBeVisible()
  await expect(mode("Git changes")).toHaveCount(0)
  await page.getByRole("button", { name: "Load held storage" }).click()
  await expect(mode("Branch changes")).toBeVisible()
  await expect(file).toHaveText("beta.ts")
  expect(working).toEqual([])
})

test("a chosen mode the session stops offering shows as Git, and comes back when it is offered again", async ({
  page,
}) => {
  // The mock server reads the branches on each request, so a reload sees the session's branch change.
  const vcs = { current: "feature", default: "dev" }
  await openSession(page, {
    name: "ReviewModeBack",
    vcs,
    vcsDiff: ({ mode }) => (mode === "branch" ? [fileDiff("beta.ts")] : [fileDiff("gamma.ts")]),
  })
  const mode = (name: string) => page.getByRole("button", { name, exact: true })
  const file = page.locator('[data-slot="session-review-v2-file-name"]')

  await page.getByRole("button", { name: "Toggle review", exact: true }).click()
  await mode("Git changes").click()
  await page.getByRole("option", { name: "Branch changes" }).click()
  await expect(file).toHaveText("beta.ts")

  // Back on the default branch, Branch is not offered.
  vcs.current = "dev"
  await page.reload()
  await expect(mode("Git changes")).toBeVisible()
  await expect(file).toHaveText("gamma.ts")

  vcs.current = "feature"
  await page.reload()
  await expect(mode("Branch changes")).toBeVisible()
  await expect(file).toHaveText("beta.ts")
})

test("names a single change source in the source-control view", async ({ page }) => {
  // Turn changes are offered only for Git, so another VCS offers one source.
  await openSession(page, { name: "ReviewHeader", project: { vcs: "hg" }, vcsDiff: [fileDiff("src/alpha.ts")] })
  await page.getByRole("button", { name: "Toggle review", exact: true }).click()
  const scm = page.locator('#file-tree-panel [data-scope="review-scm"]')

  // One offered mode is a label, not a picker.
  await expect(scm.getByText("Git changes", { exact: true })).toBeVisible()
  await expect(scm.getByRole("button", { name: "Git changes" })).toHaveCount(0)
  await expect(scm.getByRole("button", { name: "alpha.ts" })).toBeVisible()
})

for (const direction of ["ltr", "rtl"] as const) {
  test(`review toggle stays at the header edge in ${direction}`, async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 900 })
    await openSession(page, { name: "ReviewToggle" })
    await page.locator("html").evaluate((element, dir) => element.setAttribute("dir", dir), direction)

    const toggle = page.getByRole("button", { name: "Toggle review", exact: true })
    const sidebar = page.locator("#file-tree-panel")
    await expect(toggle).toHaveAttribute("aria-expanded", "false")
    const closed = (await toggle.boundingBox())!
    const header = (await page.locator("[data-session-title]").boundingBox())!
    expect(closed.y).toBeGreaterThanOrEqual(header.y)
    expect(closed.y + closed.height).toBeLessThanOrEqual(header.y + header.height)

    // Selecting the source-control view keeps the toggle at the header edge.
    await toggle.click()
    await expect(toggle).toHaveAttribute("aria-expanded", "true")
    await expect(sidebar.locator('[data-scope="review-scm"]')).toBeVisible()
    await expect(toggle).toHaveCount(1)
    await expect.poll(() => toggle.boundingBox()).toEqual(closed)

    // The editor region opens beside the chat column with the toggle over its header.
    await page.keyboard.press("Control+P")
    const panel = page.locator("#review-panel")
    await expect(panel).toBeVisible()
    await expect
      .poll(async () => {
        const box = (await panel.boundingBox())!

        return (
          closed.x >= box.x &&
          closed.x + closed.width <= box.x + box.width &&
          closed.y >= box.y &&
          closed.y + closed.height <= box.y + 52
        )
      })
      .toBe(true)

    for (const control of [
      panel.locator('[data-slot="session-side-panel-actions"]'),
      panel.getByRole("button", { name: "Open file", exact: true }),
    ]) {
      await expect
        .poll(async () => {
          const box = await control.boundingBox()

          return box ? box.y + box.height / 2 : undefined
        })
        .toBe(closed.y + closed.height / 2)
    }

    // Keyboard toggling closes the sidebar while the toggle keeps its place and focus.
    await toggle.press("Enter")
    await expect(toggle).toHaveAttribute("aria-expanded", "false")
    await expect(sidebar).toBeHidden()
    await expect(toggle).toBeFocused()
    await expect.poll(() => toggle.boundingBox()).toEqual(closed)

    // Pause in the same task as each click so even the first painted state can be inspected: the toggle's
    // pixels never depend on the editor tabs it covers while the sidebar animates.
    for (const opened of [true, false]) {
      await toggle.evaluate((element) => {
        // SAFETY: `toggle` is the review toggle, a button.
        const button = element as HTMLButtonElement
        button.click()
        document
          .getAnimations()
          .filter((animation) => animation.timeline instanceof DocumentTimeline)
          .forEach((animation) => animation.pause())
      })
      await expect(toggle).toHaveAttribute("aria-expanded", String(opened))
      await expect(page.locator("#file-tree-panel")).toHaveCount(opened ? 1 : 0)
      await expect.poll(() => toggle.boundingBox()).toEqual(closed)

      for (const progress of [0.25, 0.8]) {
        await page.locator('[data-slot="session-chat-panel"]').evaluate((chat, progress) => {
          const row = chat.parentElement!

          row.getAnimations({ subtree: true })
            .filter((animation) => animation.timeline instanceof DocumentTimeline)
            .forEach((animation) => {
              animation.pause()
              animation.currentTime = Number(animation.effect!.getTiming().duration) * progress
            })
        }, progress)
        const clip = (await toggle.boundingBox())!
        expect(await page.screenshot({ clip })).toEqual(
          await page.screenshot({ clip, style: ".session-review-v2-tabs-bar { visibility: hidden !important; }" }),
        )
      }
      await page.evaluate(() =>
        document
          .getAnimations()
          .filter((animation) => animation.timeline instanceof DocumentTimeline)
          .forEach((animation) => animation.finish()),
      )
    }

    await expect(page.locator("#file-tree-panel")).toHaveCount(0)
  })
}

async function dragThumb(page: Page, thumb: Locator, dx: number) {
  await expect(thumb).toBeVisible()
  const box = (await thumb.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2)
  await page.mouse.up()
}

async function statusInset(status: Locator, side: "left" | "right") {
  return status.evaluate((element, side) => {
    const viewport = element.closest<HTMLElement>(".scroll-view__viewport")!.getBoundingClientRect()
    const box = element.getBoundingClientRect()

    return side === "right" ? viewport.right - box.right : box.left - viewport.left
  }, side)
}

function filesystemEvent(directory: string, file: string, event: "add" | "change" | "unlink"): OpenCodeEvent {
  return {
    id: `evt_${file}_${event}`,
    created: 1,
    type: "filesystem.changed",
    location: { directory },
    data: { file, event },
  }
}
