import { describe, expect, it } from 'vitest'
import type { AmazonPlannerSession, TaskRecord } from '../types'
import { DEFAULT_PARAMS } from '../types'
import { buildImageVersionHistory } from './imageVersions'
import { appendMaterialCollectionVersion, collectMaterialImageIds, materialCollectionCandidates, plannerCollectionCandidates } from './materialCollections'
import { applyPlannerModuleVersion, createPlannerModuleVersion, initialPlannerModuleVersions } from './plannerModuleVersions'
import { normalizeReferenceUsage, referenceAppliesToSlot, referenceUsageContract } from './referenceImageUsage'

const plan = (slot: string, prompt = slot) => ({ slot, label: slot, kind: 'main' as const, prompt, planMarkdown: '中文策划', negativePrompt: 'blur' })
const session = { id: 'session-a', mode: 'listing', draft: { productTitle: 'Lamp' }, referenceImageIds: ['ref'], selectedStyleReferenceImageId: 'style', styleImages: [], imagePlans: [plan('MAIN'), plan('PT01')], aPlusPlans: [], seriesStyleGuides: { listing: 'keep product', aplus: '' } } as unknown as AmazonPlannerSession
const task = (id: string, output: string, at: number, parent?: string, slot = 'MAIN', sessionId = 'session-a') => ({ id, createdAt: at, status: 'done', prompt: id, params: { ...DEFAULT_PARAMS }, inputImageIds: parent ? [parent] : ['ref'], outputImages: [output], category: { workflow: parent ? 'seedream-edit' : 'amazon-listing', plannerSessionId: sessionId, amazonSlot: slot, productTitle: 'Lamp' }, imageEditContext: parent ? { sourceImageId: parent, referenceImageIds: [], engine: 'home', userInstruction: id } : undefined }) as TaskRecord

describe('image versions and reusable material sets', () => {
  it('groups repeated generations of one slot and its edit branches, while isolating other slots and sessions', () => {
    const tasks = [task('a', 'original', 1), task('b', 'edited', 2, 'original'), task('c', 'branch', 3, 'original'), task('d', 'next', 4, 'edited'), task('e', 'regenerated', 5), task('f', 'other-slot', 6, undefined, 'PT01'), task('g', 'other-session', 7, undefined, 'MAIN', 'session-b')]
    expect(buildImageVersionHistory(tasks, 'next').map((row) => row.imageId)).toEqual(['original', 'edited', 'branch', 'next', 'regenerated'])
    expect(buildImageVersionHistory(tasks, 'regenerated')[0].imageId).toBe('original')
    expect(buildImageVersionHistory(tasks, 'other-slot')).toHaveLength(1)
    expect(buildImageVersionHistory(tasks, 'other-session')).toHaveLength(1)
  })
  it('keeps an uploaded source and safely handles corrupt cyclic history', () => {
    expect(buildImageVersionHistory([task('edit', 'result', 1, 'upload')], 'result').map((row) => row.imageId)).toEqual(['upload', 'result'])
    const cycle = [task('a', 'a', 1, 'b'), task('b', 'b', 2, 'a')]
    expect(buildImageVersionHistory(cycle, 'b').map((row) => row.imageId)).toEqual(['a', 'b'])
  })
  it('restores one plan without replacing other modules or discarding later versions', () => {
    const initial = initialPlannerModuleVersions(session.imagePlans, [])
    const v1 = initial.versions['listing:PT01'][0]
    const v2 = createPlannerModuleVersion('listing', plan('PT01', 'new detail composition'), 2, 'clearer detail')
    const revised = applyPlannerModuleVersion({ ...session, moduleVersions: initial.versions, selectedModuleVersions: initial.selected }, v2)
    expect(revised.imagePlans[0]).toEqual(session.imagePlans[0])
    expect(revised.imagePlans[1].prompt).toBe('new detail composition')
    const restored = applyPlannerModuleVersion(revised, v1)
    expect(restored.imagePlans).toEqual(session.imagePlans)
    expect(restored.moduleVersions?.['listing:PT01']).toHaveLength(2)
    expect(restored.selectedModuleVersions?.['listing:PT01']).toBe(v1.id)
    expect(session.imagePlans[1].prompt).toBe('PT01')
    expect(() => applyPlannerModuleVersion(session, createPlannerModuleVersion('listing', plan('PT09'), 2))).toThrow('不存在')
  })
  it('snapshots each collection version and retains outputs, references and styles from every version', () => {
    const items = plannerCollectionCandidates([task('a', 'output-a', 1), task('edit', 'output-b', 2, 'output-a'), task('other', 'other', 3, undefined, 'MAIN', 'session-b')], session)
    expect(items.map((item) => item.imageId)).toEqual(['output-b', 'output-a'])
    const draft = { title: 'Saved set', items: [items[1]], plannerSession: session }
    const first = appendMaterialCollectionVersion(draft)
    draft.items[0].prompt = 'changed later'
    const next = appendMaterialCollectionVersion({ ...draft, items: [items[0]] }, first, 'second version')
    expect(first.versions[0].items[0].prompt).toBe('a')
    expect(next.versions.map((version) => version.versionNumber)).toEqual([1, 2])
    expect(next.versions[1].plannerSession).toEqual(session)
    expect([...collectMaterialImageIds([next])].sort()).toEqual(['output-a', 'output-b', 'ref', 'style'])
  })
  it('offers unchanged saved images when preparing a new set version after regenerating only one slot', () => {
    const items = plannerCollectionCandidates([task('old-main', 'old-main', 1), task('old-detail', 'old-detail', 2, undefined, 'PT01')], session)
    const existing = appendMaterialCollectionVersion({ title: 'Whole set', items, plannerSession: session })
    const [newMain] = plannerCollectionCandidates([task('new-main', 'new-main', 3)], session)
    const candidates = materialCollectionCandidates({ title: 'Whole set', items: [newMain], plannerSession: session }, existing)
    expect(candidates.map((item) => item.imageId)).toEqual(['new-main', 'old-detail', 'old-main'])
    expect(materialCollectionCandidates({ title: 'Whole set', items: [], plannerSession: session }, existing)).toEqual(items)
  })
})

describe('reference purposes', () => {
  it('defaults legacy references to product facts, sanitizes scopes and routes scoped references', () => {
    expect(normalizeReferenceUsage()).toEqual({ purpose: 'product', slots: [], note: '' })
    const usage = normalizeReferenceUsage({ purpose: 'style', slots: ['PT01', 'PT01', 'garbage', 'A+L02'], note: 'lighting only' })
    expect(usage.slots).toEqual(['PT01', 'A+L02'])
    expect(referenceAppliesToSlot(usage, 'MAIN')).toBe(false)
    expect(referenceAppliesToSlot(usage, 'PT01')).toBe(true)
    expect(referenceAppliesToSlot(undefined, 'MAIN')).toBe(true)
  })
  it('describes roles using actual attachment order without treating style or layout as product facts', () => {
    const contract = referenceUsageContract(['layout', 'product', 'board'], { layout: { purpose: 'composition', slots: [], note: '' } }, 'board')
    expect(contract).toContain('Reference 1: Composition reference:')
    expect(contract).toContain('Reference 2: Product reference:')
    expect(contract).toContain('Reference 3: User-selected visual style board.')
    expect(contract).toContain('Only product references establish product facts.')
    expect(referenceUsageContract(['legacy'], {})).toBe('')
  })
})
