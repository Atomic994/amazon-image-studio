import { describe, expect, it } from 'vitest'
import { adjacentReviewSlot, nextPendingReviewSlot, reviewShortcut } from './reviewNavigation'

const rows = [{ slot: 'MAIN', status: 'approved' }, { slot: 'PT01', status: 'pending' }, { slot: 'PT02', status: 'changes-requested' }]
describe('continuous review navigation', () => {
  it('keeps ordinary navigation in bounds and preserves the explicit queue order', () => {
    expect(adjacentReviewSlot(rows, 'MAIN', -1)).toBeNull(); expect(adjacentReviewSlot(rows, 'PT02', 1)).toBeNull()
    expect(adjacentReviewSlot(rows, 'PT01', -1)).toBe('MAIN'); expect(adjacentReviewSlot(rows, 'PT01', 1)).toBe('PT02')
    expect(adjacentReviewSlot(rows, 'missing', 1)).toBeNull()
  })
  it('wraps to another pending slot while skipping approved and the just-completed item', () => {
    expect(nextPendingReviewSlot(rows, 'PT01', 'PT01')).toBe('PT02')
    expect(nextPendingReviewSlot(rows, 'PT02')).toBe('PT01')
    expect(nextPendingReviewSlot([{ slot: 'MAIN', status: 'pending' }], 'MAIN', 'MAIN')).toBeNull()
    expect(nextPendingReviewSlot(rows.map((row) => ({ ...row, status: 'approved' })), 'MAIN')).toBeNull()
    expect(nextPendingReviewSlot([], 'MAIN')).toBeNull()
  })
  it.each([['ArrowLeft', 'previous'], ['ArrowRight', 'next'], ['n', 'next-pending'], ['Enter', 'approve'], ['r', 'changes']])('maps %s to %s', (key, action) => {
    expect(reviewShortcut({ key })).toBe(action)
  })
  it.each([{ repeat: true }, { isComposing: true }, { defaultPrevented: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }])('ignores composition, repeats, modifiers and owned events: %j', (flags) => {
    expect(reviewShortcut({ key: 'Enter', ...flags })).toBeNull()
  })
  it('ignores typing targets and native button activation and assigns no destructive shortcut', () => {
    const target = { closest: () => ({ tagName: 'TEXTAREA' }) } as unknown as EventTarget
    expect(reviewShortcut({ key: 'Enter', target })).toBeNull(); expect(reviewShortcut({ key: 'ArrowLeft', target })).toBeNull()
    expect(reviewShortcut({ key: 'Delete' })).toBeNull(); expect(reviewShortcut({ key: 'Backspace' })).toBeNull(); expect(reviewShortcut({ key: 'Escape' })).toBeNull()
  })
})
