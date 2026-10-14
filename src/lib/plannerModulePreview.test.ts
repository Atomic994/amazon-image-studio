import { describe, expect, it } from 'vitest'
import { buildPlannerModulePreviews } from './plannerModulePreview'
import { getAPlusModuleSpecs, type AmazonAPlusPlan } from './listingPlanner'

describe('module preview content', () => {
  it('includes every full field without truncating or mutating the generated plan', () => {
    const plan: AmazonAPlusPlan = {
      slot: 'A+L01', label: 'Header Banner', moduleType: 'header-banner', uploadSize: '970x300', generationSize: '2048x634',
      planMarkdown: '## Composition\n' + 'Full product details. '.repeat(100),
      textTitle: 'Daily comfort', textBody: 'Made for everyday use.',
      prompt: 'Keep the brand Logo unchanged. Use 970x300 composition.', negativePrompt: 'extra products, false claims',
    }
    const before = structuredClone(plan)
    const result = buildPlannerModulePreviews({ specs: getAPlusModuleSpecs('standard-large'), plans: [plan], tier: '2K', seriesStyleGuide: 'Consistent product identity.' })
    expect(result).toHaveLength(1)
    for (const text of [plan.planMarkdown, plan.prompt, plan.negativePrompt, plan.textTitle, plan.textBody, 'Consistent product identity.']) {
      expect(result[0]!.content).toContain(text)
    }
    expect(result[0]!.content).toContain('970x300')
    expect(plan).toEqual(before)
  })

  it('previews custom module order and objectives before planning without inventing a prompt', () => {
    const specs = getAPlusModuleSpecs('standard-large').slice(0, 2).reverse()
    const result = buildPlannerModulePreviews({ specs, plans: [], tier: '4K', seriesStyleGuide: '' })
    expect(result.map((item) => item.slot)).toEqual(specs.map((item) => item.slot))
    expect(result[0]!.content).toContain(specs[0]!.objective)
    expect(result[0]!.content).toContain('尚未生成策划内容')
    expect(result[0]!.content).not.toContain('生图提示词')
    expect(result[0]!.generationSize).not.toBe('')
  })
})
