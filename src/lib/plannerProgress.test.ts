import { describe, expect, it } from 'vitest'
import { createPlannerPlanCounter } from './plannerProgress'

describe('streamed planner progress', () => {
  it('counts only complete plan objects across chunk boundaries and ignores braces in prompt strings', () => {
    const first = { slot: 'MAIN', prompt: 'Show {product}, a quoted "label", and \\ accents.', detail: { colors: ['white'] } }
    const second = { slot: 'PT01', prompt: 'Chinese 文案 and literal } ] { punctuation.' }
    const prefix = '{"product":{"imagePlans":[{}]},"seriesStyleGuide":"imagePlans","imagePlans":['
    const counter = createPlannerPlanCounter('imagePlans')
    expect(counter.append(prefix + JSON.stringify(first).slice(0, -1)).completedPlans).toBe(0)
    expect(counter.append('},').completedPlans).toBe(1)
    for (const char of JSON.stringify(second).slice(0, -1)) expect(counter.append(char).completedPlans).toBe(1)
    const result = counter.append('}]}')
    expect(result).toEqual({ completedPlans: 2, receivedChars: (prefix + JSON.stringify(first) + ',' + JSON.stringify(second) + ']}').length })
  })

  it('tracks A+ modules without counting the Listing array', () => {
    const counter = createPlannerPlanCounter('aPlusPlans')
    const result = counter.append('{"imagePlans":[{},{}],"aPlusPlans":[{"slot":"A+S01"},{"slot":"A+S02"}]}')
    expect(result.completedPlans).toBe(2)
  })

  it('does not interpret JSON-like text embedded in a string as plan progress', () => {
    const counter = createPlannerPlanCounter('imagePlans')
    expect(counter.append(JSON.stringify({ seriesStyleGuide: 'Example: "imagePlans": [{}, {}]', sellingPoints: ['}', '{'], product: { title: 'Mock' } })).completedPlans).toBe(0)
  })
})
