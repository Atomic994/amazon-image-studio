import { describe, expect, it } from 'vitest'
import type { AmazonPlannerSession } from '../types'
import { DEFAULT_AMAZON_PROMPT_DRAFT } from './amazonPrompt'
import { plannerContextForSlot, plannerSettingsSnapshot, plannerStyleInstructions, upgradePlannerContextBaseline } from './plannerContext'
import { plannerContextChangeReasons } from './referenceAnalysis'
import { initialPlannerModuleVersions } from './plannerModuleVersions'
import { buildPlannerGenerationSpec } from './plannerGeneration'
import { createDefaultOpenAIProfile } from './apiProfiles'
import { DEFAULT_STYLE_PRESET_ID, STYLE_PRESETS } from './stylePresets'
import { getAPlusModuleSpecs } from './listingPlanner'

function session(): AmazonPlannerSession {
  return { id: 's', title: 'Lamp', mode: 'listing', aPlusType: 'standard-large', resolution: '2k', marketplaceId: 'us', listingText: 'Black desk lamp', listingImageCount: 7,
    draft: { ...DEFAULT_AMAZON_PROMPT_DRAFT, productTitle: 'Lamp' }, imagePlans: ['MAIN', 'PT01'].map((slot) => ({ slot, label: slot, kind: 'main', prompt: 'Photo', planMarkdown: 'Plan', negativePrompt: '' })), aPlusPlans: [],
    referenceImageIds: [], seriesStyleGuides: { listing: 'Warm light', aplus: '' }, selectedStylePresetId: DEFAULT_STYLE_PRESET_ID, selectedStyleIndex: null, styleCandidates: [], styleImages: [], selectedPlanIndex: 0, selectedAPlusPlanIndex: null, createdAt: 1, updatedAt: 1 }
}
describe('planning settings provenance', () => {
  it.each([
    ['Listing', (s: AmazonPlannerSession) => { s.listingText += ' new claim' }, 'Listing 内容已变化'],
    ['product', (s: AmazonPlannerSession) => { s.draft.color = 'White' }, '商品信息或场景要求已变化'],
    ['scene', (s: AmazonPlannerSession) => { s.draft.scene = 'Reading room' }, '商品信息或场景要求已变化'],
    ['visual', (s: AmazonPlannerSession) => { s.selectedStylePresetId = STYLE_PRESETS.find((p) => p.id !== DEFAULT_STYLE_PRESET_ID)!.id }, '视觉风格已变化'],
    ['density', (s: AmazonPlannerSession) => { s.styleDensityMode = 'minimal' }, '信息密度已变化'],
    ['guide', (s: AmazonPlannerSession) => { s.seriesStyleGuides.listing += ' dramatic' }, '整套风格要求已变化'],
    ['count', (s: AmazonPlannerSession) => { s.listingImageCount = 8 }, '图片数量或模块规格已变化'],
    ['marketplace', (s: AmazonPlannerSession) => { s.marketplaceId = 'de' }, '目标站点已变化'],
  ] as const)('identifies a changed %s setting against the request snapshot', (_name, mutate, reason) => {
    const source = session(), before = plannerContextForSlot(source, 'PT01')
    mutate(source)
    expect(plannerContextChangeReasons(before, plannerContextForSlot(source, 'PT01'))).toEqual([reason])
  })
  it('keeps MAIN current when only detail-image presentation changes', () => {
    const source = session(), before = plannerContextForSlot(source, 'MAIN')
    source.draft.scene = 'New scene'; source.styleDensityMode = 'minimal'; source.seriesStyleGuides.listing = 'New guide'; source.selectedStylePresetId = 'other'
    expect(plannerContextChangeReasons(before, plannerContextForSlot(source, 'MAIN'))).toEqual([])
    source.draft.color = 'White'
    expect(plannerContextChangeReasons(before, plannerContextForSlot(source, 'MAIN'))).toContain('商品信息或场景要求已变化')
  })
  it('ignores selected UI slot, output resolution, timestamps and lazy-loaded built-in reference IDs', () => {
    const source = session(), before = plannerSettingsSnapshot(source, 'PT01')
    source.selectedPlanIndex = 1; source.draft.kind = 'scene'; source.resolution = '4k'; source.updatedAt = 100; source.selectedStyleReferenceImageId = 'loaded-after-planning'
    expect(plannerSettingsSnapshot(source, 'PT01')).toEqual(before)
  })
  it('tracks uploaded style image replacement and custom A+ module specifications', () => {
    const source = session()
    source.selectedStylePresetId = null; source.selectedStyleReferenceImageId = 'uploaded-a'
    const before = plannerContextForSlot(source, 'PT01'); source.selectedStyleReferenceImageId = 'uploaded-b'
    expect(plannerContextChangeReasons(before, plannerContextForSlot(source, 'PT01'))).toEqual(['视觉风格已变化'])
    source.mode = 'aplus'; source.aPlusModuleSpecs = { 'standard-large': getAPlusModuleSpecs('standard-large').map((spec) => ({ ...spec })) }
    const aplus = plannerContextForSlot(source, 'A+01')
    source.aPlusModuleSpecs!['standard-large']![0].uploadHeight += 100
    expect(plannerContextChangeReasons(aplus, plannerContextForSlot(source, 'A+01'))).toContain('图片数量或模块规格已变化')
  })
  it('upgrades old saved settings once without erasing original reference and fact provenance', () => {
    const source = session()
    const initial = initialPlannerModuleVersions(source.imagePlans, [], (slot) => ({ ...plannerContextForSlot(source, slot), planningSettings: undefined, referenceFingerprint: 'historical-refs', productFactsVersionId: 'historical-facts' }))
    source.moduleVersions = initial.versions; source.selectedModuleVersions = initial.selected
    const restored = upgradePlannerContextBaseline(source)
    const version = Object.values(restored.moduleVersions!)[0][0]
    expect(version.context).toMatchObject({ referenceFingerprint: 'historical-refs', productFactsVersionId: 'historical-facts', legacySettingsBaseline: true })
    expect(version.context?.planningSettings).toBeDefined(); expect(Object.values(source.moduleVersions)[0][0].context?.planningSettings).toBeUndefined()
    expect(upgradePlannerContextBaseline(restored)).toBe(restored)
  })
  it('keeps generated versions tied to submitted settings when inputs change while awaiting AI', () => {
    const source = session(), request = structuredClone(source)
    const initial = initialPlannerModuleVersions(request.imagePlans, [], (slot) => plannerContextForSlot(request, slot))
    source.moduleVersions = initial.versions; source.selectedModuleVersions = initial.selected
    source.listingText += ' changed during request'
    const spec = buildPlannerGenerationSpec(source, 'PT01', createDefaultOpenAIProfile(), 8)
    expect(spec.stale).toBe(true); expect(spec.staleReasons).toEqual(['Listing 内容已变化'])
  })
  it('provides the same actual style and density contract to full, revised and creative planning', () => {
    const source = session(); source.styleDensityMode = 'minimal'
    expect(plannerStyleInstructions(source, 'PT01')).toContain('Information density: minimal')
    expect(plannerStyleInstructions(source, 'MAIN')).toContain('product-only; no on-image text')
    expect(plannerStyleInstructions(source)).toContain('MAIN must remain a clean white product image')
  })
})
