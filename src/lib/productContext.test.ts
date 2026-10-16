import { describe, expect, it } from 'vitest'
import type { ReferenceAnalysisCacheEntry, ReferenceAnalysisSnapshot } from '../types'
import { createDefaultAmazonPlannerProfile } from './apiProfiles'
import { appendProductFactsContract, buildProductFactsContract, confirmedProductFacts, confirmProductFacts, emptyProductFactsState, normalizeProductFacts } from './productFacts'
import { analysisMatchesInputs, buildReferenceAnalysisContract, createReferenceAnalysisCache, isPlannerContextStale, normalizeReferenceAnalysis, plannerSourceContext, REFERENCE_ANALYSIS_TTL, referenceAnalysisIdentity, resolveReferenceAnalyses } from './referenceAnalysis'
import { normalizeReferenceUsage } from './referenceImageUsage'
import { collectPlannerImageReferences } from './plannerImageReferences'
import { initialPlannerModuleVersions } from './plannerModuleVersions'

const profile = { ...createDefaultAmazonPlannerProfile(), apiMode: 'chat' as const, baseUrl: 'https://planner.example/v1', model: 'vision', apiKey: 'never-save-this-key' }
const image = { id: 'original-id', dataUrl: 'data:image/png;base64,YQ==' }
const usage = normalizeReferenceUsage({ purpose: 'product', note: 'Preserve logo', slots: ['MAIN', 'PT01'] })
async function snapshot(): Promise<ReferenceAnalysisSnapshot> {
  return { ...await referenceAnalysisIdentity(image, usage, profile), imageId: image.id, model: profile.model, usage, createdAt: 1000, analysis: normalizeReferenceAnalysis({ summary: '黑色台灯，圆形灯座', visibleDetails: ['铰链'] }) }
}
describe('confirmed product facts', () => {
  it('keeps AI or edited drafts inactive until explicit confirmation and snapshots each version', () => {
    let state = emptyProductFactsState()
    state.draft = normalizeProductFacts({ productName: '台灯', color: '黑色', immutableFeatures: ['圆形灯座'], needsConfirmation: ['材质未知'] })
    state.draftSource = 'ai'
    expect(confirmedProductFacts(state)).toBeUndefined()
    state = confirmProductFacts(state, 'source-v1', ['product-reference'])
    const first = state.versions[0]
    state.draft.color = '白色'; state.draft.immutableFeatures.push('保留 Logo')
    expect(first.facts.color).toBe('黑色'); expect(first.facts.immutableFeatures).toEqual(['圆形灯座'])
    state = confirmProductFacts(state, 'source-v2', ['new-reference'])
    expect(confirmedProductFacts(state)?.versionNumber).toBe(2)
    expect(state.versions[0].sourceImageIds).toEqual(['product-reference'])
    state.selectedVersionId = first.id
    expect(confirmedProductFacts(state)?.facts.color).toBe('黑色')
  })
  it('does not confirm only unknown data and does not duplicate constraints in a generation prompt', () => {
    const state = emptyProductFactsState()
    state.draft.needsConfirmation = ['材质']; state.draft.material = '未知'
    expect(() => confirmProductFacts(state, '', [])).toThrow('至少一项')
    state.draft.productName = 'Lamp'
    const version = confirmProductFacts(state, '', []).versions[0]
    const prompt = appendProductFactsContract('Create a photo', version)
    expect(appendProductFactsContract(prompt, version)).toBe(prompt)
    expect(buildProductFactsContract(version)).toContain('UNVERIFIED')
    expect(buildProductFactsContract(version)).not.toContain('material: 未知')
  })
})
describe('reference analysis identity and cache lifetime', () => {
  it('keys exact bytes, role, scope, note, model, endpoint and protocol; never includes API credentials', async () => {
    const base = await referenceAnalysisIdentity(image, usage, profile)
    for (const changed of [
      await referenceAnalysisIdentity({ ...image, dataUrl: image.dataUrl + 'x' }, usage, profile),
      await referenceAnalysisIdentity(image, { ...usage, purpose: 'style' }, profile),
      await referenceAnalysisIdentity(image, { ...usage, slots: ['MAIN'] }, profile),
      await referenceAnalysisIdentity(image, { ...usage, note: 'Other note' }, profile),
      await referenceAnalysisIdentity(image, usage, { ...profile, model: 'other' }),
      await referenceAnalysisIdentity(image, usage, { ...profile, baseUrl: 'https://other.example/v1' }),
      await referenceAnalysisIdentity(image, usage, { ...profile, apiMode: 'responses' }),
    ]) expect(changed.id).not.toBe(base.id)
    expect((await referenceAnalysisIdentity({ ...image, id: 'different-record-id' }, { ...usage, slots: [...usage.slots].reverse() }, { ...profile, apiKey: 'rotated', id: 'another-profile', baseUrl: profile.baseUrl + '/' })).id).toBe(base.id)
    expect(JSON.stringify(await snapshot())).not.toContain(profile.apiKey)
  })
  function fixture() {
    let time = 1000
    const rows = new Map<string, ReferenceAnalysisCacheEntry>()
    const adapter = { getAll: async () => [...rows.values()], put: async (entry: ReferenceAnalysisCacheEntry) => { rows.set(entry.id, structuredClone(entry)) }, remove: async (id: string) => { rows.delete(id) }, clear: async () => { rows.clear() } }
    return { cache: createReferenceAnalysisCache(adapter, () => time), reopen: () => createReferenceAnalysisCache(adapter, () => time), rows, advance: (ms: number) => { time += ms } }
  }
  it('persists across instances and expires exactly 30 days after last explicit use', async () => {
    const f = fixture(), item = await snapshot()
    await f.cache.put(item); f.advance(REFERENCE_ANALYSIS_TTL - 1)
    expect((await f.reopen().get(item.id))?.analysis.summary).toBe(item.analysis.summary)
    f.advance(REFERENCE_ANALYSIS_TTL - 1)
    expect(await f.cache.get(item.id, false)).toBeDefined()
    f.advance(1)
    expect(await f.cache.get(item.id)).toBeUndefined(); expect(f.rows.size).toBe(0)
  })
  it('background lookup never prolongs TTL; empty results cannot overwrite a complete cached observation', async () => {
    const f = fixture(), item = await snapshot()
    await f.cache.put(item)
    await expect(f.cache.put({ ...item, analysis: normalizeReferenceAnalysis({}) })).rejects.toThrow('为空')
    expect((await f.cache.get(item.id, false))?.analysis.summary).toBe(item.analysis.summary)
    f.advance(REFERENCE_ANALYSIS_TTL)
    expect(await f.cache.get(item.id, false)).toBeUndefined()
  })
  it('cleans malformed/future records and caps disposable entries without touching saved snapshots', async () => {
    const f = fixture(), item = await snapshot()
    f.rows.set('future', { ...item, id: 'future', lastUsedAt: 9999 })
    f.rows.set('bad', { ...item, id: 'bad', lastUsedAt: NaN })
    await f.cache.prune(); expect(f.rows.size).toBe(0)
    for (let i = 0; i < 202; i++) { f.rows.set(`entry-${i}`, { ...item, id: `entry-${i}`, lastUsedAt: 1000 }); f.advance(1) }
    await f.cache.prune(); expect(f.rows.size).toBe(200)
    expect(item.analysis.summary).toBe('黑色台灯，圆形灯座')
  })
  it('can reuse durable session snapshots after cache expiry, but not changed bytes or usage', async () => {
    const item = await snapshot()
    expect((await resolveReferenceAnalyses([image], { [image.id]: usage }, { [image.id]: item }, profile, false))[image.id]).toEqual(item)
    expect(await resolveReferenceAnalyses([{ ...image, dataUrl: 'data:image/png;base64,Yg==' }], { [image.id]: usage }, { [image.id]: item }, profile, false)).toEqual({})
    expect(await resolveReferenceAnalyses([image], { [image.id]: { ...usage, purpose: 'style' } }, { [image.id]: item }, profile, false)).toEqual({})
  })
  it('sends only observations bound to actual attachments and matching roles', async () => {
    const item = await snapshot()
    expect(buildReferenceAnalysisContract(['unrelated'], {}, [item])).toBe('')
    expect(buildReferenceAnalysisContract([image.id], { [image.id]: { ...usage, purpose: 'style' } }, [item])).toBe('')
    expect(buildReferenceAnalysisContract(['other', image.id], { [image.id]: usage }, [item])).toContain('Reference 2: Product reference')
    expect(analysisMatchesInputs(item, image.id, usage, { ...profile, model: 'other' })).toBe(false)
  })
  it('marks plans stale when facts, scoped references or refreshed observations change', async () => {
    const item = await snapshot(), usages = { [image.id]: usage }, analyses = { [image.id]: item }
    const base = plannerSourceContext([image.id], usages, analyses)
    expect(isPlannerContextStale(base, plannerSourceContext([image.id], usages, analyses))).toBe(false)
    expect(isPlannerContextStale(base, plannerSourceContext([image.id], usages, { [image.id]: { ...item, createdAt: 2000 } }))).toBe(true)
    expect(isPlannerContextStale(base, plannerSourceContext([], usages, analyses))).toBe(true)
    const state = emptyProductFactsState(); state.draft.productName = 'Lamp'
    expect(isPlannerContextStale(base, plannerSourceContext([image.id], usages, analyses, confirmProductFacts(state, '', []).versions[0]))).toBe(true)
  })
  it('pins original images from all saved fact and module context versions', () => {
    const session = { referenceImageIds: [], productFacts: { versions: [{ sourceImageIds: ['old-product'] }] }, moduleVersions: { 'listing:MAIN': [{ context: { referenceImageIds: ['old-layout'], referenceAnalyses: [{ imageId: 'analyzed-original' }] } }] } } as unknown as import('../types').AmazonPlannerSession
    expect([...collectPlannerImageReferences([session], { customStyleReferences: [], amazonUploadedStyleReferences: [] })].sort()).toEqual(['analyzed-original', 'old-layout', 'old-product'])
    const plan = { slot: 'MAIN' } as import('../types').AmazonPlannerSession['imagePlans'][number]
    const context = plannerSourceContext(['old-product'], {}, {})
    const { versions } = initialPlannerModuleVersions([plan], [], () => context)
    context.referenceImageIds.push('later')
    expect(versions['listing:MAIN'][0].context?.referenceImageIds).toEqual(['old-product'])
  })
})
