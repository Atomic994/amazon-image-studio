import type { AmazonPlannerSession, MaterialCollection, MaterialCollectionDraft, MaterialCollectionItem, TaskRecord } from '../types'
import { collectPlannerImageReferences } from './plannerImageReferences'
import { localId } from './localId'

export function materialItemFromTask(task: TaskRecord, imageId: string): MaterialCollectionItem {
  return {
    id: localId('material-item'), imageId, slot: task.category?.amazonSlot || '', label: task.category?.amazonSlot || task.category?.productTitle || '生成图片',
    prompt: task.prompt, params: { ...task.params }, referenceImageIds: [...task.inputImageIds],
    referenceImageUsages: task.referenceImageUsages ? JSON.parse(JSON.stringify(task.referenceImageUsages)) : undefined,
    category: task.category ? { ...task.category } : undefined,
    productFactsSnapshot: task.productFactsSnapshot ? JSON.parse(JSON.stringify(task.productFactsSnapshot)) : undefined,
    referenceAnalysisSnapshots: task.referenceAnalysisSnapshots ? JSON.parse(JSON.stringify(task.referenceAnalysisSnapshots)) : undefined,
    localEditProtection: task.localEditProtection ? { ...task.localEditProtection } : undefined,
  }
}
export function collectMaterialImageIds(collections: MaterialCollection[]): Set<string> {
  const ids = new Set<string>()
  for (const collection of collections) for (const version of collection.versions) {
    for (const item of version.items) {
      ids.add(item.imageId); for (const id of item.referenceImageIds) ids.add(id)
      for (const id of item.productFactsSnapshot?.sourceImageIds ?? []) ids.add(id)
      for (const snapshot of item.referenceAnalysisSnapshots ?? []) ids.add(snapshot.imageId)
      if (item.localEditProtection) { ids.add(item.localEditProtection.baseImageId); ids.add(item.localEditProtection.maskImageId) }
    }
    if (version.plannerSession) for (const id of collectPlannerImageReferences([version.plannerSession], { customStyleReferences: [], amazonUploadedStyleReferences: [] })) ids.add(id)
  }
  return ids
}
export function appendMaterialCollectionVersion(draft: MaterialCollectionDraft, existing?: MaterialCollection, note = ''): MaterialCollection {
  if (!draft.items.length && !draft.plannerSession) throw new Error('请先选择生成图片或保存一份策划')
  const at = Date.now()
  const plannerSession = draft.plannerSession ?? existing?.versions[existing.versions.length - 1]?.plannerSession
  const finalSet = draft.finalSet ? { ...draft.finalSet, missingSlots: [...new Set([...draft.finalSet.missingSlots, ...draft.finalSet.expectedSlots.filter((slot) => !draft.items.some((item) => (item.slot || `image:${item.imageId}`) === slot))])] } : undefined
  const version = JSON.parse(JSON.stringify({ id: localId('collection-version'), versionNumber: Math.max(0, ...(existing?.versions.map((item) => item.versionNumber) ?? [])) + 1, createdAt: at, note: note.trim(), items: draft.items, plannerSession, finalSet }))
  return { id: existing?.id ?? localId('collection'), title: draft.title.trim() || existing?.title || '未命名素材套组', description: existing?.description ?? '', versions: [...(existing?.versions ?? []), version], createdAt: existing?.createdAt ?? at, updatedAt: at }
}

export function materialCollectionCandidates(draft: MaterialCollectionDraft, existing?: MaterialCollection): MaterialCollectionItem[] {
  const seen = new Set<string>()
  const previous = draft.finalSet ? [] : existing?.versions[existing.versions.length - 1]?.items ?? []
  return [...draft.items, ...previous].filter((item) => {
    const key = `${item.slot}:${item.imageId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
export function plannerCollectionCandidates(tasks: TaskRecord[], session: AmazonPlannerSession): MaterialCollectionItem[] {
  const workflow = session.mode === 'aplus' ? 'amazon-aplus' : 'amazon-listing'
  const candidates = tasks.filter((task) => task.status === 'done' && task.outputImages.length && (task.category?.workflow === workflow || (task.category?.workflow === 'seedream-edit' && task.category.plannerSessionId === session.id))
    && (task.category.plannerSessionId ? task.category.plannerSessionId === session.id : task.category.productTitle?.trim() === session.draft.productTitle.trim()))
  return candidates.sort((a, b) => b.createdAt - a.createdAt).flatMap((task) => task.outputImages.map((id) => materialItemFromTask(task, id)))
}
