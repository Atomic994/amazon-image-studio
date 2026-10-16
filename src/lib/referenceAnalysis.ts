import type { ApiProfile, InputImage, PlannerSourceContext, ProductFactsVersion, ReferenceAnalysis, ReferenceAnalysisCacheEntry, ReferenceAnalysisSnapshot, ReferenceImageUsage } from '../types'
import { hashDataUrl, referenceAnalysisCacheDb } from './db'
import { cleanList, cleanText, contextFingerprint } from './productFacts'
import { describeReferenceUsage, normalizeReferenceUsage } from './referenceImageUsage'

export const REFERENCE_ANALYSIS_TTL = 30 * 24 * 60 * 60 * 1000
const PROMPT_VERSION = 1
export const ANALYSIS_LIST_FIELDS = [['visibleDetails', '可见细节'], ['layout', '构图与布局'], ['lightingAndColors', '光线与配色'], ['mustPreserve', '应保留'], ['mustNotCopy', '不可照搬'], ['uncertainties', '无法确认']] as const
export function normalizeReferenceAnalysis(value: unknown): ReferenceAnalysis {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return { summary: cleanText(raw.summary), ...Object.fromEntries(ANALYSIS_LIST_FIELDS.map(([key]) => [key, cleanList(raw[key])])) } as unknown as ReferenceAnalysis
}
export function referenceProfileIdentity(profile: ApiProfile): string {
  // Deliberately excludes credentials and profile display names.
  return contextFingerprint([PROMPT_VERSION, profile.provider, profile.baseUrl.trim().replace(/\/+$/, ''), profile.apiMode, profile.model.trim()])
}
function usageIdentity(usage?: ReferenceImageUsage): string {
  const normalized = normalizeReferenceUsage(usage)
  return JSON.stringify({ ...normalized, slots: [...normalized.slots].sort() })
}
export async function referenceAnalysisIdentity(image: InputImage, usage: ReferenceImageUsage | undefined, profile: ApiProfile) {
  const imageHash = await hashDataUrl(image.dataUrl)
  const profileIdentity = referenceProfileIdentity(profile)
  return { imageHash, profileIdentity, id: await hashDataUrl(JSON.stringify([PROMPT_VERSION, imageHash, usageIdentity(usage), profileIdentity])) }
}
interface CacheAdapter {
  getAll: () => Promise<ReferenceAnalysisCacheEntry[]>
  put: (entry: ReferenceAnalysisCacheEntry) => Promise<unknown>
  remove: (id: string) => Promise<unknown>
  clear: () => Promise<unknown>
}
export function createReferenceAnalysisCache(db: CacheAdapter, now = Date.now) {
  const prune = async () => {
    const entries = await db.getAll()
    const valid = entries.filter((entry) => Number.isFinite(entry.lastUsedAt) && entry.lastUsedAt <= now() && now() - entry.lastUsedAt < REFERENCE_ANALYSIS_TTL && typeof entry.analysis?.summary === 'string' && !!entry.analysis.summary.trim())
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt).slice(0, 200)
    const ids = new Set(valid.map((entry) => entry.id))
    await Promise.all(entries.filter((entry) => !ids.has(entry.id)).map((entry) => db.remove(entry.id)))
    return valid
  }
  return {
    prune,
    clear: db.clear,
    async get(id: string, touch = true): Promise<ReferenceAnalysisSnapshot | undefined> {
      const entry = (await prune()).find((row) => row.id === id)
      if (!entry) return
      if (touch) await db.put({ ...entry, lastUsedAt: now() })
      const { lastUsedAt: _, ...snapshot } = entry
      return { ...snapshot, usage: normalizeReferenceUsage(snapshot.usage), analysis: normalizeReferenceAnalysis(snapshot.analysis) }
    },
    async put(snapshot: ReferenceAnalysisSnapshot) {
      if (!snapshot.analysis.summary.trim()) throw new Error('参考图分析为空，未写入缓存')
      await db.put({ ...JSON.parse(JSON.stringify(snapshot)), lastUsedAt: now() })
      await prune()
    },
  }
}
export const referenceAnalysisCache = createReferenceAnalysisCache(referenceAnalysisCacheDb)

/** Check bytes, roles, scope, notes and current planner model before any analysis reuse. */
export async function resolveReferenceAnalyses(images: InputImage[], usages: Record<string, ReferenceImageUsage>, saved: Record<string, ReferenceAnalysisSnapshot>, profile: ApiProfile, touch = true): Promise<Record<string, ReferenceAnalysisSnapshot>> {
  const entries = await Promise.all(images.map(async (image) => {
    const identity = await referenceAnalysisIdentity(image, usages[image.id], profile)
    let snapshot = saved[image.id]?.id === identity.id ? saved[image.id] : undefined
    if (!snapshot) { try { snapshot = await referenceAnalysisCache.get(identity.id, touch) } catch { /* A disposable cache must not block planning with originals. */ } }
    if (!snapshot) return null
    // Saved session snapshots remain available even if the disposable cache expired.
    if (touch && saved[image.id]?.id === identity.id) { try { await referenceAnalysisCache.put(snapshot) } catch { /* The session snapshot remains the durable source. */ } }
    return [image.id, { ...snapshot, imageId: image.id, usage: normalizeReferenceUsage(snapshot.usage), analysis: normalizeReferenceAnalysis(snapshot.analysis) }] as const
  }))
  return Object.fromEntries(entries.filter((entry) => entry !== null))
}
export function analysisMatchesInputs(snapshot: ReferenceAnalysisSnapshot, imageId: string, usage?: ReferenceImageUsage, profile?: ApiProfile): boolean {
  return snapshot.imageId === imageId && usageIdentity(snapshot.usage) === usageIdentity(usage) && (!profile || snapshot.profileIdentity === referenceProfileIdentity(profile))
}
export function referenceAnalysisDescription(usage?: ReferenceImageUsage, analysis?: ReferenceAnalysisSnapshot): string {
  return [describeReferenceUsage(usage), analysis ? `Previously observed visual context (fallible observations; not verified product claims): ${JSON.stringify(normalizeReferenceAnalysis(analysis.analysis))}. Confirmed product facts take precedence.` : ''].filter(Boolean).join('\n')
}
export function buildReferenceAnalysisContract(ids: string[], usages: Record<string, ReferenceImageUsage>, snapshots: ReferenceAnalysisSnapshot[] = []): string {
  const entries = ids.flatMap((id, index) => {
    const snapshot = snapshots.find((row) => analysisMatchesInputs(row, id, usages[id]))
    return snapshot ? [`Reference ${index + 1}: ${referenceAnalysisDescription(usages[id], snapshot)}`] : []
  })
  return entries.length ? ['REFERENCE ANALYSIS CONTEXT (original images are also attached; never render this block as image text):', ...entries].join('\n') : ''
}
export function plannerSourceContext(ids: string[], usages: Record<string, ReferenceImageUsage>, analyses: Record<string, ReferenceAnalysisSnapshot>, facts?: ProductFactsVersion): PlannerSourceContext {
  const snapshots = ids.flatMap((id) => analyses[id] && analysisMatchesInputs(analyses[id], id, usages[id]) ? [analyses[id]] : [])
  return { productFactsVersionId: facts?.id, referenceFingerprint: contextFingerprint(ids.map((id) => { const snapshot = snapshots.find((row) => row.imageId === id); return [id, usageIdentity(usages[id]), snapshot ? [snapshot.id, snapshot.createdAt, snapshot.analysis] : null] })), referenceImageIds: [...ids], referenceAnalyses: JSON.parse(JSON.stringify(snapshots)) }
}
export function isPlannerContextStale(previous: PlannerSourceContext | undefined, current: PlannerSourceContext): boolean {
  return previous ? previous.productFactsVersionId !== current.productFactsVersionId || previous.referenceFingerprint !== current.referenceFingerprint : !!current.productFactsVersionId || !!current.referenceAnalyses.length
}
