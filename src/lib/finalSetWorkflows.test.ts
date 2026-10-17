import { describe, expect, it } from 'vitest'
import type { AmazonPlannerSession, FinalSetSelections, MaterialCollectionItem, TaskRecord } from '../types'
import { DEFAULT_PARAMS } from '../types'
import { DEFAULT_AMAZON_PROMPT_DRAFT } from './amazonPrompt'
import { createDefaultOpenAIProfile } from './apiProfiles'
import { getAPlusModuleSpecs, getAmazonListingImageSlots } from './listingPlanner'
import { buildFinalSetRows, collectFinalSetImageIds, finalSetCollectionDraft, finalSetDeliveryCollection, finalSetScope, normalizeFinalSetSelections } from './finalSets'
import { initialPlannerModuleVersions, createPlannerModuleVersion, applyPlannerModuleVersion } from './plannerModuleVersions'
import { plannerContextForSlot } from './plannerContext'
import { plannerContextChangeReasons } from './referenceAnalysis'
import { buildPlannerGenerationSpec } from './plannerGeneration'
import { BUILTIN_PLANNER_THEMES, createPlannerThemePreset, normalizePlannerThemePreset, plannerThemeContract } from './plannerThemes'
import { prepareLibraryReuse, referenceLibraryEntry, referenceSeedFromOutput } from './referenceLibrary'
import { normalizeReferenceUsage, referenceAppliesToSlot } from './referenceImageUsage'
import { appendMaterialCollectionVersion, materialCollectionCandidates, materialItemFromTask } from './materialCollections'
import { materialAPlusPlan } from './imageDelivery'

function session(): AmazonPlannerSession {
  const s: AmazonPlannerSession = { id: 'suite', title: 'Lamp', mode: 'listing', marketplaceId: 'us', aPlusType: 'standard-large', resolution: '2k', listingImageCount: 7, listingText: 'Black lamp', draft: { ...DEFAULT_AMAZON_PROMPT_DRAFT, productTitle: 'Lamp' }, referenceImageIds: [], seriesStyleGuides: { listing: '', aplus: '' }, selectedStylePresetId: 'clean-tech', selectedStyleReferenceImageId: 'style', styleCandidates: [], styleImages: [], selectedStyleIndex: null, imagePlans: getAmazonListingImageSlots(7).map((slot) => ({ slot, label: slot, kind: 'main', prompt: 'A product photo', planMarkdown: 'Plan', negativePrompt: '' })), aPlusPlans: [], selectedPlanIndex: 0, selectedAPlusPlanIndex: null, createdAt: 1, updatedAt: 1 }
  const initial = initialPlannerModuleVersions(s.imagePlans, s.aPlusPlans, (slot) => plannerContextForSlot(s, slot))
  return { ...s, moduleVersions: initial.versions, selectedModuleVersions: initial.selected }
}
function task(s: AmazonPlannerSession, id: string, slot = 'MAIN', extra: Partial<TaskRecord> = {}): TaskRecord {
  return { id, prompt: 'Photo', params: { ...DEFAULT_PARAMS }, inputImageIds: ['product'], outputImages: [id], status: 'done', error: null, createdAt: 1, finishedAt: 2, elapsed: 1,
    category: { workflow: s.mode === 'aplus' ? 'amazon-aplus' : 'amazon-listing', plannerSessionId: s.id, amazonSlot: slot, plannerModuleVersionId: s.selectedModuleVersions?.[`${s.mode}:${slot}`] }, ...extra }
}
const options = (s: AmazonPlannerSession, tasks: TaskRecord[]) => ({ session: s, tasks, scope: finalSetScope(s), reviews: {}, finals: {}, selections: {} })

describe('reference library reuse', () => {
  const entry = (id: string, slots: string[]) => referenceLibraryEntry({ imageId: id, title: id, tags: '', usage: normalizeReferenceUsage({ purpose: 'composition', slots }) })
  it('keeps selection order, merges compatible duplicate originals and supports multiple slots', () => {
    const reused = prepareLibraryReuse([entry('b', ['PT01']), entry('a', ['PT02']), entry('b', ['PT03'])])
    expect(reused.map((row) => row.imageId)).toEqual(['b', 'a'])
    expect(reused[0].usage.slots).toEqual(['PT01', 'PT03'])
    expect(referenceAppliesToSlot(reused[0].usage, 'PT02')).toBe(false)
    expect(referenceAppliesToSlot(reused[0].usage, 'PT03')).toBe(true)
  })
  it('overrides this use only and refuses conflicting roles for one actual image', () => {
    const original = entry('a', ['PT01']), before = structuredClone(original)
    const reused = prepareLibraryReuse([original], { purpose: 'style', slots: ['PT02', 'PT03'], note: 'Lighting only' })
    expect(original).toEqual(before); expect(reused[0].usage).toEqual({ purpose: 'style', slots: ['PT02', 'PT03'], note: 'Lighting only' })
    expect(() => prepareLibraryReuse([original, { ...original, usage: normalizeReferenceUsage({ purpose: 'product' }) }])).toThrow('不同用途')
    expect(prepareLibraryReuse([original, { ...original, usage: normalizeReferenceUsage({ purpose: 'composition' }) }])[0].usage.slots).toEqual([])
  })
  it('defaults generated outputs to composition references without borrowing input analysis or facts', () => {
    const s = session(), generated = task(s, 'generated')
    const seed = referenceSeedFromOutput('generated', generated)
    expect(seed).toMatchObject({ imageId: 'generated', usage: { purpose: 'composition' }, analyses: [], origin: { kind: 'generated', plannerSessionId: s.id, slot: 'MAIN' } })
    const saved = referenceLibraryEntry({ ...seed, title: 'New layout', tags: 'lamp, layout' })
    expect(saved.origin).toEqual(seed.origin); expect(saved.analyses).toEqual([])
  })
})

describe('reusable planner theme presets', () => {
  it('whitelists creative settings and omits source product and API data', () => {
    const input = { ...BUILTIN_PLANNER_THEMES[0], title: 'My theme', apiKey: 'never-save', listingText: 'Other product', productFacts: { color: 'Red' }, referenceImageIds: ['private-photo'] }
    const preset = createPlannerThemePreset(input)
    expect(preset.id).not.toBe(input.id); expect(preset.scene).toBe(input.scene)
    expect(JSON.stringify(preset)).not.toMatch(/never-save|Other product|private-photo|productFacts/)
    expect(normalizePlannerThemePreset(null)).toBeNull()
    expect(normalizePlannerThemePreset(preset)).toEqual(preset)
  })
  it('sends scene, theme and lighting to actual detail generation while leaving MAIN clean', () => {
    const s = session(); s.themeSettings = BUILTIN_PLANNER_THEMES[1].themeSettings; s.draft.scene = 'A quiet reading room'
    const profile = createDefaultOpenAIProfile({ apiKey: 'local-test' })
    const detail = buildPlannerGenerationSpec(s, 'PT01', profile, 8), main = buildPlannerGenerationSpec(s, 'MAIN', profile, 8)
    expect(detail.prompt).toContain('USER THEME AND SCENE'); expect(detail.prompt).toContain('A quiet reading room')
    expect(main.prompt).not.toContain('USER THEME AND SCENE'); expect(main.prompt).not.toContain('A quiet reading room')
    expect(plannerThemeContract(s)).toContain('MAIN stays on clean white')
  })
  it('marks affected plans stale and treats pre-theme saved context as empty', () => {
    const s = session(), before = plannerContextForSlot(s, 'PT01'), main = plannerContextForSlot(s, 'MAIN')
    delete before.planningSettings.theme
    expect(plannerContextChangeReasons(before, plannerContextForSlot(s, 'PT01'))).toEqual([])
    s.themeSettings = BUILTIN_PLANNER_THEMES[0].themeSettings
    expect(plannerContextChangeReasons(before, plannerContextForSlot(s, 'PT01'))).toEqual(['主题预设要求已变化'])
    expect(plannerContextChangeReasons(main, plannerContextForSlot(s, 'MAIN'))).toEqual([])
  })
})

describe('final set selection and delivery', () => {
  it('isolates scoped approval and change requests when two slots use the same bitmap', () => {
    const s = session(), tasks = [task(s, 'shared', 'MAIN'), task(s, 'detail', 'PT01', { outputImages: ['shared'] })]
    const input = options(s, tasks), rows = buildFinalSetRows(input)
    const selections: FinalSetSelections = { [input.scope]: {
      MAIN: { imageId: 'shared', confirmedAt: 10, contextFingerprint: rows[0].contextFingerprint, reviewStatus: 'approved', item: { ...rows[0].selected!, reviewNote: 'MAIN checked' }, candidateReviews: { shared: { status: 'approved', note: 'MAIN checked', updatedAt: 10 } } },
      PT01: { imageId: 'shared', confirmedAt: 10, contextFingerprint: rows[1].contextFingerprint, reviewStatus: 'changes-requested', item: { ...rows[1].selected!, reviewNote: 'PT01 needs copy' }, candidateReviews: { shared: { status: 'changes-requested', note: 'PT01 needs copy', updatedAt: 10 } } },
    } }
    const result = buildFinalSetRows({ ...input, selections, reviews: { shared: { status: 'changes-requested', note: 'unrelated global note', updatedAt: 20 } } })
    expect(result[0]).toMatchObject({ status: 'approved', final: { reviewNote: 'MAIN checked' } })
    expect(result[1]).toMatchObject({ status: 'changes-requested', selected: { reviewNote: 'PT01 needs copy' } }); expect(result[1].final).toBeUndefined()
  })
  it('does not turn saved notes into approval and still expires scoped approvals after context changes', () => {
    const s = session(), input = options(s, [task(s, 'photo')]), row = buildFinalSetRows(input)[0]
    const selection: FinalSetSelections[string][string] = { imageId: 'photo', confirmedAt: 10, contextFingerprint: row.contextFingerprint, item: row.selected, reviewStatus: 'pending' }
    expect(buildFinalSetRows({ ...input, selections: { [input.scope]: { MAIN: selection } } })[0].status).toBe('pending')
    selection.reviewStatus = 'approved'
    expect(buildFinalSetRows({ ...input, selections: { [input.scope]: { MAIN: selection } } })[0].status).toBe('approved')
    s.listingText += ' changed claims'
    expect(buildFinalSetRows({ ...input, selections: { [input.scope]: { MAIN: selection } } })[0].status).toBe('needs-review')
  })
  it('normalizes scoped candidate notes for backup without discarding old-style selections', () => {
    const selection = { imageId: 'photo', confirmedAt: 1, contextFingerprint: 'context', reviewStatus: 'approved', candidateReviews: { a: { status: 'changes-requested', note: 'first', updatedAt: 2 }, b: { status: 'bad', note: 7, updatedAt: 3 } } }
    const normalized = normalizeFinalSetSelections({ 'planner:s:listing': { MAIN: selection, PT01: { imageId: 'old', confirmedAt: 1, contextFingerprint: 'old' } } })
    expect(normalized['planner:s:listing'].MAIN).toMatchObject({ reviewStatus: 'approved', candidateReviews: { a: { note: 'first', status: 'changes-requested' }, b: { note: '', status: 'pending' } } })
    expect(normalized['planner:s:listing'].PT01.reviewStatus).toBeUndefined()
  })
  it('restores scoped notes for a non-planner collection with image-based slots', () => {
    const item: MaterialCollectionItem = { id: 'material', imageId: 'standalone', slot: '', label: 'Standalone', prompt: 'Photo', params: { ...DEFAULT_PARAMS }, referenceImageIds: [] }
    const input = { tasks: [], reviews: {}, finals: {}, scope: 'collection:generic:v1', version: { id: 'v1', versionNumber: 1, createdAt: 1, note: '', items: [item] }, selections: {} }
    const row = buildFinalSetRows(input)[0]
    const selections: FinalSetSelections = { [input.scope]: { [row.slot]: { imageId: item.imageId, confirmedAt: 2, contextFingerprint: row.contextFingerprint, reviewStatus: 'pending', item, candidateReviews: { standalone: { status: 'pending', note: 'Generic collection note', updatedAt: 2 } } } } }
    expect(buildFinalSetRows({ ...input, selections })[0]).toMatchObject({ slot: 'image:standalone', status: 'pending', selected: { reviewNote: 'Generic collection note' } })
  })
  it('retains frozen final confirmations in a saved or restored set, and rechecks changed contexts', () => {
    const original = session(), item = materialItemFromTask(task(original, 'snapshot-main'), 'snapshot-main')
    const collection = appendMaterialCollectionVersion({ title: original.title, items: [item], plannerSession: original, finalSet: { scope: finalSetScope(original), expectedSlots: ['MAIN'], missingSlots: [], confirmedAt: 2 } })
    const version = collection.versions[0]
    expect(buildFinalSetRows({ ...options(original, []), version, scope: `collection:${collection.id}:${version.id}` })[0].status).toBe('approved')
    const restored = { ...original, id: 'restored', sourceCollection: { collectionId: collection.id, versionId: version.id } }
    expect(buildFinalSetRows({ ...options(restored, []), collections: [collection] })[0].status).toBe('approved')
    expect(buildFinalSetRows({ ...options(restored, [task(restored, 'later-generation')]), collections: [collection] })[0].final?.imageId).toBe('snapshot-main')
    restored.listingText += ' new claims'
    expect(buildFinalSetRows({ ...options(restored, []), collections: [collection] })[0].status).toBe('needs-review')
  })
  it('keeps separate slot associations even when an API returns identical image bytes', () => {
    const s = session(), a = task(s, 'shared-pixels', 'MAIN'), b = task(s, 'detail-task', 'PT01', { outputImages: ['shared-pixels'] })
    const rows = buildFinalSetRows(options(s, [a, b]))
    expect(rows[0].candidates[0].category?.amazonSlot).toBe('MAIN'); expect(rows[1].candidates[0].category?.amazonSlot).toBe('PT01')
    expect(rows[0].candidates[0].id).not.toBe(rows[1].candidates[0].id)
    const reviewed = buildFinalSetRows({ ...options(s, [a, b]), finals: { 'shared-pixels': 'shared-pixels' }, reviews: { 'shared-pixels': { status: 'approved', note: 'Only checked one role', updatedAt: 2 } } })
    expect(reviewed[0].status).toBe('pending'); expect(reviewed[1].status).toBe('pending')
    expect(reviewed[1].candidates[0].reviewNote).toBeUndefined()
    expect(materialCollectionCandidates({ title: 'Set', items: [materialItemFromTask(a, 'shared-pixels'), materialItemFromTask(b, 'shared-pixels')] })).toHaveLength(2)
  })
  it('reuses only the explicitly restored material version, retaining its image associations', () => {
    const original = session(), item = materialItemFromTask(task(original, 'saved-main'), 'saved-main')
    const collection = appendMaterialCollectionVersion({ title: original.title, items: [item], plannerSession: original })
    const restored = { ...original, id: 'restored-copy', sourceCollection: { collectionId: collection.id, versionId: collection.versions[0].id } }
    const row = buildFinalSetRows({ ...options(restored, []), collections: [collection] })[0]
    expect(row.candidates.map((candidate) => candidate.imageId)).toEqual(['saved-main'])
    expect(buildFinalSetRows({ ...options({ ...restored, sourceCollection: undefined }, []), collections: [collection] })[0].candidates).toEqual([])
  })
  it('does not mix old unconfirmed collection items into a final-only save and recalculates omitted slots', () => {
    const s = session(), item = materialItemFromTask(task(s, 'approved-main'), 'approved-main')
    const old = appendMaterialCollectionVersion({ title: 'Set', items: [materialItemFromTask(task(s, 'old-detail', 'PT01'), 'old-detail')] })
    const draft = { title: 'Final set', items: [item], finalSet: { scope: finalSetScope(s), expectedSlots: ['MAIN', 'PT01'], missingSlots: [], confirmedAt: 2 } }
    expect(materialCollectionCandidates(draft, old).map((candidate) => candidate.imageId)).toEqual(['approved-main'])
    expect(appendMaterialCollectionVersion(draft, old).versions[1].finalSet?.missingSlots).toEqual(['PT01'])
  })
  it('shows all expected slots and never takes results from another same-named product', () => {
    const s = session(), other = { ...s, id: 'other' }
    const rows = buildFinalSetRows(options(s, [task(s, 'ours'), task(other, 'theirs', 'PT01')]))
    expect(rows).toHaveLength(7); expect(rows[0].status).toBe('pending')
    expect(rows[1]).toMatchObject({ slot: 'PT01', status: 'missing', candidates: [] })
  })
  it('distinguishes running, failed and cancelled attempts without treating them as candidates', () => {
    const s = session(), running = task(s, 'running', 'PT01', { status: 'running', outputImages: [] }), failed = task(s, 'failed', 'PT02', { status: 'error', outputImages: [], error: 'Upstream error' })
    const rows = buildFinalSetRows(options(s, [running, failed]))
    expect(rows[1].status).toBe('running'); expect(rows[2]).toMatchObject({ status: 'error', reason: 'Upstream error', candidates: [] })
  })
  it('preserves an approved final when a new generation or edit finishes', () => {
    const s = session(), a = task(s, 'approved'), b = task(s, 'newer', 'MAIN', { createdAt: 3 }), edit = task(s, 'edited', 'MAIN', { category: { ...a.category, workflow: 'seedream-edit' }, imageEditContext: { engine: 'home', sourceImageId: 'approved', userInstruction: 'Change background', referenceImageIds: [] } })
    const row = buildFinalSetRows({ ...options(s, [a, b, edit]), reviews: { approved: { status: 'approved', note: 'Final', updatedAt: 2 } }, finals: { approved: 'approved' } })[0]
    expect(row.status).toBe('approved'); expect(row.final?.imageId).toBe('approved'); expect(row.candidates).toHaveLength(3)
  })
  it('requires an explicit decision when separate families both have approved images', () => {
    const s = session(), row = buildFinalSetRows({ ...options(s, [task(s, 'a'), task(s, 'b')]), finals: { a: 'a', b: 'b' }, reviews: { a: { status: 'approved', note: '', updatedAt: 1 }, b: { status: 'approved', note: '', updatedAt: 2 } } })[0]
    expect(row.status).toBe('pending'); expect(row.final).toBeUndefined(); expect(row.reason).toContain('多个已通过')
  })
  it('rechecks an old final after plan changes and permits deliberate reconfirmation', () => {
    let s = session(); const generated = task(s, 'photo')
    const newVersion = createPlannerModuleVersion('listing', { ...s.imagePlans[0], prompt: 'Improved plan' }, 2, '', plannerContextForSlot(s, 'MAIN'))
    s = applyPlannerModuleVersion(s, newVersion)
    const input = { ...options(s, [generated]), finals: { photo: 'photo' }, reviews: { photo: { status: 'approved' as const, note: '', updatedAt: 1 } } }
    const row = buildFinalSetRows(input)[0]
    expect(row.status).toBe('needs-review')
    const selection = { imageId: 'photo', confirmedAt: 2, contextFingerprint: row.contextFingerprint, plannerModuleVersionId: row.currentVersionId, item: materialItemFromTask(generated, 'photo') }
    const selections = { [input.scope]: { MAIN: selection } }
    expect(buildFinalSetRows({ ...input, selections })[0].status).toBe('approved')
    s.listingText += ' changed'
    expect(buildFinalSetRows({ ...input, session: s, selections })[0].status).toBe('needs-review')
    expect(buildFinalSetRows({ ...input, selections, reviews: { photo: { status: 'changes-requested', note: 'Fix', updatedAt: 3 } } })[0].status).toBe('changes-requested')
  })
  it('pins confirmed images and their provenance after source tasks are removed', () => {
    const s = session(), generated = task(s, 'saved'), row = buildFinalSetRows(options(s, [generated]))[0]
    const item: MaterialCollectionItem = { ...materialItemFromTask(generated, 'saved'), localEditProtection: { version: 1, baseImageId: 'base', maskImageId: 'mask', baseHash: 'base-hash', maskHash: 'mask-hash' } }
    const selections = { [finalSetScope(s)]: { MAIN: { imageId: 'saved', confirmedAt: 2, contextFingerprint: row.contextFingerprint, item } } }
    const restored = buildFinalSetRows({ ...options(s, []), selections, reviews: { saved: { status: 'approved', note: 'Ready', updatedAt: 2 } } })
    expect(restored[0].status).toBe('approved'); expect(collectFinalSetImageIds(selections)).toEqual(new Set(['saved', 'product', 'base', 'mask']))
    const draft = finalSetCollectionDraft('Lamp', finalSetScope(s), restored, s), delivery = finalSetDeliveryCollection(draft)
    expect(draft.items.map((value) => value.imageId)).toEqual(['saved'])
    expect(draft.finalSet?.missingSlots).toEqual(['PT01', 'PT02', 'PT03', 'PT04', 'PT05', 'PT06'])
    expect(delivery.versions[0].finalSet).toEqual(draft.finalSet)
  })
  it('builds A+ rows from module specifications and preserves the exported image’s original copy version', () => {
    const s = session(); s.mode = 'aplus'; s.aPlusModuleSpecs = { 'standard-large': getAPlusModuleSpecs('standard-large').slice(0, 2) }
    s.aPlusPlans = s.aPlusModuleSpecs['standard-large']!.map((spec) => ({ slot: spec.slot, label: spec.label, moduleType: spec.moduleType, planMarkdown: 'A+', prompt: 'Photo', negativePrompt: '', uploadSize: '1464x600', generationSize: '2048x832', textTitle: 'Original title', textBody: 'Original copy' }))
    const initial = initialPlannerModuleVersions([], s.aPlusPlans, (slot) => plannerContextForSlot(s, slot)); s.moduleVersions = initial.versions; s.selectedModuleVersions = initial.selected
    const generated = task(s, 'aplus-original', s.aPlusPlans[0].slot)
    const newer = createPlannerModuleVersion('aplus', { ...s.aPlusPlans[0], textTitle: 'New title' }, 2, '', plannerContextForSlot(s, s.aPlusPlans[0].slot))
    const updated = applyPlannerModuleVersion(s, newer), item = materialItemFromTask(generated, 'aplus-original')
    expect(buildFinalSetRows(options(updated, [generated]))).toHaveLength(2)
    expect(materialAPlusPlan(item, { id: 'v', versionNumber: 1, createdAt: 0, note: '', items: [item], plannerSession: updated })?.textTitle).toBe('Original title')
  })
  it('rejects malformed or prototype-polluting imported final records', () => {
    const payload = JSON.parse('{"__proto__":{"polluted":true},"planner:s:listing":{"__proto__":{"imageId":"x","contextFingerprint":"x","confirmedAt":1},"MAIN":{"imageId":"ok","contextFingerprint":"sig","confirmedAt":1}}}')
    const normalized = normalizeFinalSetSelections(payload)
    expect(Object.keys(normalized)).toEqual(['planner:s:listing']); expect(Object.keys(normalized['planner:s:listing'])).toEqual(['MAIN'])
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined()
    expect(normalizeFinalSetSelections([])).toEqual({})
  })
})
