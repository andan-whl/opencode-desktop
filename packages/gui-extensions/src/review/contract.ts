import type { FileDiffInfo } from "@opencode/client/promise"
import type { Component } from "solid-js"
import { Contract, type MountedSession, type SessionRef, type SessionScreen } from "../sdk"

export type ChangeKind = "add" | "del" | "mix"

/** The routed session's changes as the review shows them. Empty for other sessions. */
export interface Changes {
  /** The current review mode's diffs, empty until they load. Reactive. */
  diffs(session: SessionRef): readonly FileDiffInfo[]
  /** False while the current mode's diffs load. */
  ready(session: SessionRef): boolean
  /** The change kind of each changed file and each of its directories, keyed by normalized path. */
  kinds(session: SessionRef): ReadonlyMap<string, ChangeKind>
  /** The file the review shows. */
  active(session: SessionRef): string | undefined
  /**
   * The session directory's uncommitted changes, independent of the review mode (the session details' changes row).
   * Loads only while a `details` watch holds; undefined until loaded, empty when the load fails.
   */
  details(session: SessionRef): readonly FileDiffInfo[] | undefined
  /** Shows `path` in the review: the sidebar's source-control view, or the narrow-screen Changes view. */
  focus(session: SessionRef, path: string): void
  /** Shows the changes: the sidebar's source-control view, or the narrow-screen Changes view. */
  open(session: SessionRef): void
  /**
   * Keeps the changes of the view the caller renders loaded while it shows them, across the view's session
   * switches. A `tree` is a persistent change list: showing the changes refreshes the changes it shows.
   * `details` loads `details(session)`.
   *
   * @param screen - The owning screen from the panel or session-slot input, available even before publication.
   * @param source - The view's demand: a tree, file markers or session details.
   */
  watch(screen: SessionScreen, source: "tree" | "files" | "details"): () => void
  /** Runs when review reveals a change (e.g. from a composer comment), so change lists can show theirs. */
  onReveal(listener: () => void): () => void
}

/** The review extension provides this. The session details' changes row reads the same data. */
export const Changes = Contract.define<Changes, "review.changes">("review.changes")

/** The review's source-control view for the sidebar: the changed files with the selected file's diff below. */
export interface ScmView {
  /** Renders the view for one mounted session. */
  readonly View: Component<{ session: MountedSession; screen: SessionScreen }>
}

/** The review extension provides this. The file extension's sidebar shows it in its `scm` view. */
export const ScmView = Contract.define<ScmView, "review.scm.view">("review.scm.view")
