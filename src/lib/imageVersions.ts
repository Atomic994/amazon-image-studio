import type { ImageResultReview, TaskRecord } from '../types'

export interface ImageVersion {
  imageId: string
  parentImageId?: string
  rootImageId: string
  versionNumber: number
  createdAt: number
  task?: TaskRecord
}

export function buildImageVersionHistory(tasks: TaskRecord[], imageId: string): ImageVersion[] {
  const outputs = new Map<string, TaskRecord>()
  const parents = new Map<string, string>()
  const groups = new Map<string, string>()
  for (const task of [...tasks].sort((a, b) => a.createdAt - b.createdAt)) {
    const category = task.category
    const group = category?.plannerSessionId && category.amazonSlot && category.workflow !== 'seedream-edit'
      ? `${category.plannerSessionId}:${category.amazonSlot}` : undefined
    for (const id of task.outputImages) {
      if (outputs.has(id)) continue
      outputs.set(id, task)
      const parent = task.imageEditContext?.sourceImageId ?? (category?.workflow === 'seedream-edit' ? task.inputImageIds[0] : group ? groups.get(group) : undefined)
      if (parent && parent !== id) parents.set(id, parent)
      if (group && !groups.has(group)) groups.set(group, id)
    }
  }
  const rootOf = (id: string) => {
    const visited = new Set<string>()
    while (parents.has(id)) {
      if (visited.has(id)) return [...visited].sort()[0]
      visited.add(id); id = parents.get(id)!
    }
    return id
  }
  const rootImageId = rootOf(imageId)
  const family = [rootImageId, ...Array.from(outputs.keys()).filter((id) => id !== rootImageId && rootOf(id) === rootImageId)]
  family.sort((a, b) => a === rootImageId ? -1 : b === rootImageId ? 1 : (outputs.get(a)?.createdAt ?? 0) - (outputs.get(b)?.createdAt ?? 0) || a.localeCompare(b))
  return family.map((id, index) => ({ imageId: id, parentImageId: parents.get(id), rootImageId, versionNumber: index + 1, createdAt: outputs.get(id)?.createdAt ?? 0, task: outputs.get(id) }))
}

export function normalizeImageResultReviews(value: unknown): Record<string, ImageResultReview> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([id, item]) => id && item && typeof item === 'object').map(([id, item]) => {
    const review = item as Partial<ImageResultReview>
    return [id, { status: review.status === 'approved' || review.status === 'changes-requested' ? review.status : 'pending', note: typeof review.note === 'string' ? review.note.slice(0, 4000) : '', updatedAt: Number.isFinite(review.updatedAt) ? review.updatedAt! : 0 }]
  }))
}
