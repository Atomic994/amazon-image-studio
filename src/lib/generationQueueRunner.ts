import type { GenerationQueueItem, GenerationQueueRequest } from '../types'
import { generationQueueDb, getAllTasks, getImage } from './db'
import { GENERATION_QUEUE_LOCK } from './generationQueueLock'
import { createGenerationQueueItems, queueSubmissionRef, sortGenerationQueue } from './generationQueueModel'
import { generationProfileIdentity } from './plannerGeneration'
import { getHomeApiProfile, normalizeSettings } from './apiProfiles'
import { stopImageTask, submitTaskWithInput, useStore } from '../store'
import { redactPlannerLogMessage } from './plannerRunLog'

let cycling = false
let wake: (() => void) | undefined
let subscribers = 0
let ownsLock = false
const dispatching = new Set<string>()
function safeError(error: unknown) {
  let message = error instanceof Error ? error.message : String(error)
  for (const profile of useStore.getState().settings.profiles) message = redactPlannerLogMessage(message, profile.apiKey)
  return message
}
async function save(item: GenerationQueueItem) {
  if (useStore.getState().generationQueue.find((row) => row.id === item.id)?.status !== 'running') return
  await generationQueueDb.put(item)
  useStore.setState((state) => ({ generationQueue: state.generationQueue.map((row) => row.id === item.id && row.status === 'running' ? item : row) }))
}
export async function assertQueueControl() {
  if (ownsLock || !globalThis.navigator?.locks?.query) return
  const state = await navigator.locks.query()
  if (state.held?.some((lock) => lock.name === GENERATION_QUEUE_LOCK)) throw new Error('另一标签页正在执行队列，请在该页面操作')
}
export async function configureGenerationQueue(patch: { generationQueuePaused?: boolean; generationQueueConcurrency?: 1 | 2 }) {
  await assertQueueControl()
  useStore.setState({ ...patch, generationQueueMessage: '' })
}
function failStorage(error: unknown) {
  useStore.setState({ generationQueuePaused: true, generationQueueMessage: `队列已暂停：${safeError(error)}` })
}
export async function enqueueGenerationRequests(requests: GenerationQueueRequest[], title: string) {
  await assertQueueControl()
  const state = useStore.getState()
  if (!state.generationQueueReady) throw new Error('本地数据正在载入，请稍后再加入队列')
  const items = createGenerationQueueItems(requests, title, state.generationQueue)
  for (const item of items) for (const id of item.request.inputImageIds) if (!await getImage(id)) throw new Error(`${item.slot} 有参考原图缺失，请重新选择`)
  await generationQueueDb.putMany(items)
  useStore.setState((current) => ({ generationQueue: [...current.generationQueue, ...items], generationQueuePaused: current.generationQueue.some((row) => row.status === 'queued' || row.status === 'running') ? current.generationQueuePaused : false, generationQueueOpen: true, generationQueueMessage: '' }))
  return items.length
}
export async function cancelQueueItem(id: string) {
  await assertQueueControl()
  const item = useStore.getState().generationQueue.find((row) => row.id === id)
  if (!item || !['queued', 'running'].includes(item.status)) return
  const next: GenerationQueueItem = { ...item, status: 'cancelled', updatedAt: Date.now(), error: item.taskId ? '已停止等待；上游是否停止以接口能力为准' : undefined }
  // Claim cancellation synchronously so a dispatch awaiting storage cannot continue.
  useStore.setState((state) => ({ generationQueue: state.generationQueue.map((row) => row.id === id ? next : row) }))
  if (item.taskId) stopImageTask(item.taskId)
  try { await generationQueueDb.put(next) } catch (error) { failStorage(error); throw error }
}
export async function retryQueueItems(ids: string[]) {
  await assertQueueControl()
  const state = useStore.getState()
  const items = state.generationQueue.filter((row) => ids.includes(row.id) && ['error', 'interrupted', 'cancelled'].includes(row.status)).map((row): GenerationQueueItem => ({ ...row, status: 'queued', taskId: undefined, error: undefined, attempt: row.attempt + 1, updatedAt: Date.now() }))
  await generationQueueDb.putMany(items)
  useStore.setState((current) => ({ generationQueue: current.generationQueue.map((row) => items.find((next) => next.id === row.id) ?? row), generationQueuePaused: false, generationQueueMessage: '' }))
}
async function dispatch(item: GenerationQueueItem) {
  dispatching.add(item.id)
  try {
    const claimed: GenerationQueueItem = { ...item, status: 'running', updatedAt: Date.now() }
    useStore.setState((state) => ({ generationQueue: state.generationQueue.map((row) => row.id === item.id ? claimed : row) }))
    await generationQueueDb.put(claimed)
    if (useStore.getState().generationQueue.find((row) => row.id === item.id)?.status !== 'running') return
    const settings = normalizeSettings(useStore.getState().settings)
    const home = getHomeApiProfile(settings)
    const profile = home.id === item.request.apiProfileId ? home : settings.profiles.find((row) => row.id === item.request.apiProfileId)
    if (!profile || generationProfileIdentity(profile) !== item.request.profileIdentity) throw new Error('此队列项的模型或接口配置已改变，请用当前配置重新加入队列')
    const inputImages = []
    for (const id of item.request.inputImageIds) {
      const image = await getImage(id)
      if (!image) throw new Error('参考原图已不存在，请恢复备份或重新加入队列')
      inputImages.push({ id, dataUrl: image.dataUrl })
    }
    if (useStore.getState().generationQueue.find((row) => row.id === item.id)?.status !== 'running') return
    const taskId = await submitTaskWithInput({ ...item.request, inputImages, generationQueueRef: queueSubmissionRef(item) })
    if (!taskId) throw new Error('任务提交失败，请检查生图配置和参考图数量')
    const latest = useStore.getState().generationQueue.find((row) => row.id === item.id)
    if (!latest || latest.status === 'cancelled') { stopImageTask(taskId); return }
    await save({ ...latest, taskId, taskIds: [...new Set([...latest.taskIds, taskId])], updatedAt: Date.now() })
  } catch (error) {
    const latest = useStore.getState().generationQueue.find((row) => row.id === item.id)
    if (latest && latest.status !== 'cancelled') {
      try { await save({ ...latest, status: 'error', error: safeError(error), updatedAt: Date.now() }) } catch (storageError) { failStorage(storageError) }
    }
  } finally { dispatching.delete(item.id); wake?.() }
}
async function reconcile() {
  const state = useStore.getState()
  for (const item of state.generationQueue) {
    if (item.status !== 'running' || dispatching.has(item.id)) continue
    const task = state.tasks.find((task) => task.id === item.taskId || task.generationQueueRef === queueSubmissionRef(item))
    if (task && (task.status === 'running' || (task.falRequestId && task.falEndpoint && task.falRecoverable) || (task.customTaskId && task.customRecoverable))) continue
    await save({ ...item, taskId: task?.id ?? item.taskId, status: task?.status === 'done' ? 'done' : 'error', error: task?.status === 'done' ? undefined : safeError(task?.error || '任务执行状态未知，请检查记录后重试'), updatedAt: Date.now() })
  }
}
async function cycle() {
  if (cycling) return
  const state = useStore.getState()
  if (!state.generationQueueReady || !state.generationQueue.some((row) => row.status === 'running' || (!state.generationQueuePaused && row.status === 'queued'))) return
  if (!globalThis.navigator?.locks) { useStore.setState({ generationQueuePaused: true, generationQueueMessage: '当前浏览器不支持安全队列锁，请使用新版 Chrome / Edge 或逐张生成' }); return }
  cycling = true
  let acquired = false
  try {
    await navigator.locks.request(GENERATION_QUEUE_LOCK, { ifAvailable: true }, async (lock) => {
      if (!lock) { useStore.setState({ generationQueuePaused: true, generationQueueMessage: '另一标签页正在执行队列，请在该页面操作，避免重复生成' }); return }
      ownsLock = true
      acquired = true
      try {
      // Refresh persisted statuses under the cross-tab lock before claiming queued work.
      const storedTasks = await getAllTasks()
      useStore.setState((current) => ({ tasks: [...storedTasks.map((task) => { const memory = current.tasks.find((row) => row.id === task.id); return memory && (memory.finishedAt ?? 0) > (task.finishedAt ?? 0) ? memory : task }), ...current.tasks.filter((task) => !storedTasks.some((row) => row.id === task.id))] }))
      useStore.setState({ generationQueue: sortGenerationQueue(await generationQueueDb.getAll()), generationQueueMessage: '' })
      while (subscribers && useStore.getState().generationQueueReady) {
        await reconcile()
        const current = useStore.getState()
        const active = current.generationQueue.filter((row) => row.status === 'running').length
        if (!current.generationQueuePaused) {
          const next = current.generationQueue.filter((row) => row.status === 'queued').slice(0, Math.max(0, current.generationQueueConcurrency - active))
          for (const item of next) void dispatch(item)
        }
        const latest = useStore.getState()
        if (!latest.generationQueue.some((row) => row.status === 'running') && (latest.generationQueuePaused || !latest.generationQueue.some((row) => row.status === 'queued'))) break
        await new Promise<void>((resolve) => { const timer = setTimeout(() => { wake = undefined; resolve() }, 750); wake = () => { clearTimeout(timer); wake = undefined; resolve() } })
      }
      } finally { ownsLock = false }
    })
  } catch (error) { failStorage(error) } finally {
    cycling = false
    const latest = useStore.getState()
    if (acquired && subscribers && latest.generationQueueReady && !latest.generationQueuePaused && latest.generationQueue.some((row) => row.status === 'queued')) void cycle()
  }
}
export function startGenerationQueueRunner() {
  subscribers++
  const unsubscribe = useStore.subscribe(() => { wake?.(); if (!cycling) void cycle() })
  void cycle()
  return () => { unsubscribe(); subscribers = Math.max(0, subscribers - 1); wake?.() }
}
