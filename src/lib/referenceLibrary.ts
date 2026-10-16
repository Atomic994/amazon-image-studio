import type { ReferenceAnalysisSnapshot, ReferenceImageUsage, ReferenceLibraryItem } from '../types'
import { localId } from './localId'
import { normalizeReferenceUsage } from './referenceImageUsage'

export function referenceLibraryEntry(input: { imageId: string; title: string; tags: string; usage: ReferenceImageUsage; analyses?: ReferenceAnalysisSnapshot[] }, existing?: ReferenceLibraryItem): ReferenceLibraryItem {
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
    createdAt: existing?.createdAt ?? Date.now(), updatedAt: Date.now() }))
}
