import type { JSX, ParentProps } from "solid-js"
import "./session-review-v2.css"

export function SessionFilePanelV2(props: { sidebar?: JSX.Element; children?: JSX.Element }) {
  return (
    <div data-component="session-review-v2">
      <div data-slot="session-review-v2-body">
        {props.sidebar}
        <div data-slot="session-review-v2-preview">{props.children}</div>
      </div>
    </div>
  )
}

export function SessionFilePanelV2Empty(props: ParentProps) {
  return <div data-slot="session-review-v2-empty">{props.children}</div>
}
