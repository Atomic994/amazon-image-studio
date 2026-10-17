import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import type { AmazonPlannerSession, CompositionProduct, ProductComposition, TaskRecord, PatchTransferSpec } from '../types'
import { DEFAULT_PARAMS } from '../types'
import { DEFAULT_AMAZON_PROMPT_DRAFT } from './amazonPrompt'
import { createDefaultOpenAIProfile } from './apiProfiles'
import { BUILTIN_PLANNER_THEMES, createPlannerThemePreset, normalizePlannerThemePreset, plannerThemeVersions } from './plannerThemes'
import { BUILTIN_CATEGORY_RULES, categorySnapshot, categoryRuleContract, categoryRuleErrors, createCategoryRule, normalizeCategoryRule } from './categoryRules'
import { normalizeProductFacts, confirmProductFacts, emptyProductFactsState } from './productFacts'
import { normalizeProductComposition, plannerReferenceIds, productCompositionContract, productCompositionErrors } from './productComposition'
import { plannerContextForSlot, plannerStyleInstructions } from './plannerContext'
import { plannerContextChangeReasons, normalizeReferenceAnalysis } from './referenceAnalysis'
import { initialPlannerModuleVersions } from './plannerModuleVersions'
import { buildPlannerGenerationSpec } from './plannerGeneration'
import { FULL_FRAME, normalizeFrame, normalizePatchTransfer, patchGeometry } from './patchTransfer'
import { materialItemFromTask, appendMaterialCollectionVersion, collectMaterialImageIds } from './materialCollections'
import { collectFinalSetImageIds } from './finalSets'
import { collectWorkflowImageIds } from './workflowReferences'
import { collectPlannerImageReferences } from './plannerImageReferences'
import { buildMaterialDeliveryZip } from './materialDelivery'

function session(): AmazonPlannerSession {
  return { id: 'advanced', title: 'Lamp', mode: 'listing', aPlusType: 'standard-large', resolution: '2k', marketplaceId: 'us', listingImageCount: 7, listingText: 'Lamp set', draft: { ...DEFAULT_AMAZON_PROMPT_DRAFT, productTitle: 'Lamp' }, referenceImageIds: ['lamp', 'book', 'style'], referenceImageUsages: { lamp: { purpose: 'product', slots: [], note: '' }, book: { purpose: 'product', slots: [], note: '' }, style: { purpose: 'style', slots: [], note: '' } }, imagePlans: ['MAIN', 'PT01', 'PT02'].map((slot) => ({ slot, label: slot, kind: 'main', prompt: 'Product photograph', planMarkdown: 'Plan', negativePrompt: '' })), aPlusPlans: [], seriesStyleGuides: { listing: '', aplus: '' }, selectedStyleReferenceImageId: 'style', styleCandidates: [], styleImages: [], selectedStyleIndex: null, selectedPlanIndex: 0, selectedAPlusPlanIndex: null, createdAt: 1, updatedAt: 1 }
}
function product(id: string, role: CompositionProduct['role'], imageId: string, patch: Partial<CompositionProduct> = {}): CompositionProduct {
  return { id, role, title: id, imageIds: [imageId], slots: [], relationship: 'included', facts: normalizeProductFacts({ color: `${id}-color` }), ...patch }
}
function composition(): ProductComposition { return { confirmedAt: 1, products: [product('Lamp', 'primary', 'lamp'), product('Book', 'secondary', 'book', { relationship: 'prop', slots: ['PT01'] })] } }
const patch: PatchTransferSpec = { sourceImageId: 'artwork', sourceFrame: FULL_FRAME, targetFrame: { x: 0.2, y: 0.2, width: 0.4, height: 0.4 }, fit: 'contain', edgePx: 24, coreInsetPx: 12 }

describe('immutable theme preset revisions', () => {
  it('keeps the original content, appends changed revisions and restores as another revision', () => {
    const first = createPlannerThemePreset({ ...BUILTIN_PLANNER_THEMES[0], title: 'My home' })
    const before = structuredClone(first)
    const second = createPlannerThemePreset({ ...first, scene: 'A different room' }, first)
    const restored = createPlannerThemePreset(plannerThemeVersions(second)[0].content, second, '恢复自 v1')
    expect(first).toEqual(before)
    expect(restored.versions?.map((row) => row.versionNumber)).toEqual([1, 2, 3])
    expect(restored.scene).toBe(first.scene); expect(restored.versions?.[1].content.scene).toBe('A different room')
    expect(restored.versions?.[2].note).toBe('恢复自 v1')
    expect(createPlannerThemePreset(restored, restored).versions).toEqual(restored.versions)
  })
  it('migrates existing presets without manufacturing missing history or storing product/API fields', () => {
    const existing = { ...BUILTIN_PLANNER_THEMES[0], id: 'legacy', createdAt: 10, updatedAt: 20, apiKey: 'secret', productFacts: { color: 'red' } }
    const normalized = normalizePlannerThemePreset(existing)!
    expect(normalized.versions).toHaveLength(1); expect(normalized.versions?.[0].createdAt).toBe(20)
    expect(JSON.stringify(normalized)).not.toMatch(/secret|productFacts/)
    expect(normalizePlannerThemePreset({ ...normalized, versions: [...normalized.versions!, { ...normalized.versions![0] }, { id: 'bad', content: null }] })?.versions).toHaveLength(1)
  })
})

describe('category rules and per-product values', () => {
  it('saves only rule definitions and freezes per-product values independently', () => {
    const preset = createCategoryRule({ ...BUILTIN_CATEGORY_RULES[0], title: 'Desk lamps' })
    const values = { field1: '3000 K', apiKey: 'secret' }
    const bound = categorySnapshot(preset, values)
    values.field1 = '5000 K'; preset.instructions.image = 'changed'
    expect(bound.values.field1).toBe('3000 K'); expect(bound.values.apiKey).toBeUndefined()
    expect(bound.preset.instructions.image).not.toBe('changed')
    const saved = createCategoryRule({ ...bound.preset, ...{ values, apiKey: 'secret' } })
    expect(JSON.stringify(saved)).not.toMatch(/3000 K|5000 K|secret/)
  })
  it('requires unique valid field keys and validates required values without inventing unknown facts', () => {
    const rule = createCategoryRule({ title: 'Specs', fields: [{ key: 'watts', label: '功率', required: true }] })
    expect(categoryRuleErrors(categorySnapshot(rule, {}))[0]).toContain('功率')
    expect(categoryRuleErrors(categorySnapshot(rule, { watts: '未确认' }))).toEqual([])
    expect(categoryRuleContract(categorySnapshot(rule, {}), 'image')).toContain('Unknown; do not infer')
    expect(() => createCategoryRule({ title: 'bad', fields: [{ key: 'same', label: 'A', required: false }, { key: 'same', label: 'B', required: false }] })).toThrow('唯一')
    expect(normalizeCategoryRule({ ...rule, fields: [{ key: '__proto__', label: 'bad' }] })).toBeNull()
  })
  it('routes stage-specific rules into planning and frozen generation and marks parameter edits stale', () => {
    const s = session(); s.categoryRule = categorySnapshot(BUILTIN_CATEGORY_RULES[0], { field1: '3000 K' })
    const before = plannerContextForSlot(s, 'PT01')
    expect(plannerStyleInstructions(s, 'PT01')).toContain(s.categoryRule.preset.instructions.listing)
    const spec = buildPlannerGenerationSpec(s, 'PT01', createDefaultOpenAIProfile(), 16)
    expect(spec.prompt).toContain(s.categoryRule.preset.instructions.image); expect(spec.prompt).toContain('3000 K')
    s.categoryRule.values.field1 = '5000 K'
    expect(spec.request.categoryRuleSnapshot?.values.field1).toBe('3000 K')
    expect(plannerContextChangeReasons(before, plannerContextForSlot(s, 'PT01'))).toContain('品类规则或事实已变化')
    s.categoryRule.preset.fields[0].required = true; s.categoryRule.values.field1 = ''
    expect(buildPlannerGenerationSpec(s, 'PT01', createDefaultOpenAIProfile(), 16).errors.join()).toContain('尚未填写')
  })
})

describe('independent product identities and slot scopes', () => {
  it('sends only in-scope products, excludes props from MAIN even if MAIN is selected, and preserves style rules', () => {
    const s = session(); s.productComposition = composition()
    s.referenceImageUsages!.book.slots = ['PT02'] // role-specific scope is authoritative
    expect(plannerReferenceIds(s, 'MAIN')).toEqual(['lamp', 'style'])
    expect(plannerReferenceIds(s, 'PT01')).toEqual(['lamp', 'book', 'style'])
    expect(plannerReferenceIds(s, 'PT02')).toEqual(['lamp', 'style'])
    s.productComposition.products[1].slots = ['MAIN']
    expect(productCompositionContract(s, ['lamp'], 'MAIN')).not.toContain('Book')
    s.productComposition.products[1].relationship = 'included'
    expect(plannerReferenceIds(s, 'MAIN')).toContain('book')
  })
  it('keeps confirmed primary facts separate from secondary facts and maps numbered actual inputs', () => {
    const s = session(); s.productComposition = composition()
    s.productFacts = confirmProductFacts({ ...emptyProductFactsState(), draft: normalizeProductFacts({ color: 'Confirmed black' }) }, 'source', ['lamp'])
    const text = productCompositionContract(s, ['book', 'lamp'], 'PT01')
    expect(text).toContain('Confirmed black'); expect(text).toContain('Book-color'); expect(text).toContain('"referenceNumbers":[2]')
    expect(text).not.toContain('Lamp-color')
  })
  it('rejects missing, duplicate, non-product references and unconfirmed compositions', () => {
    const s = session(); s.productComposition = composition()
    expect(productCompositionErrors(s)).toEqual([])
    s.referenceImageIds = ['lamp']; expect(productCompositionErrors(s).join()).toContain('已移除')
    s.productComposition.products[1].imageIds = ['lamp']; expect(productCompositionErrors(s).join()).toContain('两个商品')
    s.productComposition.products[1].imageIds = ['style']; expect(productCompositionErrors(s).join()).toContain('商品实物')
    s.productComposition.confirmedAt = 0; expect(productCompositionErrors(s).join()).toContain('先确认')
    expect(() => normalizeProductComposition({ ...composition(), products: Array.from({ length: 4 }, (_, index) => product(`p${index}`, 'secondary', `i${index}`)) })).toThrow('最多三件')
  })
  it('invalidates only affected slots and keeps original product snapshots frozen on generation', () => {
    const s = session(); s.productComposition = composition()
    const main = plannerContextForSlot(s, 'MAIN'), detail = plannerContextForSlot(s, 'PT01')
    const request = buildPlannerGenerationSpec(s, 'PT01', createDefaultOpenAIProfile(), 16).request
    s.productComposition.products[1].facts.color = 'Red'
    expect(plannerContextChangeReasons(main, plannerContextForSlot(s, 'MAIN'))).toEqual([])
    expect(plannerContextChangeReasons(detail, plannerContextForSlot(s, 'PT01'))).toContain('商品组合身份或图片位范围已变化')
    expect(request.productCompositionSnapshot?.products[1].facts.color).toBe('Book-color')
  })
  it('does not mark old pre-feature plans stale until a new rule or composition is applied', () => {
    const s = session(), old = plannerContextForSlot(s, 'PT01')
    delete old.planningSettings!.category; delete old.planningSettings!.composition
    expect(plannerContextChangeReasons(old, plannerContextForSlot(s, 'PT01'))).toEqual([])
    s.productComposition = composition(); expect(plannerContextChangeReasons(old, plannerContextForSlot(s, 'PT01')).length).toBeGreaterThan(0)
  })
  it('uses the same effective product scope for analysis provenance during planning and generation', () => {
    const s = session(); s.productComposition = composition()
    s.referenceAnalyses = { book: { id: 'old-analysis', imageId: 'book', imageHash: 'hash', profileIdentity: 'profile', model: 'planner-model', createdAt: 1, usage: s.referenceImageUsages!.book, analysis: normalizeReferenceAnalysis({ summary: 'Blue book' }) } }
    const versions = initialPlannerModuleVersions(s.imagePlans, [], (slot) => plannerContextForSlot(s, slot))
    s.moduleVersions = versions.versions; s.selectedModuleVersions = versions.selected
    const generated = buildPlannerGenerationSpec(s, 'PT01', createDefaultOpenAIProfile(), 16)
    expect(generated.staleReasons).toEqual([])
    expect(generated.request.referenceImageUsages.book.slots).toEqual(['PT01'])
    expect(generated.request.referenceAnalysisSnapshots).toEqual([])
    expect(plannerContextForSlot(session(), 'MAIN').planningSettings).not.toHaveProperty('composition')
  })
})

describe('exact source patch placement geometry', () => {
  it('accepts reverse drags and rejects invalid or empty selections', () => {
    expect(normalizeFrame({ x: 0.8, y: 0.6, width: -0.3, height: -0.2 }).x).toBe(0.5)
    expect(() => normalizeFrame({ ...FULL_FRAME, width: 0 })).toThrow('太小')
    expect(() => normalizeFrame({ ...FULL_FRAME, x: NaN })).toThrow('无效')
    expect(normalizePatchTransfer({ ...patch, compositeImageId: 'base', maskImageId: '' })).toBeUndefined()
  })
  it('preserves artwork aspect ratio by default and explicitly permits stretch', () => {
    const base = { width: 1000, height: 1000 }, art = { width: 400, height: 200 }
    const contained = patchGeometry(patch, base, art)
    expect(contained.placed).toEqual({ x: 200, y: 300, width: 400, height: 200 })
    expect(patchGeometry({ ...patch, fit: 'stretch' }, base, art).placed).toEqual({ x: 200, y: 200, width: 400, height: 400 })
    expect(contained.core).toEqual({ x: 212, y: 312, width: 376, height: 176 })
    expect(contained.fusion).toEqual({ x: 176, y: 276, width: 448, height: 248 })
  })
  it('clamps the fusion ring to canvas boundaries while always preserving an interior', () => {
    const geometry = patchGeometry({ ...patch, targetFrame: FULL_FRAME, coreInsetPx: 128 }, { width: 10, height: 10 }, { width: 100, height: 100 })
    expect(geometry.fusion).toEqual({ x: 0, y: 0, width: 10, height: 10 })
    expect(geometry.core.width).toBeGreaterThan(0); expect(geometry.core.height).toBeGreaterThan(0)
  })
})

describe('reference retention and delivery provenance', () => {
  it('retains patch source pixels and every product identity through tasks, collections, final selections and queues', async () => {
    const s = session(); s.productComposition = composition(); s.categoryRule = categorySnapshot(BUILTIN_CATEGORY_RULES[0], { field1: '3000 K' })
    const transfer = { ...patch, compositeImageId: 'composite', maskImageId: 'mask' }
    const task: TaskRecord = { id: 'edit', prompt: 'Blend edges', params: DEFAULT_PARAMS, inputImageIds: ['composite'], outputImages: ['result'], status: 'done', error: null, createdAt: 1, finishedAt: 2, elapsed: 1, productCompositionSnapshot: s.productComposition, categoryRuleSnapshot: s.categoryRule, imageEditContext: { sourceImageId: 'original', referenceImageIds: [], userInstruction: 'Blend edges', patchTransfer: transfer } }
    const item = materialItemFromTask(task, 'result'), collection = appendMaterialCollectionVersion({ title: 'Final', items: [item] })
    const ids = collectMaterialImageIds([collection]), finals = collectFinalSetImageIds({ suite: { PT01: { imageId: 'result', confirmedAt: 1, contextFingerprint: 'c', item } } })
    for (const id of ['artwork', 'mask', 'composite', 'original', 'lamp', 'book']) { expect(ids.has(id)).toBe(true); expect(finals.has(id)).toBe(true) }
    const queue = collectWorkflowImageIds([], [{ request: { inputImageIds: [], productCompositionSnapshot: s.productComposition } } as never]); expect(queue.has('book')).toBe(true)
    s.referenceImageIds = []; expect(collectPlannerImageReferences([s], { customStyleReferences: [], amazonUploadedStyleReferences: [] }).has('book')).toBe(true)
    const zip = await buildMaterialDeliveryZip(collection, collection.versions[0].id, async (id) => ({ id, dataUrl: 'data:image/png;base64,YWJj', width: 100, height: 100 }))
    const manifest = JSON.parse(strFromU8(unzipSync(zip.bytes)['manifest.json']))
    expect(manifest.images[0].categoryRule.values.field1).toBe('3000 K')
    expect(manifest.images[0].productComposition.products[1].title).toBe('Book')
    expect(manifest.images[0].imageEditContext.patchTransfer.sourceFrame).toEqual(FULL_FRAME)
  })
})
