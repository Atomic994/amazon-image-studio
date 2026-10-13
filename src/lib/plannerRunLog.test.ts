import { describe, expect, it } from 'vitest'
import { appendPlannerLog, createPlannerRunLog, finishPlannerRunLog, formatPlannerLogForCopy, updatePlannerRunLog, type PlannerRunLogState } from './plannerRunLog'

function running(): PlannerRunLogState {
  return { ...createPlannerRunLog(), status: 'running', phase: 'preparing', startedAt: 0, totalPlans: 7 }
}

describe('planner run log', () => {
  it('retains retry reasons while resetting counters for the next attempt and masking credentials', () => {
    let state = updatePlannerRunLog(running(), { phase: 'receiving', attempt: 1, maxAttempts: 3, receivedChars: 800, completedPlans: 2, totalPlans: 7 }, 1000)
    state = updatePlannerRunLog(state, { phase: 'retrying', attempt: 2, maxAttempts: 3, message: 'HTTP 504: sk-private-test Bearer secret-token', retryDelayMs: 1000 }, 2000, 'sk-private-test')
    state = updatePlannerRunLog(state, { phase: 'connecting', attempt: 2, maxAttempts: 3, receivedChars: 0, completedPlans: 0 }, 3000)
    expect(state.receivedChars).toBe(0)
    expect(state.completedPlans).toBe(0)
    expect(state.lastContentAt).toBeUndefined()
    expect(state.entries[1]?.message).toContain('HTTP 504')
    expect(formatPlannerLogForCopy(state)).not.toContain('sk-private-test')
    expect(formatPlannerLogForCopy(state)).not.toContain('secret-token')
    expect(state.entries[1]?.message).toContain('1 秒后重试（2/3）')
  })

  it('separates connection activity from actual output and avoids adding a line for every token', () => {
    let state = updatePlannerRunLog(running(), { phase: 'receiving', attempt: 1, maxAttempts: 3, receivedChars: 100, completedPlans: 0, totalPlans: 7 }, 1000)
    state = updatePlannerRunLog(state, { phase: 'receiving', attempt: 1, maxAttempts: 3, receivedChars: 200, completedPlans: 0, totalPlans: 7 }, 2000)
    expect(state.entries).toHaveLength(1)
    expect(state.receivedChars).toBe(200)
    state = updatePlannerRunLog(state, { phase: 'activity', attempt: 1, maxAttempts: 3 }, 16_000)
    expect(state.lastActivityAt).toBe(16_000)
    expect(state.lastContentAt).toBe(2000)
    expect(state.phase).toBe('receiving')
    expect(state.entries).toHaveLength(2)
  })

  it.each(['success', 'error', 'stopped'] as const)('keeps the %s log available and ignores late events after completion', (status) => {
    const state = finishPlannerRunLog(running(), status, 'Final result', 65_000)
    expect(state.finishedAt).toBe(65_000)
    expect(state.status).toBe(status)
    expect(formatPlannerLogForCopy(state)).toContain('+1分5秒')
    expect(updatePlannerRunLog(state, { phase: 'receiving', attempt: 1, maxAttempts: 3 }, 66_000)).toBe(state)
    expect(finishPlannerRunLog(state, 'stopped', 'Late cancellation', 66_000)).toBe(state)
  })

  it('bounds a long-running log while keeping entry identifiers unique', () => {
    let state = running()
    for (let i = 0; i < 200; i++) state = appendPlannerLog(state, `Event ${i}`, i)
    expect(state.entries).toHaveLength(160)
    expect(state.entries[0]?.message).toBe('Event 40')
    expect(new Set(state.entries.map((entry) => entry.id)).size).toBe(160)
  })
})
