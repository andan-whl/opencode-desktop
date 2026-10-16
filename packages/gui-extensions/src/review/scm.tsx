import { createMemo, createResource, Show } from "solid-js"
import { Dynamic } from "solid-js/web"
import type { SessionReviewExpandMode } from "@opencode/session-ui/v2/session-review-v2"
import { SessionReviewFilePreviewV2 } from "@opencode/session-ui/v2/session-review-file-preview-v2"
import { DiffChanges } from "@opencode/ui/diff-changes"
import { useExtension, type MountedSession, type SessionScreen } from "../sdk"
import type Review from "./index"
import { reviewDiffNeedsLoad } from "./kinds"
import type { ReviewModel } from "./model"
import { ReviewPanelEmpty, ReviewTitle } from "./parts"

/**
 * The review's source-control view for the sidebar: the changed files above, the selected file's diff below.
 * The narrow column shows the unified diff style.
 */
export default function ScmViewContent(props: {
  review: ReviewModel
  session: MountedSession
  screen: SessionScreen
  expandMode: SessionReviewExpandMode
}) {
  const ctx = useExtension<typeof Review>()
  const review = props.review

  // The file extension draws the change tree; it hosts this view, so it is up whenever this renders.
  const tree = () => {
    const live = ctx.uses.tree()

    return live.status === "active" ? live.value : undefined
  }

  const diffs = createMemo(() => review.renderable())
  // Changes-only trees omit "M" — every row is already a change; A/D stay visible.
  const kinds = createMemo(() => new Map([...review.kinds()].filter(([, kind]) => kind !== "mix")))

  const activeDiff = createMemo(() => diffs().find((diff) => diff.file === review.activeFile()))

  const detailSource = createMemo(() => {
    const diff = activeDiff()

    if (!diff || !reviewDiffNeedsLoad(diff)) return undefined

    return diff
  })

  const [loadedDiff] = createResource(detailSource, async (diff) => {
    const value = await review.loadDiff(diff.file, review.diffVersion())

    return value?.file === diff.file ? value : undefined
  })

  const activeItem = createMemo(() => {
    const source = activeDiff()

    if (loadedDiff.state !== "ready") return source
    const loaded = loadedDiff()

    return loaded && loaded.file === source?.file ? loaded : source
  })

  // The preview's file and its diff, matched so a refreshed list never pairs the wrong two.
  const selection = createMemo(() => {
    const file = review.activeFile()
    const diff = activeItem()

    return file && diff && diff.file === file ? { file, diff } : undefined
  })

  return (
    <div class="flex h-full min-h-0 flex-col" data-scope="review-scm">
      <div class="flex h-8 shrink-0 items-center gap-2 px-3">
        <ReviewTitle review={review} />
        <Show when={diffs().length > 0}>
          <div class="ms-auto">
            <DiffChanges changes={diffs()} />
          </div>
        </Show>
      </div>
      <Show
        when={review.ready() && diffs().length > 0}
        fallback={
          <div class="min-h-0 flex-1 overflow-hidden">
            <ReviewPanelEmpty review={review} />
          </div>
        }
      >
        <div class="flex min-h-0 flex-1 flex-col">
          <div class="max-h-[50%] min-h-[96px] shrink-0 overflow-hidden border-b border-v2-border-border-muted px-3">
            <Show when={tree()}>
              {(tree) => (
                <Dynamic
                  component={tree().Tree}
                  screen={props.screen}
                  session={props.session}
                  allowed={diffs().map((diff) => diff.file)}
                  kinds={kinds()}
                  active={review.activeFile()}
                  onFileClick={(path: string) => review.focusFile(path)}
                />
              )}
            </Show>
          </div>
          <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
            <Show when={selection()} keyed>
              {(selected) => (
                <SessionReviewFilePreviewV2
                  file={selected.file}
                  diff={selected.diff}
                  diffStyle="unified"
                  expandMode={props.expandMode}
                  readFile={review.readFile}
                  onLineComment={review.comments.add}
                  onLineCommentUpdate={review.comments.update}
                  onLineCommentDelete={review.comments.remove}
                  lineCommentActions={review.comments.actions()}
                  comments={review.comments.all()}
                  focusedComment={review.comments.focus()}
                  onFocusedCommentChange={review.comments.changeFocus}
                />
              )}
            </Show>
          </div>
        </div>
      </Show>
    </div>
  )
}
