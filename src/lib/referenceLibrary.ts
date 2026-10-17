import type { ReferenceAnalysisSnapshot, ReferenceImageUsage, ReferenceLibraryItem, ReferenceLibrarySeed, TaskRecord } from '../types'
import { localId } from './localId'
import { normalizeReferenceUsage } from './referenceImageUsage'

export function referenceLibraryEntry(input: { imageId: string; title: string; tags: string; usage: ReferenceImageUsage; analyses?: ReferenceAnalysisSnapshot[]; origin?: ReferenceLibraryItem['origin'] }, existing?: ReferenceLibraryItem): ReferenceLibraryItem {
  if (!input.title.trim()) throw new Error('请填写参考图名称')
  const analyses = [...(existing?.analyses ?? [])]
  for (const snapshot of input.analyses ?? []) {
    if (snapshot.imageId !== input.imageId) continue
    const index = analyses.findIndex((item) => item.id === snapshot.id)
    if (index < 0) analyses.push(snapshot)
    else if (snapshot.createdAt >= analyses[index].createdAt) analyses[index] = snapshot
  }
  return JSON.parse(JSON.stringify({ id: existing?.id ?? localId('reference-library'), imageId: input.imageId, title: input.title.trim().slice(0, 100),
    tags: [...new Set(input.tags.split(/[,，\n]/).map((tag) => tag.trim().slice(0, 30)).filter(Boolean))].slice(0, 20), usage: normalizeReferenceUsage(input.usage), analyses,
    origin: input.origin?.kind === 'generated' ? { kind: 'generated', taskId: input.origin.taskId, plannerSessionId: input.origin.plannerSessionId, slot: input.origin.slot } : existing?.origin,
    createdAt: existing?.createdAt ?? Date.now(), updatedAt: Date.now() }))
}

export function referenceSeedFromOutput(imageId: string, task?: TaskRecord): ReferenceLibrarySeed {
  return { imageId, usage: normalizeReferenceUsage({ purpose: 'composition', note: '生成结果仅供参考构图与视觉方向，不作为商品事实依据。' }), analyses: [], origin: { kind: 'generated', taskId: task?.id, plannerSessionId: task?.category?.plannerSessionId, slot: task?.category?.amazonSlot } }
}

export function prepareLibraryReuse(items: ReferenceLibraryItem[], override?: Partial<ReferenceImageUsage>): ReferenceLibraryItem[] {
  const images = new Map<string, ReferenceLibraryItem>()
  for (const row of items) {
    const item = structuredClone(row)
    item.usage = normalizeReferenceUsage({ ...item.usage, ...override })
    const previous = images.get(item.imageId)
    if (previous && (previous.usage.purpose !== item.usage.purpose || previous.usage.note !== item.usage.note)) throw new Error('同一原图选中了不同用途或说明，请只保留一个条目，或统一此次使用的用途和说明')
    if (previous) {
      previous.usage.slots = !previous.usage.slots.length || !item.usage.slots.length ? [] : [...new Set([...previous.usage.slots, ...item.usage.slots])]
      previous.analyses = [...previous.analyses, ...item.analyses]
    } else images.set(item.imageId, item)
  }
  return [...images.values()]
}
