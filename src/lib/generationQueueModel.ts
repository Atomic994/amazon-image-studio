import type { GenerationQueueItem, GenerationQueueRequest, TaskRecord } from '../types'
import { localId } from './localId'

export const queueSubmissionRef = (item: GenerationQueueItem) => `${item.id}:${item.attempt}`
export function sortGenerationQueue(items: GenerationQueueItem[]): GenerationQueueItem[] {
  return [...items].sort((a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt) || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
}
export function createGenerationQueueItems(requests: GenerationQueueRequest[], title: string, current: GenerationQueueItem[] = []): GenerationQueueItem[] {
  const batchId = localId('generation-batch'), at = Date.now()
  const baseOrder = current.reduce((max, row) => Math.max(max, row.order ?? row.createdAt), 0)
  const pending = new Set(current.filter((item) => item.status === 'queued' || item.status === 'running').map((item) => JSON.stringify(item.request)))
  return requests.flatMap((request, index) => {
    const identity = JSON.stringify(request)
    if (pending.has(identity)) return []
    pending.add(identity)
    return [{ id: localId('generation-queue'), batchId, title, slot: request.category.amazonSlot || '', order: baseOrder + index + 1, status: 'queued' as const, request: JSON.parse(JSON.stringify(request)), attempt: 1, taskIds: [], createdAt: at, updatedAt: at }]
  })
}
export function restoreGenerationQueue(items: GenerationQueueItem[], tasks: TaskRecord[]): GenerationQueueItem[] {
  return sortGenerationQueue(items).map((item) => {
    if (item.status !== 'running') return item
    const task = tasks.find((task) => task.id === item.taskId || task.generationQueueRef === queueSubmissionRef(item))
    if (task?.status === 'done') return { ...item, taskId: task.id, status: 'done', error: undefined }
    if (task && !task.cancelledAt && ((task.falRequestId && task.falEndpoint && (task.status === 'running' || task.falRecoverable)) || (task.customTaskId && (task.status === 'running' || task.customRecoverable)))) return { ...item, taskId: task.id, status: 'running', error: undefined }
    if (task?.status === 'error') return { ...item, taskId: task.id, status: 'error', error: task.error || '生成失败' }
    return { ...item, status: 'interrupted', error: '页面关闭或刷新前的执行状态未知，请检查生成记录后手动重试' }
  })
}
