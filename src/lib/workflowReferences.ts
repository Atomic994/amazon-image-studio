import type { GenerationQueueItem, ReferenceLibraryItem } from '../types'

export function collectWorkflowImageIds(library: ReferenceLibraryItem[], queue: GenerationQueueItem[]): Set<string> {
  const ids = new Set<string>()
  for (const item of library) {
    ids.add(item.imageId)
    for (const analysis of item.analyses ?? []) ids.add(analysis.imageId)
  }
  for (const item of queue) {
    for (const id of item.request.inputImageIds) ids.add(id)
    for (const id of item.request.productFactsSnapshot?.sourceImageIds ?? []) ids.add(id)
    for (const analysis of item.request.referenceAnalysisSnapshots ?? []) ids.add(analysis.imageId)
  }
  return ids
}
