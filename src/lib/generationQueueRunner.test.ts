import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerationQueueItem, GenerationQueueRequest, TaskRecord } from '../types'
import { DEFAULT_PARAMS } from '../types'
import { createDefaultOpenAIProfile, normalizeSettings, DEFAULT_SETTINGS } from './apiProfiles'
import { generationProfileIdentity } from './plannerGeneration'

const fixture = vi.hoisted(() => {
  const listeners = new Set<() => void>(), rows = new Map<string, GenerationQueueItem>()
  let state: any
  const store = { getState: () => state, setState: (patch: any) => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; for (const listener of listeners) listener() }, subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn) } }
  return { store, rows, imageMissing: false, blocked: false, deferWrite: undefined as undefined | (() => Promise<void>), submit: vi.fn(), stop: vi.fn() }
})
vi.mock('../store', () => ({ useStore: fixture.store, submitTaskWithInput: fixture.submit, stopImageTask: fixture.stop }))
vi.mock('./db', () => ({
  referenceAnalysisCacheDb: { getAll: async () => [], put: async () => {}, remove: async () => {}, clear: async () => {} },
  getAllTasks: async () => fixture.store.getState().tasks,
  getImage: async (id: string) => fixture.imageMissing ? undefined : { id, dataUrl: 'data:image/png;base64,YQ==' },
  generationQueueDb: {
    getAll: async () => [...fixture.rows.values()].reverse().map((row) => structuredClone(row)),
    put: async (row: GenerationQueueItem) => { const wait = fixture.deferWrite; fixture.deferWrite = undefined; if (wait) await wait(); fixture.rows.set(row.id, structuredClone(row)) },
    putMany: async (rows: GenerationQueueItem[]) => { rows.forEach((row) => fixture.rows.set(row.id, structuredClone(row))) },
  },
}))
import { cancelQueueItem, configureGenerationQueue, enqueueGenerationRequests, retryQueueItems, startGenerationQueueRunner } from './generationQueueRunner'
import { withGenerationQueueRecovery } from './generationQueueLock'
const profile = { ...createDefaultOpenAIProfile(), apiKey: 'secret-key-test', baseUrl: 'https://images.example/v1' }
const request = (slot: string): GenerationQueueRequest => ({ apiProfileId: profile.id, profileIdentity: generationProfileIdentity(profile), prompt: `photo ${slot}`, params: { ...DEFAULT_PARAMS }, category: { amazonSlot: slot, workflow: 'amazon-listing' }, inputImageIds: ['original'], referenceImageUsages: {} })
let cleanup: undefined | (() => void)
beforeEach(() => {
  fixture.rows.clear(); fixture.imageMissing = false; fixture.blocked = false; fixture.deferWrite = undefined
  fixture.submit.mockReset(); fixture.stop.mockReset()
  fixture.store.setState({ settings: normalizeSettings({ ...DEFAULT_SETTINGS, profiles: [profile], activeProfileId: profile.id, homeApiProfileId: profile.id, apiSetupMode: 'advanced' }), tasks: [], generationQueue: [], generationQueuePaused: true, generationQueueReady: true, generationQueueConcurrency: 1, generationQueueMessage: '' })
  vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown, callback: (lock: unknown) => Promise<unknown>) => callback(fixture.blocked ? null : {}), query: async () => ({ held: fixture.blocked ? [{ name: 'amazon-image-studio-generation-queue' }] : [] }) } })
  fixture.submit.mockImplementation(async (input) => {
    const task = { id: `task-${fixture.submit.mock.calls.length}`, status: 'running', createdAt: Date.now(), generationQueueRef: input.generationQueueRef } as TaskRecord
    fixture.store.setState((state: any) => ({ tasks: [...state.tasks, task] })); return task.id
  })
})
afterEach(async () => { cleanup?.(); cleanup = undefined; for (let i = 0; i < 20; i++) await Promise.resolve(); vi.unstubAllGlobals() })
const finish = (status: 'done' | 'error' = 'done') => fixture.store.setState((state: any) => ({ tasks: state.tasks.map((task: TaskRecord) => ({ ...task, status, error: status === 'error' ? 'failure secret-key-test' : undefined })) }))

describe('browser generation queue execution', () => {
  it('limits concurrency, pauses only waiting work, resumes and retains one task per item', async () => {
    fixture.store.setState({ generationQueueConcurrency: 2 }); cleanup = startGenerationQueueRunner()
    await enqueueGenerationRequests(['MAIN', 'PT01', 'PT02'].map(request), 'Set')
    await vi.waitFor(() => expect(fixture.submit).toHaveBeenCalledTimes(2))
    await configureGenerationQueue({ generationQueuePaused: true }); finish()
    await vi.waitFor(() => expect(fixture.store.getState().generationQueue.filter((row: GenerationQueueItem) => row.status === 'done')).toHaveLength(2))
    expect(fixture.submit).toHaveBeenCalledTimes(2)
    await configureGenerationQueue({ generationQueuePaused: false })
    await vi.waitFor(() => expect(fixture.submit).toHaveBeenCalledTimes(3)); finish()
    await vi.waitFor(() => expect(fixture.store.getState().generationQueue.every((row: GenerationQueueItem) => row.status === 'done')).toBe(true))
    expect(fixture.submit.mock.calls[0][0].inputImages[0].id).toBe('original')
    expect(fixture.submit.mock.calls.map(([input]) => input.category.amazonSlot)).toEqual(['MAIN', 'PT01', 'PT02'])
  })
  it('retries failed items with a fresh attempt, masks credentials and does not retry completed ones', async () => {
    cleanup = startGenerationQueueRunner(); await enqueueGenerationRequests([request('MAIN')], 'Set')
    await vi.waitFor(() => expect(fixture.submit).toHaveBeenCalledTimes(1)); finish('error')
    await vi.waitFor(() => expect(fixture.store.getState().generationQueue[0].status).toBe('error'))
    const first = fixture.store.getState().generationQueue[0]
    expect(first.error).not.toContain(profile.apiKey)
    await retryQueueItems([first.id]); await vi.waitFor(() => expect(fixture.submit).toHaveBeenCalledTimes(2))
    expect(fixture.submit.mock.calls[1][0].generationQueueRef).not.toBe(fixture.submit.mock.calls[0][0].generationQueueRef)
    finish(); await vi.waitFor(() => expect(fixture.store.getState().generationQueue[0].status).toBe('done'))
    await retryQueueItems([first.id]); expect(fixture.submit).toHaveBeenCalledTimes(2)
  })
  it('cancels waiting items without dispatching, and stops a running task', async () => {
    cleanup = startGenerationQueueRunner(); await enqueueGenerationRequests([request('MAIN'), request('PT01')], 'Set')
    await vi.waitFor(() => expect(fixture.submit).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(fixture.store.getState().generationQueue[0].taskId).toBeTruthy())
    const [first, second] = fixture.store.getState().generationQueue
    await cancelQueueItem(second.id); await cancelQueueItem(first.id)
    expect(fixture.stop).toHaveBeenCalledWith(first.taskId)
    expect(fixture.store.getState().generationQueue.every((row: GenerationQueueItem) => row.status === 'cancelled')).toBe(true)
    expect(fixture.submit).toHaveBeenCalledTimes(1)
  })
  it('reconciles already-running native tasks even when no waiting work exists and queue is paused', async () => {
    const row: GenerationQueueItem = { id: 'native', batchId: 'b', slot: 'MAIN', title: 'Set', request: request('MAIN'), status: 'running', attempt: 1, taskId: 'native-task', taskIds: ['native-task'], createdAt: 1, updatedAt: 1 }
    fixture.rows.set(row.id, row); fixture.store.setState({ generationQueue: [row], tasks: [{ id: 'native-task', status: 'done' }] })
    cleanup = startGenerationQueueRunner()
    await vi.waitFor(() => expect(fixture.store.getState().generationQueue[0].status).toBe('done'))
    expect(fixture.submit).not.toHaveBeenCalled()
  })
  it('refuses cross-tab mutation and lets initialization observe another active queue without recovery', async () => {
    fixture.blocked = true
    await expect(enqueueGenerationRequests([request('MAIN')], 'Set')).rejects.toThrow('另一标签页')
    const recover = vi.fn(async () => 'recover'), observe = vi.fn(async () => 'observe')
    expect(await withGenerationQueueRecovery(recover, observe)).toBe('observe'); expect(recover).not.toHaveBeenCalled()
  })
  it('blocks changed endpoint/model and missing originals before making requests', async () => {
    fixture.imageMissing = true
    await expect(enqueueGenerationRequests([request('MAIN')], 'Set')).rejects.toThrow('原图缺失')
    fixture.imageMissing = false
    const changed = { ...request('MAIN'), profileIdentity: 'old-config' }
    cleanup = startGenerationQueueRunner(); await enqueueGenerationRequests([changed], 'Set')
    await vi.waitFor(() => expect(fixture.store.getState().generationQueue[0].status).toBe('error'))
    expect(fixture.store.getState().generationQueue[0].error).toContain('已改变'); expect(fixture.submit).not.toHaveBeenCalled()
  })
})
