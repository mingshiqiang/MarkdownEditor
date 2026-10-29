/**
 * Pure geometry helpers for mouse selection in live mode.
 *
 * The live renderer switches a block between its rendered and source form
 * when the selection touches it, which can change the block's height. These
 * helpers decide the drag direction (which source endpoint to include) and
 * the scroll correction that keeps the clicked text under the pointer; the
 * DOM-dependent part lives in `extensions/liveRender.ts`.
 */

/** Whether a drag from (startX, startY) to (x, y) runs forward through the text. */
export function dragMovesForward(startX: number, startY: number, x: number, y: number): boolean {
  return y > startY || (y === startY && x >= startX)
}

/**
 * The scroll correction that puts the caret back where it was before the
 * block switched forms. Zero for sub-pixel moves (both forms have the same
 * metrics) and for implausibly large deltas (the layout has not settled yet).
 */
export function caretScrollDelta(
  before: { top: number; bottom: number } | null,
  after: { top: number; bottom: number } | null
): number {
  if (!before || !after) return 0
  const delta = (after.top + after.bottom) / 2 - (before.top + before.bottom) / 2
  if (!Number.isFinite(delta) || Math.abs(delta) < 0.5 || Math.abs(delta) > 400) return 0
  return delta
}
