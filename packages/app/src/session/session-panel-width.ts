// The middle editor column has no width of its own: it takes whatever the
// chat column leaves behind. Instead of capping the chat column at a fraction
// of the window (which forces the editor column to grow with the monitor),
// reserve a fixed minimum for the editor column and let the chat column take
// everything else.
export const SESSION_PANEL_WIDTH_MIN = 450

const EDITOR_PANE_WIDTH_MIN = 480

const EDITOR_PANE_WIDTH_MIN_SPLIT = 800

export function sessionPanelWidthMax(input: { available: number; split: boolean }) {
  const pane = input.split ? EDITOR_PANE_WIDTH_MIN_SPLIT : EDITOR_PANE_WIDTH_MIN

  return Math.max(SESSION_PANEL_WIDTH_MIN, input.available - pane)
}

// `available` is undefined until the layout row is first measured; render the
// stored width untouched until then to avoid a first-frame snap.
export function clampSessionPanelWidth(input: { width: number; available: number | undefined; split: boolean }) {
  if (input.available === undefined) return input.width

  return Math.min(input.width, sessionPanelWidthMax({ available: input.available, split: input.split }))
}
