import type { AmazonPlannerSession, FinalSetSelections, ImageResultReview, MaterialCollection, MaterialCollectionDraft, MaterialCollectionItem, MaterialCollectionVersion, TaskRecord } from '../types'
import { getAmazonListingImageSlots, getAPlusModuleSpecs, normalizeAPlusModuleSpecs } from './listingPlanner'
import { materialItemFromTask } from './materialCollections'
import { patchImageIds } from './patchTransfer'
import { plannerContextForSlot } from './plannerContext'
import { plannerContextChangeReasons } from './referenceAnalysis'
import { contextFingerprint } from './productFacts'
import { buildImageVersionHistory, normalizeImageResultReviews } from './imageVersions'
import { localId } from './localId'

export type FinalSetStatus = 'missing' | 'running' | 'error' | 'pending' | 'changes-requested' | 'needs-review' | 'approved'
export interface FinalSetRow {
  slot: string; label: string; candidates: MaterialCollectionItem[]; selected?: MaterialCollectionItem; final?: MaterialCollectionItem
  status: FinalSetStatus; reason: string; contextFingerprint: string; currentVersionId?: string; currentVersionNumber?: number
}
export const FINAL_SET_STATUS_LABELS: Record<FinalSetStatus, string> = { missing: '缺少结果', running: '正在生成', error: '生成失败', pending: '待选最终稿', 'changes-requested': '需要修改', 'needs-review': '需要复核', approved: '最终稿已确认' }
export function finalSetScope(session: AmazonPlannerSession) { return `planner:${session.id}:${session.mode}` }
export function normalizeFinalSetSelections(value: unknown): FinalSetSelections {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const output: FinalSetSelections = {}
  for (const [scope, rows] of Object.entries(value)) {
    if (!/^(planner|collection):.+/.test(scope) || scope.length > 1000 || !rows || typeof rows !== 'object' || Array.isArray(rows)) continue
    for (const [slot, raw] of Object.entries(rows)) {
      if (!/^(MAIN|PT\d{2}|A\+[LSPM]\d{2}|image:.+)$/.test(slot) || !raw || typeof raw !== 'object') continue
      const row = raw as FinalSetSelections[string][string]
      if (typeof row.imageId !== 'string' || !row.imageId || typeof row.contextFingerprint !== 'string' || !Number.isFinite(row.confirmedAt)) continue
      ;(output[scope] ??= {})[slot] = { imageId: row.imageId, contextFingerprint: row.contextFingerprint, confirmedAt: row.confirmedAt, plannerModuleVersionId: typeof row.plannerModuleVersionId === 'string' ? row.plannerModuleVersionId : undefined,
        ...(['approved', 'pending', 'changes-requested'].includes(row.reviewStatus ?? '') ? { reviewStatus: row.reviewStatus } : {}),
        ...(row.candidateReviews ? { candidateReviews: normalizeImageResultReviews(row.candidateReviews) } : {}),
        ...(row.item?.imageId === row.imageId && Array.isArray(row.item.referenceImageIds) ? { item: structuredClone(row.item) } : {}) }
    }
  }
  return output
}
export function collectFinalSetImageIds(selections: FinalSetSelections): Set<string> {
  const ids = new Set<string>()
  for (const rows of Object.values(selections)) for (const row of Object.values(rows)) {
    ids.add(row.imageId)
    const item = row.item
    if (!item) continue
    for (const id of item.referenceImageIds) ids.add(id)
    for (const product of item.productCompositionSnapshot?.products ?? []) for (const id of product.imageIds) ids.add(id)
    for (const id of patchImageIds(item.imageEditContext?.patchTransfer)) ids.add(id)
    if (item.imageEditContext) { ids.add(item.imageEditContext.sourceImageId); for (const id of item.imageEditContext.referenceImageIds) ids.add(id) }
    for (const id of item.productFactsSnapshot?.sourceImageIds ?? []) ids.add(id)
    for (const analysis of item.referenceAnalysisSnapshots ?? []) ids.add(analysis.imageId)
    if (item.localEditProtection) { ids.add(item.localEditProtection.baseImageId); ids.add(item.localEditProtection.maskImageId) }
  }
  return ids
}
export function buildFinalSetRows(options: { session?: AmazonPlannerSession; tasks: TaskRecord[]; reviews: Record<string, ImageResultReview>; finals: Record<string, string>; selections: FinalSetSelections; scope: string; version?: MaterialCollectionVersion; collections?: MaterialCollection[] }): FinalSetRow[] {
  const { session, tasks, version, scope } = options
  const frozenVersion = version ?? (session?.sourceCollection ? options.collections?.find((item) => item.id === session.sourceCollection!.collectionId)?.versions.find((item) => item.id === session.sourceCollection!.versionId) : undefined)
  const mode = session?.mode ?? 'listing'
  const belongs = (task: TaskRecord) => !!session && task.category?.plannerSessionId === session.id && (task.category.workflow === (mode === 'aplus' ? 'amazon-aplus' : 'amazon-listing') || task.category.workflow === 'seedream-edit')
  const relevant = tasks.filter(belongs)
  const items = version ? [...version.items] : relevant.filter((task) => task.status === 'done').sort((a, b) => b.createdAt - a.createdAt).flatMap((task) => task.outputImages.map((imageId) => materialItemFromTask(task, imageId)))
  if (!version) for (const collection of options.collections ?? []) for (const saved of collection.versions) {
    if (saved.plannerSession?.id === session?.id || (session?.sourceCollection?.collectionId === collection.id && session.sourceCollection.versionId === saved.id)) items.push(...saved.items.filter((item) => item.category?.workflow !== (mode === 'aplus' ? 'amazon-listing' : 'amazon-aplus')))
  }
  for (const selection of Object.values(options.selections[scope] ?? {})) if (selection.item) items.push(selection.item)
  const imagesBySlot = new Map<string, Set<string>>()
  for (const item of items) { const slots = imagesBySlot.get(item.imageId) ?? new Set<string>(); slots.add(item.slot); imagesBySlot.set(item.imageId, slots) }
  const unique = [...new Map(items.map((item) => {
    const selected = options.selections[scope]?.[item.slot || `image:${item.imageId}`]
    const shared = (imagesBySlot.get(item.imageId)?.size ?? 0) > 1
    const note = selected?.candidateReviews?.[item.imageId]?.note ?? (selected?.imageId === item.imageId ? selected.item?.reviewNote ?? (shared ? undefined : options.reviews[item.imageId]?.note) : shared ? undefined : options.reviews[item.imageId]?.note)
    return [`${item.slot}:${item.imageId}`, { ...item, id: `final:${item.slot}:${item.imageId}`, reviewNote: note ?? item.reviewNote }]
  })).values()]
  const expected = session ? mode === 'listing' ? getAmazonListingImageSlots(session.listingImageCount).map((slot) => ({ slot, label: session.imagePlans.find((plan) => plan.slot === slot)?.label ?? slot }))
    : normalizeAPlusModuleSpecs(session.aPlusType, session.aPlusModuleSpecs?.[session.aPlusType] as ReturnType<typeof getAPlusModuleSpecs> | undefined).map(({ slot, label }) => ({ slot, label }))
    : [...new Map(unique.map((item) => [item.slot || `image:${item.imageId}`, { slot: item.slot || `image:${item.imageId}`, label: item.label }])).values()]
  const globalFinals = new Set(Object.values(options.finals))
  const sourceSessionIds = new Set([session?.id])
  if (session?.sourceCollection) for (const collection of options.collections ?? []) if (collection.id === session.sourceCollection.collectionId) {
    sourceSessionIds.add(collection.versions.find((row) => row.id === session.sourceCollection!.versionId)?.plannerSession?.id)
  }
  sourceSessionIds.delete(undefined)
  const legacyApprovalMatches = (item: MaterialCollectionItem, slot: string) => {
    if ((imagesBySlot.get(item.imageId)?.size ?? 0) > 1) return false
    const review = options.reviews[item.imageId]
    const newestResult = tasks.filter((task) => task.outputImages.includes(item.imageId) && task.category?.amazonSlot === slot).reduce((at, task) => Math.max(at, task.createdAt), 0)
    if (!review || review.updatedAt < newestResult) return false
    const family = buildImageVersionHistory(tasks, item.imageId)
    return Object.entries(options.finals).some(([root, selected]) => {
      if (selected !== item.imageId) return false
      const source = family.find((row) => row.imageId === root)?.task ?? tasks.find((task) => task.imageEditContext?.sourceImageId === root && task.category?.amazonSlot === slot && sourceSessionIds.has(task.category?.plannerSessionId))
      return !!source && source.category?.amazonSlot === slot && sourceSessionIds.has(source.category.plannerSessionId)
    })
  }
  return expected.map(({ slot, label }) => {
    const candidates = unique.filter((item) => (item.slot || `image:${item.imageId}`) === slot)
    const key = `${mode}:${slot}`, currentVersionId = session?.selectedModuleVersions?.[key]
    const currentVersion = session?.moduleVersions?.[key]?.find((row) => row.id === currentVersionId)
    const context = session ? plannerContextForSlot(session, slot) : undefined
    const fingerprint = contextFingerprint({ context, currentVersionId, scope, slot })
    const explicit = options.selections[scope]?.[slot]
    const approved = candidates.filter((item) => globalFinals.has(item.imageId) && options.reviews[item.imageId]?.status === 'approved' && legacyApprovalMatches(item, slot))
    const frozenItems = frozenVersion?.finalSet?.expectedSlots.includes(slot) && !frozenVersion.finalSet.missingSlots.includes(slot) ? frozenVersion.items.filter((item) => (item.slot || `image:${item.imageId}`) === slot) : []
    const frozen = frozenItems.length === 1 ? candidates.find((item) => item.imageId === frozenItems[0].imageId) : undefined
    const chosen = explicit ? candidates.find((item) => item.imageId === explicit.imageId) : frozen ?? (approved.length === 1 ? approved[0] : undefined)
    const selected = chosen ?? candidates[0]
    const base = { slot, label, candidates, selected, contextFingerprint: fingerprint, currentVersionId, currentVersionNumber: currentVersion?.versionNumber }
    if (!candidates.length) {
      const attempts = relevant.filter((task) => task.category?.amazonSlot === slot).sort((a, b) => b.createdAt - a.createdAt)
      const status: FinalSetStatus = attempts.some((task) => task.status === 'running') ? 'running' : attempts[0]?.status === 'error' ? 'error' : 'missing'
      return { ...base, status, reason: status === 'error' ? attempts[0].error || '请检查生成记录并重试' : status === 'running' ? '结果完成后会出现在这里' : '尚无此图片位的生成结果' }
    }
    if (!chosen) return { ...base, status: selected && options.reviews[selected.imageId]?.status === 'changes-requested' ? 'changes-requested' : 'pending', reason: approved.length > 1 ? '存在多个已通过版本，请明确选定一个最终稿' : selected && options.reviews[selected.imageId]?.status === 'changes-requested' ? options.reviews[selected.imageId].note || '此图已标记为需要修改' : '选择一个版本并确认最终稿' }
    if (explicit?.reviewStatus === 'changes-requested' || (!explicit?.reviewStatus && options.reviews[chosen.imageId]?.status === 'changes-requested')) return { ...base, status: 'changes-requested', reason: explicit?.reviewStatus ? explicit.item?.reviewNote || '此图片位已标记为需要修改' : options.reviews[chosen.imageId].note || '此图已被标记为需要修改' }
    if (explicit?.reviewStatus === 'pending' && explicit.contextFingerprint === fingerprint) return { ...base, status: 'pending', reason: '已保存此图片位意见，尚未确认最终稿' }
    if (explicit && (explicit.reviewStatus === 'approved' || (!explicit.reviewStatus && options.reviews[chosen.imageId]?.status === 'approved')) && explicit.contextFingerprint === fingerprint) return { ...base, final: chosen, status: 'approved', reason: '已人工确认当前策划与参考上下文' }
    if (frozen && !explicit) {
      const oldSession = frozenVersion?.plannerSession, oldKey = `${oldSession?.mode ?? mode}:${slot}`, review = options.reviews[chosen.imageId]
      const sameContext = !session || !oldSession || (contextFingerprint(context) === contextFingerprint(plannerContextForSlot(oldSession, slot)) && currentVersionId === oldSession.selectedModuleVersions?.[oldKey])
      if (!sameContext || (review?.status === 'pending' && review.updatedAt > frozenVersion!.finalSet!.confirmedAt)) return { ...base, status: 'needs-review', reason: '保存最终稿之后，上下文或审核状态已改变，请重新确认' }
      return { ...base, final: chosen, status: 'approved', reason: '沿用此套组版本中已保存的最终稿确认' }
    }
    const changes = context ? plannerContextChangeReasons(currentVersion?.context, context) : []
    if (explicit || changes.length || (currentVersionId && chosen.category?.plannerModuleVersionId !== currentVersionId)) return { ...base, status: 'needs-review', reason: changes.length ? changes.join('；') : '策划版本或审核状态已变化，请重新确认此图片位' }
    return { ...base, final: chosen, status: 'approved', reason: '沿用此图片位已通过的唯一版本' }
  })
}
export function finalSetCollectionDraft(title: string, scope: string, rows: FinalSetRow[], session?: AmazonPlannerSession): MaterialCollectionDraft {
  const selected = rows.filter((row) => row.status === 'approved' && row.final)
  if (!selected.length) throw new Error('请先至少确认一张最终稿')
  return { title: `${title} · 最终稿`, items: selected.map((row) => structuredClone(row.final!)), plannerSession: session ? structuredClone(session) : undefined,
    finalSet: { scope, expectedSlots: rows.map((row) => row.slot), missingSlots: rows.filter((row) => row.status !== 'approved').map((row) => row.slot), confirmedAt: Date.now() } }
}
export function finalSetDeliveryCollection(draft: MaterialCollectionDraft): MaterialCollection {
  const at = Date.now()
  return { id: localId('final-delivery'), title: draft.title, description: '', versions: [{ id: 'confirmed', versionNumber: 1, createdAt: at, note: draft.finalSet?.missingSlots.length ? `仅导出已确认项，缺少：${draft.finalSet.missingSlots.join('、')}` : '整套最终稿', items: structuredClone(draft.items), plannerSession: draft.plannerSession, finalSet: draft.finalSet }], createdAt: at, updatedAt: at }
}
export function finalImageRoot(tasks: TaskRecord[], imageId: string) { return buildImageVersionHistory(tasks, imageId)[0]?.rootImageId ?? imageId }
