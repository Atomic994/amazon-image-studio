import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AmazonPlannerSession, ReferenceAnalysisSnapshot, TaskRecord } from '../types'
import { createDefaultAmazonPlannerProfile, createDefaultOpenAIProfile } from './apiProfiles'
import { buildPlannerGenerationSpec, generationProfileIdentity } from './plannerGeneration'
import { normalizeReferenceUsage } from './referenceImageUsage'
import { confirmProductFacts, emptyProductFactsState, contextFingerprint } from './productFacts'
import { createReferenceAnalysisCache, effectiveReferenceAnalysis, normalizeReferenceAnalysis, plannerSourceContext, refreshReferenceAnalysis, reviseReferenceAnalysis } from './referenceAnalysis'
import { initialPlannerModuleVersions } from './plannerModuleVersions'
import { createGenerationQueueItems, queueSubmissionRef, restoreGenerationQueue } from './generationQueueModel'
import { referenceLibraryEntry } from './referenceLibrary'
import { collectWorkflowImageIds } from './workflowReferences'
import { DEFAULT_DELIVERY_OPTIONS, deliveryLayout, deliveryTarget } from './imageDelivery'
import { planCreativeDirections } from './plannerCreativeApi'
import { appendMaterialCollectionVersion } from './materialCollections'
import { DEFAULT_PARAMS } from '../types'
import { DEFAULT_AMAZON_PROMPT_DRAFT } from './amazonPrompt'

const profile = { ...createDefaultOpenAIProfile(), apiKey: 'never-persist-key', baseUrl: 'https://images.example/v1' }
const planner = { ...createDefaultAmazonPlannerProfile(), apiKey: 'test-only', baseUrl: 'https://planner.example/v1', apiMode: 'chat' as const }
const plan = (slot: string) => ({ slot, label: slot, kind: 'main' as const, prompt: `Photo ${slot}`, planMarkdown: '中文策划', negativePrompt: 'blur' })
function session(): AmazonPlannerSession {
  const facts = emptyProductFactsState(); facts.draft.productName = 'Lamp'; facts.draft.color = 'Black'
  return { id: 's', title: 'Lamp', mode: 'listing', aPlusType: 'standard-large', resolution: '2k', marketplaceId: 'us', listingText: 'A black lamp', draft: { ...DEFAULT_AMAZON_PROMPT_DRAFT, productTitle: 'Lamp' }, imagePlans: [plan('MAIN'), plan('PT01'), plan('PT02')], aPlusPlans: [], referenceImageIds: ['product', 'layout', 'other'], referenceImageUsages: { product: normalizeReferenceUsage(), layout: normalizeReferenceUsage({ purpose: 'composition', slots: ['PT01'], note: '左右布局' }), other: normalizeReferenceUsage({ slots: ['PT02'] }) }, productFacts: confirmProductFacts(facts, '', ['product']), selectedStyleReferenceImageId: 'hidden-style', seriesStyleGuides: { listing: 'Warm light', aplus: '' }, selectedStyleIndex: null, styleCandidates: [], styleImages: [], selectedPlanIndex: 0, selectedAPlusPlanIndex: null, createdAt: 1, updatedAt: 1 } as AmazonPlannerSession
}
const analysis: ReferenceAnalysisSnapshot = { id: 'observation', imageId: 'product', imageHash: 'hash', profileIdentity: 'planner', usage: normalizeReferenceUsage(), model: 'vision', createdAt: 1, analysis: normalizeReferenceAnalysis({ summary: 'AI original', visibleDetails: ['round base'] }) }
afterEach(() => vi.unstubAllGlobals())

describe('generation preflight and immutable queue requests', () => {
  it('shows exactly ordered, scoped references with hidden style last; MAIN excludes hidden style', () => {
    const source = session()
    const detail = buildPlannerGenerationSpec(source, 'PT01', profile, 8)
    expect(detail.request.inputImageIds).toEqual(['product', 'layout', 'hidden-style'])
    expect(detail.references.map((row) => row.id)).toEqual(detail.request.inputImageIds)
    expect(detail.references[1].role).toContain('构图排版'); expect(detail.excludedIds).toEqual(['other'])
    expect(detail.errors).toEqual([])
    const main = buildPlannerGenerationSpec(source, 'MAIN', profile, 8)
    expect(main.request.inputImageIds).toEqual(['product']); expect(main.request.category.styleReferenceImageId).toBeUndefined()
    expect(main.prompt).toContain('Black'); expect(main.factsVersion).toBe(1)
    expect(main.size).toBe('2048x2048'); expect(JSON.stringify(main)).not.toContain(profile.apiKey)
  })
  it('flags only affected modules after scoped analysis corrections and facts changes', () => {
    const source = session(), usages = source.referenceImageUsages!
    const scoped = { ...analysis, imageId: 'layout', usage: usages.layout }
    source.referenceAnalyses = { layout: scoped }
    const initial = initialPlannerModuleVersions(source.imagePlans, [], (slot) => plannerSourceContext(source.referenceImageIds.filter((id) => !usages[id].slots.length || usages[id].slots.includes(slot)), usages, source.referenceAnalyses!, source.productFacts!.versions[0]))
    source.moduleVersions = initial.versions; source.selectedModuleVersions = initial.selected
    expect(buildPlannerGenerationSpec(source, 'PT01', profile, 8).stale).toBe(false)
    source.referenceAnalyses.layout = reviseReferenceAnalysis(scoped, normalizeReferenceAnalysis({ summary: 'Corrected layout' }), 'fix')
    expect(buildPlannerGenerationSpec(source, 'PT01', profile, 8).stale).toBe(true)
    expect(buildPlannerGenerationSpec(source, 'PT02', profile, 8).stale).toBe(false)
    expect(buildPlannerGenerationSpec(source, 'MAIN', profile, 8).stale).toBe(false)
    source.productFacts!.draft.color = 'White'; source.productFacts = confirmProductFacts(source.productFacts!, '', [])
    expect(buildPlannerGenerationSpec(source, 'PT02', profile, 8).stale).toBe(true)
  })
  it('blocks missing required style or reference limits and captures queue copies without credentials', () => {
    const source = session()
    expect(buildPlannerGenerationSpec(source, 'PT01', profile, 2).errors.join()).toContain('超过')
    expect(buildPlannerGenerationSpec({ ...source, selectedStyleReferenceImageId: null }, 'PT01', profile, 8).errors.join()).toContain('风格')
    const request = buildPlannerGenerationSpec(source, 'PT01', profile, 8).request
    const items = createGenerationQueueItems([request, request], 'Lamp')
    expect(items).toHaveLength(1); expect(createGenerationQueueItems([request], 'Lamp', items)).toEqual([])
    request.inputImageIds.push('later'); expect(items[0].request.inputImageIds).not.toContain('later')
    expect(generationProfileIdentity({ ...profile, apiKey: 'rotated' })).toBe(generationProfileIdentity(profile))
    expect(generationProfileIdentity({ ...profile, model: 'other' })).not.toBe(generationProfileIdentity(profile))
  })
  it('recovers completed task links but never automatically resubmits unknown in-flight work', () => {
    const row = createGenerationQueueItems([buildPlannerGenerationSpec(session(), 'MAIN', profile, 8).request], 'Lamp')[0]
    row.status = 'running'
    expect(restoreGenerationQueue([row], [])[0].status).toBe('interrupted')
    const task = { id: 'task', status: 'done', generationQueueRef: queueSubmissionRef(row) } as TaskRecord
    expect(restoreGenerationQueue([row], [task])[0]).toMatchObject({ status: 'done', taskId: 'task' })
    expect(restoreGenerationQueue([{ ...row, status: 'queued' }], [task])[0].status).toBe('queued')
    for (const native of [
      { ...task, status: 'running' as const, customTaskId: 'native-custom', customRecoverable: false },
      { ...task, status: 'error' as const, customTaskId: 'native-custom', customRecoverable: true },
      { ...task, status: 'running' as const, falRequestId: 'native-fal', falEndpoint: 'fal-ai/model', falRecoverable: false },
      { ...task, status: 'error' as const, falRequestId: 'native-fal', falEndpoint: 'fal-ai/model', falRecoverable: true },
    ]) {
      expect(restoreGenerationQueue([row], [native])[0].status).toBe('running')
      expect(restoreGenerationQueue([row], [{ ...native, status: 'error', cancelledAt: 1 }])[0].status).toBe('error')
    }
  })
})

describe('manual reference analysis and library reuse', () => {
  it('retains AI original, revision history and effective input without poisoning the automatic cache', async () => {
    const revised = reviseReferenceAnalysis(analysis, normalizeReferenceAnalysis({ summary: 'Manual correction' }), 'confirmed by photo')
    expect(analysis.revisions).toBeUndefined(); expect(revised.analysis.summary).toBe('AI original')
    expect(effectiveReferenceAnalysis(revised).summary).toBe('Manual correction')
    const rows = new Map<string, any>()
    const cache = createReferenceAnalysisCache({ getAll: async () => [...rows.values()], put: async (row) => { rows.set(row.id, row) }, remove: async (id) => { rows.delete(id) }, clear: async () => rows.clear() }, () => 10)
    await cache.put(revised)
    expect((await cache.get(revised.id))?.selectedRevisionId).toBeUndefined()
    expect((await cache.get(revised.id))?.analysis.summary).toBe('AI original')
    const refreshed = refreshReferenceAnalysis(revised, { ...analysis, createdAt: 20, analysis: normalizeReferenceAnalysis({ summary: 'New AI' }) })
    expect(refreshed.revisions).toHaveLength(2); expect(refreshed.selectedRevisionId).toBeUndefined()
    expect(effectiveReferenceAnalysis({ ...refreshed, selectedRevisionId: revised.selectedRevisionId }).summary).toBe('Manual correction')
  })
  it('preserves legacy fingerprints without spuriously invalidating unchanged saved plans', () => {
    const ids = ['product'], usages = { product: normalizeReferenceUsage() }
    const expected = contextFingerprint([['product', JSON.stringify(usages.product), [analysis.id, analysis.createdAt, analysis.analysis]]])
    expect(plannerSourceContext(ids, usages, { product: analysis }).referenceFingerprint).toBe(expected)
  })
  it('merges tags/analysis revisions and pins all library and queued input images for cleanup', () => {
    const first = referenceLibraryEntry({ imageId: 'product', title: '实拍', tags: '灯具, 主体，灯具', usage: normalizeReferenceUsage(), analyses: [analysis] })
    const revised = reviseReferenceAnalysis(analysis, normalizeReferenceAnalysis({ summary: 'corrected' }), '')
    const saved = referenceLibraryEntry({ imageId: 'product', title: '实拍 2', tags: '灯具', usage: normalizeReferenceUsage(), analyses: [revised] }, first)
    expect(first.tags).toEqual(['灯具', '主体']); expect(saved.id).toBe(first.id)
    expect(saved.analyses).toHaveLength(1); expect(effectiveReferenceAnalysis(saved.analyses[0]).summary).toBe('corrected')
    const queued = createGenerationQueueItems([buildPlannerGenerationSpec(session(), 'PT01', profile, 8).request], 'Lamp')
    expect([...collectWorkflowImageIds([saved], queued)].sort()).toEqual(['hidden-style', 'layout', 'product'])
  })
})

describe('delivery geometry and A+ target selection', () => {
  it('fits without stretching or implicit enlargement and pads to an exact canvas', () => {
    const source = { width: 400, height: 200 }, target = { width: 1000, height: 1000 }
    expect(deliveryLayout(source, target, 'fit', false)).toMatchObject({ width: 400, height: 200 })
    expect(deliveryLayout(source, target, 'fit', true)).toMatchObject({ width: 1000, height: 500 })
    expect(deliveryLayout(source, target, 'pad', false)).toMatchObject({ width: 1000, height: 1000, destination: { x: 300, y: 400, width: 400, height: 200 } })
  })
  it('crops the correct region and respects focal position and no-upscale output', () => {
    const crop = deliveryLayout({ width: 1000, height: 500 }, { width: 300, height: 300 }, 'crop', false, { x: 1, y: 0 })
    expect(crop.source).toEqual({ x: 500, y: 0, width: 500, height: 500 }); expect(crop).toMatchObject({ width: 300, height: 300 })
    expect(deliveryLayout({ width: 100, height: 50 }, { width: 300, height: 300 }, 'crop', false)).toMatchObject({ width: 50, height: 50 })
  })
  it('uses saved A+ upload size and rejects excessive custom dimensions', () => {
    const item = { id: 'i', imageId: 'img', label: 'A+', slot: 'A+L01', params: { ...DEFAULT_PARAMS, size: '2048x1536' }, referenceImageIds: [], prompt: 'photo' }
    const source = { ...session(), mode: 'aplus' as const, aPlusPlans: [{ ...plan('A+L01'), moduleType: 'header-banner', uploadSize: '970x300', generationSize: '3072x1024', textTitle: 'Title', textBody: 'Body' }] } as AmazonPlannerSession
    const version = appendMaterialCollectionVersion({ title: 'Set', items: [item], plannerSession: source }).versions[0]
    expect(deliveryTarget(item, version, DEFAULT_DELIVERY_OPTIONS)).toEqual({ width: 970, height: 300 })
    expect(() => deliveryTarget(item, version, { ...DEFAULT_DELIVERY_OPTIONS, target: 'custom', width: 8192, height: 8192 })).toThrow('3200')
  })
})

describe('single-module creative directions transport', () => {
  const response = (directions: unknown[], chat = true) => new Response(JSON.stringify(chat ? { choices: [{ message: { content: JSON.stringify({ directions }) } }] } : { output_text: JSON.stringify({ directions }) }), { headers: { 'Content-Type': 'application/json' } })
  const direction = (i: number) => ({ title: `方向 ${i}`, summary: `方案 ${i}`, plan: plan('PT01') })
  it('plans only one slot with actual images and confirmed facts, using Chat or Responses', async () => {
    for (const apiMode of ['chat', 'responses'] as const) {
      const fetchMock = vi.fn(async () => response([direction(1), direction(2)], apiMode === 'chat')); vi.stubGlobal('fetch', fetchMock)
      const result = await planCreativeDirections({ session: { ...session(), styleDensityMode: 'minimal' }, slot: 'PT01', count: 2, instruction: '桌面细节', profile: { ...planner, apiMode }, images: ['data:image/png;base64,YQ=='], referenceDescriptions: ['Product reference'] })
      expect(result).toHaveLength(2); expect(result[0].plan.slot).toBe('PT01')
      const body = JSON.parse(String((fetchMock.mock.calls[0] as any)[1].body))
      expect(JSON.stringify(body)).toContain('Black'); expect(JSON.stringify(body)).toContain('data:image/png')
      expect(JSON.stringify(body)).toContain('Information density: minimal')
      if (apiMode === 'responses') expect(body.text.format.schema.properties.directions.minItems).toBe(2)
    }
  })
  it('rejects wrong slot/count and never overwrites the source plan', async () => {
    const source = session(), before = JSON.stringify(source)
    for (const value of [[direction(1)], [direction(1), { ...direction(2), plan: plan('PT02') }]]) {
      vi.stubGlobal('fetch', vi.fn(async () => response(value)))
      await expect(planCreativeDirections({ session: source, slot: 'PT01', count: 2, instruction: '', profile: planner, images: [], referenceDescriptions: [] })).rejects.toThrow()
    }
    expect(JSON.stringify(source)).toBe(before)
  })
})
