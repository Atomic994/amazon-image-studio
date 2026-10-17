export interface ReviewQueueItem { slot: string; status: string }
export function adjacentReviewSlot(rows: ReviewQueueItem[], slot: string, direction: -1 | 1): string | null {
  const index = rows.findIndex((row) => row.slot === slot)
  return index < 0 ? null : rows[index + direction]?.slot ?? null
}
export function nextPendingReviewSlot(rows: ReviewQueueItem[], slot: string, finishedSlot?: string): string | null {
  const index = rows.findIndex((row) => row.slot === slot)
  for (let offset = 1; offset <= rows.length; offset++) {
    const row = rows[(Math.max(-1, index) + offset) % rows.length]
    if (row && row.slot !== slot && row.slot !== finishedSlot && row.status !== 'approved') return row.slot
  }
  return null
}
export type ReviewShortcut = 'previous' | 'next' | 'next-pending' | 'approve' | 'changes'
export function reviewShortcut(event: { key: string; repeat?: boolean; isComposing?: boolean; defaultPrevented?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean; target?: EventTarget | null }): ReviewShortcut | null {
  if (event.repeat || event.isComposing || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null
  const target = event.target as Element | null | undefined
  if (typeof target?.closest === 'function' && target.closest('input, textarea, select, button, a, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="slider"]')) return null
  return ({ ArrowLeft: 'previous', ArrowRight: 'next', n: 'next-pending', N: 'next-pending', Enter: 'approve', r: 'changes', R: 'changes' } as Record<string, ReviewShortcut>)[event.key] ?? null
}
