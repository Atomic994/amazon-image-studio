import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { DEFAULT_PARAMS } from './types'
import { createDefaultFalProfile, createDefaultOpenAIProfile, createDefaultVolcengineProfile, DEFAULT_RESPONSES_MODEL, DEFAULT_SETTINGS, getHomeApiProfile, normalizeSettings } from './lib/apiProfiles'
import type { AgentConversation, AmazonPlannerSession, ExportData, StoredImage, StoredImageThumbnail, TaskRecord } from './types'
import { getSelectedImageMentionLabel } from './lib/promptImageMentions'
vi.mock('./lib/db', () => {
  const tasks = new Map<string, TaskRecord>()
  const amazonPlannerSessions = new Map<string, AmazonPlannerSession>()
  const materialCollections = new Map<string, import('./types').MaterialCollection>()
  const images = new Map<string, StoredImage>()
  const thumbnails = new Map<string, StoredImageThumbnail>()
  let imageSeq = 0
  const analysisCache = new Map<string, import('./types').ReferenceAnalysisCacheEntry>()

  return {
    CURRENT_THUMBNAIL_VERSION: 2,
    hashDataUrl: async (dataUrl: string) => `hash:${dataUrl}`,
    referenceAnalysisCacheDb: {
      getAll: async () => [...analysisCache.values()],
      put: async (entry: import('./types').ReferenceAnalysisCacheEntry) => { analysisCache.set(entry.id, entry) },
      remove: async (id: string) => { analysisCache.delete(id) },
      clear: async () => { analysisCache.clear() },
    },
    getAllTasks: async () => [...tasks.values()],
    putTask: async (task: TaskRecord) => {
      tasks.set(task.id, task)
      return task.id
    },
    deleteTask: async (id: string) => {
      tasks.delete(id)
    },
    clearTasks: async () => {
      tasks.clear()
    },
    getAllAmazonPlannerSessions: async () => [...amazonPlannerSessions.values()],
    putAmazonPlannerSession: async (session: AmazonPlannerSession) => {
      amazonPlannerSessions.set(session.id, session)
      return session.id
    },
    deleteAmazonPlannerSession: async (id: string) => {
      amazonPlannerSessions.delete(id)
    },
    clearAmazonPlannerSessions: async () => {
      amazonPlannerSessions.clear()
    },
    getAllMaterialCollections: async () => [...materialCollections.values()],
    putMaterialCollection: async (collection: import('./types').MaterialCollection) => { materialCollections.set(collection.id, collection); return collection.id },
    deleteMaterialCollection: async (id: string) => { materialCollections.delete(id) },
    clearMaterialCollections: async () => { materialCollections.clear() },
    getImage: async (id: string) => images.get(id),
    getImageThumbnail: async (id: string) => thumbnails.get(id),
    getStoredFreshImageThumbnail: async (id: string) => thumbnails.get(id),
    getAllImageIds: async () => [...images.keys()],
    getAllImages: async () => [...images.values()],
    putImage: async (image: StoredImage) => {
      images.set(image.id, image)
      return image.id
    },
    putImageThumbnail: async (thumbnail: StoredImageThumbnail) => {
      thumbnails.set(thumbnail.id, thumbnail)
      return thumbnail.id
    },
    deleteImage: async (id: string) => {
      images.delete(id)
      thumbnails.delete(id)
    },
    clearImages: async () => {
      images.clear()
      thumbnails.clear()
    },
    storeImage: async (dataUrl: string, source: StoredImage['source'] = 'upload') => {
      const id = `stored-image-${++imageSeq}`
      images.set(id, { id, dataUrl, source, createdAt: Date.now() })
      return id
    },
  }
})
vi.mock('./lib/api', () => ({
  callImageApi: vi.fn(async () => ({
    images: [],
    actualParams: {},
    actualParamsList: [],
    revisedPrompts: [],
  })),
}))
vi.mock('./lib/agentApi', () => ({
  callAgentConversationTitleApi: vi.fn(async () => '标题'),
  callAgentResponsesApi: vi.fn(() => new Promise(() => {})),
  callBatchImageSingle: vi.fn(async (opts: { batchItemId: string; prompt: string }) => ({
    batchItemId: opts.batchItemId,
    image: { dataUrl: 'data:image/png;base64,batch-output', revisedPrompt: opts.prompt },
    error: null,
  })),
  parseBatchImageCallArguments: vi.fn((args: string) => {
    try {
      const parsed = JSON.parse(args) as { images?: Array<{ id?: string; prompt?: string; reference_ids?: string[] }> }
      return parsed.images?.map((item, index) => ({
        id: item.id || `image_${index + 1}`,
        prompt: item.prompt || '',
        reference_ids: item.reference_ids || [],
      })) ?? null
    } catch {
      return null
    }
  }),
}))
import { clearAmazonPlannerSessions, clearMaterialCollections, clearImages, clearTasks as clearStoredTasks, getAllAmazonPlannerSessions, getImage, putAmazonPlannerSession, putImage, putTask } from './lib/db'
import { materialItemFromTask } from './lib/materialCollections'
import { confirmProductFacts, emptyProductFactsState } from './lib/productFacts'
import { normalizeReferenceAnalysis } from './lib/referenceAnalysis'
import { normalizeReferenceUsage } from './lib/referenceImageUsage'
import { saveMaterialCollection, reuseMaterialItem } from './store'
import { callAgentResponsesApi, callBatchImageSingle } from './lib/agentApi'
import { callImageApi } from './lib/api'
import { cleanStaleAgentInputDrafts, clearData, deleteImageIfUnreferenced, editOutputs, ensureImageCached, exportData, getErrorToastMessage, getPersistedState, getTaskApiProfile, importData, initStore, markInterruptedOpenAIRunningTasks, mergePersistedState, openSeedreamTaskInEditor, regenerateAgentAssistantMessage, removeTask, resolveInputImagesForRequest, retryTask, reuseConfig, submitAgentMessage, submitTask, submitTaskWithInput, useStore } from './store'

const imageA = { id: 'image-a', dataUrl: 'data:image/png;base64,a' }
const imageB = { id: 'image-b', dataUrl: 'data:image/png;base64,b' }

beforeEach(async () => {
  await clearMaterialCollections()
  useStore.setState({ materialCollections: [], referenceImageUsages: {}, imageResultReviews: {}, imageFinalSelections: {}, reviewImageId: null, materialCollectionDraft: null, plannerRestoreRequest: null })
})

describe('local material and review persistence', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', { requestIdleCallback: () => 0 })
    await clearStoredTasks(); await clearImages(); await clearAmazonPlannerSessions()
    useStore.setState({ settings: settingsWithConfiguredImageProfile(), tasks: [], inputImages: [], galleryInputDraft: null, imageEditorDrafts: {}, agentInputDrafts: {}, agentConversations: [], prompt: '', params: { ...DEFAULT_PARAMS }, pendingTaskCategory: null, reusedTaskApiProfileId: null, reusedTaskApiProfileMissing: false, maskDraft: null, showToast: vi.fn() })
    vi.mocked(callImageApi).mockReset().mockResolvedValue({ images: [], actualParams: {} })
  })
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('keeps all collection versions and references after deleting tasks and reopening the database', async () => {
    const generated = task({ id: 'collected-task', outputImages: ['saved-v1'], inputImageIds: ['saved-ref'] })
    for (const id of ['saved-v1', 'saved-v2', 'saved-ref', 'saved-style']) await putImage({ id, dataUrl: `data:image/png;base64,${id}`, source: 'generated', createdAt: 1 })
    await putTask(generated)
    useStore.setState({ tasks: [generated] })
    const saved = await saveMaterialCollection({ title: 'Launch set', items: [materialItemFromTask(generated, 'saved-v1')], plannerSession: amazonPlannerSession({ referenceImageIds: ['saved-ref'], selectedStyleReferenceImageId: 'saved-style' }) })
    await saveMaterialCollection({ title: saved.title, items: [materialItemFromTask({ ...generated, outputImages: ['saved-v2'] }, 'saved-v2')] }, saved.id, 'v2')
    await removeTask(generated)
    await clearAmazonPlannerSessions()
    useStore.setState({ materialCollections: [] })
    await initStore()
    expect(useStore.getState().materialCollections[0].versions).toHaveLength(2)
    for (const id of ['saved-v1', 'saved-v2', 'saved-ref', 'saved-style']) {
      await deleteImageIfUnreferenced(id)
      expect(await getImage(id)).toBeDefined()
    }
  })

  it('filters scoped reference bytes at submission and preserves the ordered role contract on retry', async () => {
    const refs = ['product-role', 'layout-role', 'style-role'].map((id) => ({ id, dataUrl: `data:image/png;base64,${id}` }))
    for (const image of refs) await putImage({ ...image, createdAt: 1 })
    const state = useStore.getState()
    state.setInputImages(refs)
    state.setReferenceImageUsage('layout-role', { purpose: 'composition', slots: ['MAIN'] })
    state.setReferenceImageUsage('style-role', { purpose: 'style', slots: ['PT01'] })
    state.setPrompt('Make MAIN')
    state.setPendingTaskCategory({ mode: 'prompt-match', prompt: 'Make MAIN', category: { workflow: 'amazon-listing', amazonSlot: 'MAIN', plannerSessionId: 'session' } })
    expect(await submitTask()).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    const generated = useStore.getState().tasks[0]
    expect(generated.inputImageIds).toEqual(['product-role', 'layout-role'])
    expect(callImageApi).toHaveBeenCalledWith(expect.objectContaining({ inputImageDataUrls: refs.slice(0, 2).map((image) => image.dataUrl), prompt: expect.stringContaining('Reference 2: Composition reference') }))
    expect(generated.category?.plannerSessionId).toBe('session')
    await retryTask(generated)
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.mocked(callImageApi).mock.calls[1][0].inputImageDataUrls).toEqual(refs.slice(0, 2).map((image) => image.dataUrl))
  })

  it('reuses a saved item from stored full references and persists final selection and notes', async () => {
    await putImage({ id: 'reuse-ref', dataUrl: 'data:image/png;base64,full-original', createdAt: 1 })
    const savedTask = task({ inputImageIds: ['reuse-ref'], referenceImageUsages: { 'reuse-ref': { purpose: 'style', slots: ['PT01'], note: 'Lighting' } }, category: { workflow: 'amazon-listing', amazonSlot: 'PT01', plannerSessionId: 'session' } })
    await reuseMaterialItem(materialItemFromTask(savedTask, 'out'))
    expect(useStore.getState().inputImages).toEqual([{ id: 'reuse-ref', dataUrl: 'data:image/png;base64,full-original' }])
    expect(useStore.getState().referenceImageUsages['reuse-ref'].purpose).toBe('style')
    useStore.getState().saveImageReview('root', 'v2', 'approved', 'Ready')
    useStore.getState().saveImageReview('root', 'v3', 'approved', 'Final')
    const persisted = mergePersistedState(getPersistedState(useStore.getState()), useStore.getState())
    expect(persisted.imageFinalSelections).toEqual({ root: 'v3' })
    expect(persisted.imageResultReviews.v2.note).toBe('Ready')
    expect(persisted.imageResultReviews.v3.note).toBe('Final')
  })

  it('binds confirmed facts and validated reference observations to requests and keeps them on retry and reuse', async () => {
    const reference = { id: 'facts-ref', dataUrl: 'data:image/png;base64,YQ==' }
    await putImage(reference)
    const factsState = emptyProductFactsState(); factsState.draft.productName = 'Lamp'; factsState.draft.color = 'Black'
    const confirmed = confirmProductFacts(factsState, 'source', [reference.id]).versions[0]
    const analysis = { id: 'cached', imageId: reference.id, imageHash: `hash:${reference.dataUrl}`, profileIdentity: 'planner', usage: normalizeReferenceUsage(), analysis: normalizeReferenceAnalysis({ summary: 'Round base' }), model: 'planner', createdAt: 1 }
    const state = useStore.getState()
    state.setInputImages([reference]); state.setPrompt('Generate lamp')
    state.setPendingTaskCategory({ mode: 'prompt-match', prompt: 'Generate lamp', category: { workflow: 'amazon-listing', amazonSlot: 'MAIN', productFactsVersionId: confirmed.id }, productFactsSnapshot: confirmed, referenceAnalysisSnapshots: [analysis] })
    expect(await submitTask()).toBe(true)
    confirmed.facts.color = 'Changed outside task'
    await vi.advanceTimersByTimeAsync(0)
    const generated = useStore.getState().tasks[0]
    expect(generated.productFactsSnapshot?.facts.color).toBe('Black')
    expect(vi.mocked(callImageApi).mock.calls[0][0].prompt).toContain('color: Black')
    expect(vi.mocked(callImageApi).mock.calls[0][0].prompt).toContain('Round base')
    expect(vi.mocked(callImageApi).mock.calls[0][0].inputImageDataUrls).toEqual([reference.dataUrl])
    await retryTask(generated); await vi.advanceTimersByTimeAsync(0)
    expect(vi.mocked(callImageApi).mock.calls[1][0].prompt).toContain(`CONFIRMED PRODUCT FACTS [${confirmed.id}]`)
    await reuseMaterialItem(materialItemFromTask(generated, 'output'))
    expect(useStore.getState().pendingTaskCategory?.productFactsSnapshot?.facts.color).toBe('Black')
    await reuseConfig(generated)
    expect(useStore.getState().pendingTaskCategory?.productFactsSnapshot?.id).toBe(confirmed.id)
  })

  it('discards cached analysis when original bytes changed and never replaces image attachments with text', async () => {
    const reference = { id: 'changed-bytes', dataUrl: 'data:image/png;base64,Yg==' }
    await putImage(reference)
    const analysis = { id: 'old-analysis', imageId: reference.id, imageHash: 'hash:data:image/png;base64,YQ==', profileIdentity: 'planner', usage: normalizeReferenceUsage(), analysis: normalizeReferenceAnalysis({ summary: 'Stale observation must not be used' }), model: 'planner', createdAt: 1 }
    await submitTaskWithInput({ apiProfileId: getHomeApiProfile(useStore.getState().settings).id, prompt: 'Keep image', params: { ...DEFAULT_PARAMS }, inputImages: [reference], category: { workflow: 'gallery' }, referenceAnalysisSnapshots: [analysis] })
    await vi.advanceTimersByTimeAsync(0)
    const request = vi.mocked(callImageApi).mock.calls[0][0]
    expect(request.inputImageDataUrls).toEqual([reference.dataUrl])
    expect(request.prompt).not.toContain('Stale observation')
    expect(useStore.getState().tasks[0].referenceAnalysisSnapshots).toBeUndefined()
  })

  it('pins fact provenance and analysis originals after the generation task is removed if a set still uses them', async () => {
    const factsState = emptyProductFactsState(); factsState.draft.productName = 'Lamp'
    const confirmed = confirmProductFacts(factsState, 'old-source', ['original-facts-source']).versions[0]
    for (const id of ['saved-output', 'original-facts-source']) await putImage({ id, dataUrl: 'data:image/png;base64,YQ==', createdAt: 1 })
    const generated = task({ id: 'facts-task', inputImageIds: [], outputImages: ['saved-output'], productFactsSnapshot: confirmed })
    await putTask(generated); useStore.setState({ tasks: [generated] })
    await saveMaterialCollection({ title: 'With fact provenance', items: [materialItemFromTask(generated, 'saved-output')] })
    await removeTask(generated)
    expect(await getImage('original-facts-source')).toBeDefined()
    await initStore()
    expect(await getImage('original-facts-source')).toBeDefined()
  })

  it('remaps explicit references after scope filtering and rejects references excluded from the current slot', async () => {
    const refs = ['scope-product', 'scope-excluded', 'scope-style'].map((id) => ({ id, dataUrl: `data:image/png;base64,${id}` }))
    for (const image of refs) await putImage({ ...image, createdAt: 1 })
    const state = useStore.getState()
    state.setInputImages(refs)
    state.setReferenceImageUsage(refs[1].id, { purpose: 'composition', slots: ['PT01'] })
    const configure = (prompt: string) => { state.setPrompt(prompt); state.setPendingTaskCategory({ mode: 'prompt-match', prompt, category: { workflow: 'amazon-listing', amazonSlot: 'MAIN' } }) }
    configure(`Use ${getSelectedImageMentionLabel(2)} as style`)
    expect(await submitTask()).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.mocked(callImageApi).mock.calls[0][0].prompt).toContain('Use [image 2] as style')
    expect(vi.mocked(callImageApi).mock.calls[0][0].inputImageDataUrls).toEqual([refs[0].dataUrl, refs[2].dataUrl])
    configure(`Use ${getSelectedImageMentionLabel(1)} as layout`)
    expect(await submitTask()).toBe(false)
    expect(callImageApi).toHaveBeenCalledTimes(1)
  })

  it('round-trips collections, review choices and images through a backup without API credentials', async () => {
    for (const id of ['backup-output', 'backup-ref']) await putImage({ id, dataUrl: 'data:image/png;base64,YQ==', createdAt: Date.now() })
    const draft = emptyProductFactsState(); draft.draft.productName = 'Portable lamp'
    const facts = confirmProductFacts(draft, 'source', ['backup-ref'])
    const analysis = { id: 'backup-analysis', imageId: 'backup-ref', imageHash: 'hash:data:image/png;base64,YQ==', profileIdentity: 'planner', usage: normalizeReferenceUsage(), analysis: normalizeReferenceAnalysis({ summary: 'Round base' }), model: 'planner', createdAt: 1 }
    const savedTask = task({ outputImages: ['backup-output'], inputImageIds: ['backup-ref'], productFactsSnapshot: facts.versions[0], referenceAnalysisSnapshots: [analysis] })
    const saved = await saveMaterialCollection({ title: 'Portable set', items: [materialItemFromTask(savedTask, 'backup-output')], plannerSession: amazonPlannerSession({ referenceImageIds: ['backup-ref'], productFacts: facts, referenceAnalyses: { 'backup-ref': analysis } }) })
    useStore.getState().saveImageReview('backup-output', 'backup-output', 'approved', 'Keep it')
    vi.stubGlobal('document', { createElement: () => ({ href: '', download: '', click: vi.fn() }) })
    const objectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:local-backup')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    await exportData({ exportTasks: true, exportConfig: false })
    const blob = objectURL.mock.calls[0][0] as Blob
    const bytes = await blob.arrayBuffer()
    const manifest = JSON.parse(strFromU8(unzipSync(new Uint8Array(bytes))['manifest.json'])) as ExportData
    expect(manifest.settings).toBeUndefined()
    expect(manifest.materialCollections?.[0].id).toBe(saved.id)
    await clearMaterialCollections(); await clearImages()
    useStore.setState({ materialCollections: [], imageResultReviews: {}, imageFinalSelections: {} })
    expect(await importData({ arrayBuffer: async () => bytes } as File, { importConfig: false, importTasks: true })).toBe(true)
    expect(useStore.getState().materialCollections[0].versions[0].plannerSession?.referenceImageIds).toEqual(['backup-ref'])
    expect(useStore.getState().materialCollections[0].versions[0].plannerSession?.productFacts?.versions[0].facts.productName).toBe('Portable lamp')
    expect(useStore.getState().materialCollections[0].versions[0].items[0].productFactsSnapshot?.id).toBe(facts.selectedVersionId)
    expect(useStore.getState().materialCollections[0].versions[0].items[0].referenceAnalysisSnapshots?.[0].analysis.summary).toBe('Round base')
    expect(useStore.getState().imageFinalSelections['backup-output']).toBe('backup-output')
    expect(await getImage('backup-output')).toBeDefined()
    expect(await getImage('backup-ref')).toBeDefined()
  })
})

describe('independent editor workspaces and restored references', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', { requestIdleCallback: () => 0 })
    await clearStoredTasks()
    await clearAmazonPlannerSessions()
    await clearImages()
    useStore.getState().resetSeedreamEditorDraft()
    useStore.setState({ settings: settingsWithConfiguredImageProfile(), tasks: [], inputImages: [], galleryInputDraft: null,
      agentConversations: [], agentInputDrafts: {}, prompt: '', params: { ...DEFAULT_PARAMS }, pendingTaskCategory: null,
      reusedTaskApiProfileId: null, reusedTaskApiProfileName: null, reusedTaskApiProfileMissing: false, showToast: vi.fn() })
    vi.mocked(callImageApi).mockReset().mockResolvedValue({ images: ['data:image/png;base64,result'], actualParams: {} })
  })
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })

  it('restores each image’s instruction, annotations, references and latest result after switching or rehydrating', () => {
    const state = useStore.getState()
    state.selectImageEditorSource('workspace-A')
    state.setSeedreamEditorDraft({ instruction: 'Edit A', referenceImageIds: ['reference-A'], latestTaskId: 'task-A', annotations: [{ id: 'box-A', kind: 'rectangle', color: '#ff0000', width: 0.006, points: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }] }] })
    state.selectImageEditorSource('workspace-B')
    state.setSeedreamEditorDraft({ instruction: 'Edit B', referenceImageIds: ['reference-B'], latestTaskId: 'task-B' })
    state.updateImageEditorDraft('workspace-A', { latestTaskId: 'task-A-submitted-later' })
    expect(useStore.getState().seedreamEditorDraft).toMatchObject({ sourceImageId: 'workspace-B', instruction: 'Edit B', latestTaskId: 'task-B' })
    state.updateImageEditorDraft('workspace-A', { referenceImageIds: ['reference-A', 'reference-A-uploaded-later'] })
    expect(useStore.getState().seedreamEditorDraft.referenceImageIds).toEqual(['reference-B'])
    state.selectImageEditorSource('workspace-A')
    expect(useStore.getState().seedreamEditorDraft).toMatchObject({ instruction: 'Edit A', referenceImageIds: ['reference-A', 'reference-A-uploaded-later'], latestTaskId: 'task-A-submitted-later', annotations: [{ id: 'box-A' }] })
    state.selectImageEditorSource('workspace-A')
    expect(useStore.getState().seedreamEditorDraft.annotations).toHaveLength(1)
    const restored = mergePersistedState(getPersistedState(useStore.getState()), useStore.getState())
    expect(restored.imageEditorDrafts['workspace-B']?.instruction).toBe('Edit B')
    expect(restored.imageEditorDrafts['workspace-A']?.annotations[0]?.id).toBe('box-A')
  })

  it('submits B while A is still running and keeps each request and result attached to its own source', async () => {
    const a = { id: 'concurrent-source-A', dataUrl: 'data:image/png;base64,sourceA' }
    const b = { id: 'concurrent-source-B', dataUrl: 'data:image/png;base64,sourceB' }
    await putImage({ ...a, source: 'upload', createdAt: 1 })
    await putImage({ ...b, source: 'upload', createdAt: 2 })
    const finishes: Array<(value: { images: string[] }) => void> = []
    vi.mocked(callImageApi).mockImplementation(() => new Promise((resolve) => { finishes.push(resolve) }))
    const profile = getHomeApiProfile(useStore.getState().settings)
    const submit = (source: typeof a, instruction: string) => submitTaskWithInput({ apiProfileId: profile.id, prompt: instruction, inputImages: [source], params: { ...DEFAULT_PARAMS }, category: { workflow: 'seedream-edit' }, imageEditContext: { engine: 'home', sourceImageId: source.id, referenceImageIds: [], userInstruction: instruction } })
    useStore.getState().selectImageEditorSource(a.id)
    const taskA = await submit(a, 'Edit A only')
    useStore.getState().updateImageEditorDraft(a.id, { latestTaskId: taskA })
    useStore.getState().selectImageEditorSource(b.id)
    const taskB = await submit(b, 'Edit B only')
    useStore.getState().updateImageEditorDraft(b.id, { latestTaskId: taskB })
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.mocked(callImageApi).mock.calls.map(([options]) => options.inputImageDataUrls)).toEqual([[a.dataUrl], [b.dataUrl]])
    expect(useStore.getState().tasks.filter((task) => task.status === 'running')).toHaveLength(2)
    expect(useStore.getState().seedreamEditorDraft).toMatchObject({ sourceImageId: b.id, latestTaskId: taskB })
    finishes[1]!({ images: ['data:image/png;base64,editedB'] })
    await vi.advanceTimersByTimeAsync(0)
    expect(useStore.getState().tasks.find((task) => task.id === taskB)?.status).toBe('done')
    expect(useStore.getState().tasks.find((task) => task.id === taskA)?.status).toBe('running')
    finishes[0]!({ images: ['data:image/png;base64,editedA'] })
    await vi.advanceTimersByTimeAsync(0)
    expect(useStore.getState().tasks.find((task) => task.id === taskA)?.status).toBe('done')
  })

  it('preserves references stored only in planner history when initialization removes unused images', async () => {
    await putImage({ id: 'history-only-reference', dataUrl: 'data:image/png;base64,history-product', source: 'upload', createdAt: 1 })
    await putImage({ id: 'history-only-style', dataUrl: 'data:image/png;base64,history-style', source: 'upload', createdAt: 1 })
    await putImage({ id: 'real-orphan-image', dataUrl: 'data:image/png;base64,orphan', source: 'upload', createdAt: 1 })
    await putAmazonPlannerSession(amazonPlannerSession({ referenceImageIds: ['history-only-reference'], selectedStyleReferenceImageId: 'history-only-style' }))
    await initStore()
    expect(await getImage('history-only-reference')).toBeDefined()
    expect(await getImage('history-only-style')).toBeDefined()
    expect(await getImage('real-orphan-image')).toBeUndefined()
    await deleteImageIfUnreferenced('history-only-reference')
    expect(await getImage('history-only-reference')).toBeDefined()
  })

  it('sends restored reference bytes even when the persisted draft contains only an ID and an empty URL', async () => {
    const source = { id: 'restored-reference-bytes', dataUrl: 'data:image/png;base64,persisted-real-reference' }
    await putImage({ ...source, source: 'upload', createdAt: 1 })
    useStore.getState().setInputImages([{ id: source.id, dataUrl: '' }])
    useStore.getState().setPrompt('Generate using the exact reference product')
    expect(await submitTask()).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(callImageApi).toHaveBeenCalledWith(expect.objectContaining({ inputImageDataUrls: [source.dataUrl] }))
    const task = useStore.getState().tasks[0]!
    expect(task.inputImageIds).toEqual([source.id])
  })

  it('restores a still-visible image record before submitting and never silently drops a missing reference', async () => {
    const visible = { id: 'visible-reference-repair', dataUrl: 'data:image/png;base64,visible-preview-original' }
    expect(await resolveInputImagesForRequest([visible])).toEqual([visible])
    expect((await getImage(visible.id))?.dataUrl).toBe(visible.dataUrl)
    useStore.getState().setInputImages([{ id: 'unrecoverable-reference-test', dataUrl: '' }])
    useStore.getState().setPrompt('Do not submit without reference')
    expect(await submitTask()).toBe(false)
    expect(callImageApi).not.toHaveBeenCalled()
  })

  it('keeps sources belonging to inactive editing workspaces during cleanup', async () => {
    await putImage({ id: 'inactive-workspace-A', dataUrl: 'data:image/png;base64,A', source: 'upload', createdAt: 1 })
    await putImage({ id: 'active-workspace-B', dataUrl: 'data:image/png;base64,B', source: 'upload', createdAt: 1 })
    useStore.getState().selectImageEditorSource('inactive-workspace-A')
    useStore.getState().selectImageEditorSource('active-workspace-B')
    await initStore()
    expect(await ensureImageCached('inactive-workspace-A')).toBeTruthy()
    await deleteImageIfUnreferenced('inactive-workspace-A')
    expect(await getImage('inactive-workspace-A')).toBeDefined()
  })
})

describe('error toast messages', () => {
  it('drops long error detail after the failure title', () => {
    expect(getErrorToastMessage('Agent 请求失败：接口拒绝了很长的提示词内容')).toBe('Agent 请求失败')
  })

  it('uses a generic message for long raw errors without a title', () => {
    expect(getErrorToastMessage(`invalid request ${'x'.repeat(90)}`)).toBe('操作失败，请查看详情')
  })
})

function agentConversation(overrides: Partial<AgentConversation> = {}): AgentConversation {
  return {
    id: 'conversation-a',
    title: '新对话',
    activeRoundId: null,
    createdAt: 1,
    updatedAt: 1,
    rounds: [],
    messages: [],
    ...overrides,
  }
}

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-a',
    prompt: 'prompt',
    params: { ...DEFAULT_PARAMS },
    inputImageIds: [],
    maskTargetImageId: null,
    maskImageId: null,
    outputImages: [],
    status: 'done',
    error: null,
    createdAt: 1,
    finishedAt: 2,
    elapsed: 1,
    ...overrides,
  }
}

function settingsWithConfiguredImageProfile(apiKey = 'test-key') {
  return normalizeSettings({
    ...DEFAULT_SETTINGS,
    profiles: DEFAULT_SETTINGS.profiles.map((profile) =>
      profile.id === DEFAULT_SETTINGS.activeProfileId ? { ...profile, apiKey } : profile,
    ),
  })
}

function amazonPlannerSession(overrides: Partial<AmazonPlannerSession> = {}): AmazonPlannerSession {
  return {
    id: 'planner-session-a',
    title: 'Tumbler Listing',
    mode: 'listing',
    aPlusType: 'standard-large',
    resolution: '2k',
    listingText: 'Title: Tumbler',
    referenceImageIds: [],
    draft: {
      kind: 'main',
      productTitle: 'Tumbler',
      category: 'Kitchen',
      brand: '',
      color: '',
      material: '',
      audience: '',
      sellingPoints: '',
      packageIncludes: '',
      scene: '',
      forbidden: '',
    },
    seriesStyleGuides: {
      listing: 'Warm studio style.',
      aplus: '',
    },
    styleCandidates: [
      {
        label: '信息图',
        description: '字体、色板和标注样式',
        prompt: 'Create a style board.',
        negativePrompt: 'Chinese characters',
      },
    ],
    styleImages: [],
    selectedStyleIndex: null,
    imagePlans: [
      {
        slot: 'MAIN',
        label: '主图',
        kind: 'main',
        planMarkdown: '主图策划',
        prompt: 'Create main image.',
        negativePrompt: 'text',
      },
    ],
    aPlusPlans: [],
    selectedPlanIndex: 0,
    selectedAPlusPlanIndex: null,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  }
}

function importFile(data: ExportData): File {
  const zipped = zipSync({ 'manifest.json': strToU8(JSON.stringify(data)) })
  const buffer = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength)
  return { arrayBuffer: async () => buffer } as File
}

describe('mask draft lifecycle in store actions', () => {
  beforeEach(() => {
    useStore.setState({
      settings: settingsWithConfiguredImageProfile(),
      prompt: 'prompt',
      inputImages: [],
      maskDraft: null,
      maskEditorImageId: null,
      seedreamEditorDraft: {
        engine: 'home',
        sourceImageId: null,
        referenceImageIds: [],
        instruction: '',
        annotations: [],
        resolution: '2k',
        latestTaskId: null,
        updatedAt: 0,
      },
      params: { ...DEFAULT_PARAMS },
      pendingTaskCategory: null,
      tasks: [],
      detailTaskId: null,
      lightboxImageId: null,
      lightboxImageList: [],
      showSettings: false,
      toast: null,
      confirmDialog: null,
      showToast: vi.fn(),
      setConfirmDialog: vi.fn(),
    })
  })

  it('opens an output in the isolated image editor without changing the home draft', async () => {
    await putImage(imageB)
    const maskDraft = {
      targetImageId: imageA.id,
      maskDataUrl: 'data:image/png;base64,mask',
      updatedAt: 1,
    }
    useStore.setState({
      prompt: 'old prompt',
      inputImages: [imageA],
      maskDraft,
      maskEditorImageId: imageA.id,
    })

    await editOutputs(task({ outputImages: [imageB.id] }))

    const state = useStore.getState()
    expect(state.prompt).toBe('old prompt')
    expect(state.inputImages).toEqual([imageA])
    expect(state.maskDraft).toEqual(maskDraft)
    expect(state.maskEditorImageId).toBe(imageA.id)
    expect(state.seedreamEditorDraft).toMatchObject({
      sourceImageId: imageB.id,
      instruction: '',
      annotations: [],
      latestTaskId: null,
    })
  })

  it('clears an invalid mask draft when submit cannot find the mask target image', async () => {
    useStore.setState({
      inputImages: [imageA],
      maskDraft: {
        targetImageId: 'missing-image',
        maskDataUrl: 'data:image/png;base64,mask',
        updatedAt: 1,
      },
    })

    await submitTask()

    expect(useStore.getState().maskDraft).toBeNull()
  })

  it('shows a submitted toast after creating a gallery task', async () => {
    const submitted = await submitTask()

    const state = useStore.getState()
    expect(submitted).toBe(true)
    expect(state.tasks).toHaveLength(1)
    expect(state.showToast).toHaveBeenCalledWith('任务已提交', 'success')
  })

  it.each([
    { apiMode: 'chat' as const, model: 'deepseek-v4-flash', label: 'Chat Completions' },
    { apiMode: 'responses' as const, model: DEFAULT_RESPONSES_MODEL, label: 'Responses API' },
  ])('keeps a text-only $label profile in the planner role instead of the image role', async ({ apiMode, model }) => {
    const plannerProfile = createDefaultOpenAIProfile({
      id: `planner-profile-${apiMode}`,
      name: 'AI策划',
      apiKey: 'planner-key',
      apiMode,
      model,
    })
    const migratedSettings = normalizeSettings({
      profiles: [plannerProfile],
      activeProfileId: plannerProfile.id,
    })
    useStore.setState({ settings: migratedSettings })

    const submitted = await submitTask()

    const state = useStore.getState()
    expect(submitted).toBe(false)
    expect(state.tasks).toHaveLength(0)
    expect(migratedSettings.activeProfileId).not.toBe(plannerProfile.id)
    expect(migratedSettings.profiles.find((profile) => profile.id === migratedSettings.activeProfileId)?.apiMode).toBe('images')
    expect(migratedSettings.amazonPlannerProfileId).toBe(plannerProfile.id)
    expect(state.showToast).toHaveBeenCalledWith('请先完善请求 API 配置：缺少 API Key', 'error')
    expect(state.setConfirmDialog).not.toHaveBeenCalledWith(expect.objectContaining({ title: '当前配置不能生图' }))
  })

  it('allows gallery submit when the active Chat Completions profile is an OpenRouter image model', async () => {
    const openRouterProfile = createDefaultOpenAIProfile({
      id: 'openrouter-image',
      name: 'OpenRouter 生图',
      apiKey: 'openrouter-key',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiMode: 'chat',
      model: 'google/gemini-2.5-flash-image',
    })
    useStore.setState({
      settings: normalizeSettings({
        profiles: [openRouterProfile],
        activeProfileId: openRouterProfile.id,
      }),
    })

    const submitted = await submitTask()

    const state = useStore.getState()
    expect(submitted).toBe(true)
    expect(state.tasks).toHaveLength(1)
    expect(state.setConfirmDialog).not.toHaveBeenCalledWith(expect.objectContaining({
      title: '当前配置不能生图',
    }))
  })

  it('requires the migrated fallback image profile to be configured before retrying', async () => {
    const responseProfile = createDefaultOpenAIProfile({
      id: 'responses-profile',
      name: 'AI策划',
      apiKey: 'planner-key',
      apiMode: 'responses',
      model: DEFAULT_RESPONSES_MODEL,
    })
    useStore.setState({
      settings: normalizeSettings({
        profiles: [responseProfile],
        activeProfileId: responseProfile.id,
      }),
    })

    await retryTask(task())

    const state = useStore.getState()
    expect(state.tasks).toHaveLength(0)
    expect(state.setConfirmDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: '首页生图配置不可用',
      message: expect.stringContaining('缺少 API Key'),
    }))
  })

  it('returns false when submit is blocked before creating a task', async () => {
    useStore.setState({ prompt: '' })

    const submitted = await submitTask()

    const state = useStore.getState()
    expect(submitted).toBe(false)
    expect(state.tasks).toHaveLength(0)
    expect(state.showToast).toHaveBeenCalledWith('请输入提示词', 'error')
  })

  it('stores pending Amazon Listing category when the submitted prompt still matches', async () => {
    useStore.setState({
      prompt: 'listing prompt',
      pendingTaskCategory: {
        mode: 'prompt-match',
        prompt: 'listing prompt',
        category: {
          productTitle: 'Large Folding Umbrella',
          workflow: 'amazon-listing',
          amazonSlot: 'MAIN',
        },
      },
    })

    await submitTask()

    const state = useStore.getState()
    expect(state.tasks[0]?.category).toMatchObject({
      productTitle: 'Large Folding Umbrella',
      workflow: 'amazon-listing',
      amazonSlot: 'MAIN',
    })
    expect(state.pendingTaskCategory).toBeNull()
  })

  it('stores pending Amazon A+ category when the submitted prompt still matches', async () => {
    useStore.setState({
      prompt: 'aplus prompt',
      pendingTaskCategory: {
        mode: 'prompt-match',
        prompt: 'aplus prompt',
        category: {
          productTitle: 'LED Desk Lamp',
          workflow: 'amazon-aplus',
          amazonSlot: 'A+S01',
          aPlusType: 'standard',
        },
      },
    })

    await submitTask()

    expect(useStore.getState().tasks[0]?.category).toMatchObject({
      productTitle: 'LED Desk Lamp',
      workflow: 'amazon-aplus',
      amazonSlot: 'A+S01',
      aPlusType: 'standard',
    })
  })

  it('appends a hidden style reference image when the submitted Amazon non-main prompt matches', async () => {
    const styleImage = { id: 'style-reference-image', dataUrl: 'data:image/png;base64,style' }
    await putImage(imageA)
    await putImage(styleImage)
    useStore.setState({
      prompt: 'listing prompt',
      inputImages: [imageA],
      pendingTaskCategory: {
        mode: 'prompt-match',
        prompt: 'listing prompt',
        category: {
          productTitle: 'Large Folding Umbrella',
          workflow: 'amazon-listing',
          amazonSlot: 'PT01',
          styleReferenceImageId: styleImage.id,
        },
      },
    })

    await submitTask()

    const task = useStore.getState().tasks[0]
    expect(task?.inputImageIds).toEqual([imageA.id, styleImage.id])
    expect(task?.category).toMatchObject({
      workflow: 'amazon-listing',
      amazonSlot: 'PT01',
      styleReferenceImageId: styleImage.id,
    })
  })

  it('uses only the currently selected uploaded style reference after replacing a preset', async () => {
    const oldPresetImage = { id: 'old-preset-style-image', dataUrl: 'data:image/png;base64,old-preset' }
    const uploadedStyleImage = { id: 'uploaded-style-image', dataUrl: 'data:image/webp;base64,uploaded' }
    await putImage(imageA)
    await putImage(oldPresetImage)
    await putImage(uploadedStyleImage)
    useStore.setState({
      prompt: 'listing prompt with uploaded style',
      inputImages: [imageA],
      pendingTaskCategory: {
        mode: 'prompt-match',
        prompt: 'listing prompt with uploaded style',
        category: {
          productTitle: 'Large Folding Umbrella',
          workflow: 'amazon-listing',
          amazonSlot: 'PT01',
          styleReferenceImageId: uploadedStyleImage.id,
        },
      },
    })

    await submitTask()

    const task = useStore.getState().tasks[0]
    expect(task?.inputImageIds).toEqual([imageA.id, uploadedStyleImage.id])
    expect(task?.inputImageIds).not.toContain(oldPresetImage.id)
    expect(task?.category?.styleReferenceImageId).toBe(uploadedStyleImage.id)
  })

  it('does not append a hidden style reference image for an Amazon MAIN prompt', async () => {
    const styleImage = { id: 'style-reference-image', dataUrl: 'data:image/png;base64,style' }
    await putImage(imageA)
    await putImage(styleImage)
    useStore.setState({
      prompt: 'listing prompt',
      inputImages: [imageA],
      pendingTaskCategory: {
        mode: 'prompt-match',
        prompt: 'listing prompt',
        category: {
          productTitle: 'Large Folding Umbrella',
          workflow: 'amazon-listing',
          amazonSlot: 'MAIN',
          styleReferenceImageId: styleImage.id,
        },
      },
    })

    await submitTask()

    const task = useStore.getState().tasks[0]
    expect(task?.inputImageIds).toEqual([imageA.id])
    expect(task?.category).toMatchObject({
      workflow: 'amazon-listing',
      amazonSlot: 'MAIN',
    })
    expect(task?.category).not.toHaveProperty('styleReferenceImageId')
  })

  it('blocks submit when visible references plus hidden style reference exceed the API image limit', async () => {
    const styleImage = { id: 'style-reference-image', dataUrl: 'data:image/png;base64,style' }
    await putImage(styleImage)
    const inputImages = Array.from({ length: 16 }, (_, index) => ({
      id: `product-reference-${index + 1}`,
      dataUrl: `data:image/png;base64,product-${index + 1}`,
    }))
    useStore.setState({
      prompt: 'listing prompt',
      inputImages,
      pendingTaskCategory: {
        mode: 'prompt-match',
        prompt: 'listing prompt',
        category: {
          productTitle: 'Large Folding Umbrella',
          workflow: 'amazon-listing',
          amazonSlot: 'PT01',
          styleReferenceImageId: styleImage.id,
        },
      },
    })

    await submitTask()

    expect(useStore.getState().tasks).toHaveLength(0)
    expect(useStore.getState().showToast).toHaveBeenCalledWith(expect.stringContaining('实际参考图数量不能超过 16 张'), 'error')
  })

  it('does not apply stale pending category after the prompt changes', async () => {
    useStore.setState({
      prompt: 'changed prompt',
      pendingTaskCategory: {
        mode: 'prompt-match',
        prompt: 'original prompt',
        category: {
          productTitle: 'Large Folding Umbrella',
          workflow: 'amazon-listing',
          amazonSlot: 'MAIN',
        },
      },
    })

    await submitTask()

    expect(useStore.getState().tasks[0]?.category).toEqual({ workflow: 'gallery' })
  })

  it('preserves reused Listing category on the next submit even after editing the prompt', async () => {
    await reuseConfig(task({
      prompt: 'original listing prompt',
      category: {
        productTitle: 'Large Folding Umbrella',
        workflow: 'amazon-listing',
        amazonSlot: 'PT02',
        marketplaceId: 'jp',
      },
    }))

    useStore.getState().setPrompt('revised listing prompt')
    await submitTask()

    const state = useStore.getState()
    expect(state.tasks[0]?.category).toMatchObject({
      productTitle: 'Large Folding Umbrella',
      workflow: 'amazon-listing',
      amazonSlot: 'PT02',
      marketplaceId: 'jp',
    })
    expect(state.pendingTaskCategory).toBeNull()
  })

  it('does not leak an image-editor launch category into the next home submit', async () => {
    const outputImage = { id: 'listing-output-image', dataUrl: 'data:image/png;base64,listing-output' }
    await clearImages()
    await putImage(outputImage)

    await editOutputs(task({
      outputImages: [outputImage.id],
      category: {
        productTitle: 'Large Folding Umbrella',
        workflow: 'amazon-listing',
        amazonSlot: 'MAIN',
      },
    }))

    useStore.getState().setPrompt('edit this listing image')
    await submitTask()

    expect(useStore.getState().tasks[0]?.category).toEqual({ workflow: 'gallery' })
  })

  it('preserves reused A+ category and type on the next submit', async () => {
    await reuseConfig(task({
      prompt: 'original aplus prompt',
      category: {
        productTitle: 'LED Desk Lamp',
        workflow: 'amazon-aplus',
        amazonSlot: 'A+S01',
        aPlusType: 'standard',
      },
    }))

    useStore.getState().setPrompt('revised aplus prompt')
    await submitTask()

    expect(useStore.getState().tasks[0]?.category).toMatchObject({
      productTitle: 'LED Desk Lamp',
      workflow: 'amazon-aplus',
      amazonSlot: 'A+S01',
      aPlusType: 'standard',
    })
  })

  it('replacing a stale Amazon pending category with a normal reused task submits as gallery', async () => {
    useStore.setState({
      pendingTaskCategory: {
        mode: 'next-submit',
        category: {
          productTitle: 'Large Folding Umbrella',
          workflow: 'amazon-listing',
          amazonSlot: 'MAIN',
        },
      },
    })

    await reuseConfig(task({
      prompt: 'regular prompt',
      category: { workflow: 'gallery' },
    }))

    useStore.getState().setPrompt('changed regular prompt')
    await submitTask()

    expect(useStore.getState().tasks[0]?.category).toEqual({ workflow: 'gallery' })
  })

  it('preserves selected image mentions when replacing a mask target with an equivalent image id', () => {
    const replacement = { id: 'image-a-replacement', dataUrl: imageA.dataUrl }
    const prompt = `参考 ${getSelectedImageMentionLabel(0)} 生成`
    useStore.setState({
      prompt,
      inputImages: [imageA, imageB],
    })

    useStore.getState().setInputImages([replacement, imageB], {
      equivalentImageIds: { [imageA.id]: replacement.id },
    })

    const state = useStore.getState()
    expect(state.inputImages.map((img) => img.id)).toEqual([replacement.id, imageB.id])
    expect(state.prompt).toBe(prompt)
  })
})

describe('interrupted OpenAI running tasks', () => {
  it('marks legacy and OpenAI running tasks as interrupted', () => {
    const now = 10_000
    const legacyRunning = task({ id: 'legacy-running', status: 'running', createdAt: 1_000, finishedAt: null, elapsed: null })
    const openAIRunning = task({ id: 'openai-running', apiProvider: 'openai', status: 'running', createdAt: 2_000, finishedAt: null, elapsed: null })
    const falRunning = task({ id: 'fal-running', apiProvider: 'fal', status: 'running', createdAt: 3_000, finishedAt: null, elapsed: null })
    const customAsyncRunning = task({ id: 'custom-running', apiProvider: 'custom-provider', customTaskId: 'task-1', status: 'running', createdAt: 4_000, finishedAt: null, elapsed: null })
    const doneTask = task({ id: 'done-task', apiProvider: 'openai', status: 'done' })

    const result = markInterruptedOpenAIRunningTasks([legacyRunning, openAIRunning, falRunning, customAsyncRunning, doneTask], now)

    expect(result.interruptedTasks.map((item) => item.id)).toEqual(['legacy-running', 'openai-running'])
    expect(result.tasks.find((item) => item.id === 'legacy-running')).toMatchObject({
      status: 'error',
      error: expect.stringContaining('请求中断'),
      finishedAt: now,
      elapsed: 9_000,
    })
    expect(result.tasks.find((item) => item.id === 'openai-running')).toMatchObject({
      status: 'error',
      error: expect.stringContaining('请求中断'),
      finishedAt: now,
      elapsed: 8_000,
    })
    expect(result.tasks.find((item) => item.id === 'fal-running')).toEqual(falRunning)
    expect(result.tasks.find((item) => item.id === 'custom-running')).toEqual(customAsyncRunning)
    expect(result.tasks.find((item) => item.id === 'done-task')).toEqual(doneTask)
  })
})

describe('input persistence setting', () => {
  beforeEach(() => {
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS },
      appMode: 'gallery',
      prompt: 'prompt',
      inputImages: [imageA],
      galleryInputDraft: null,
      dismissedCodexCliPrompts: [],
    })
  })

  it('persists input when restart input restore is enabled', () => {
    const persisted = getPersistedState(useStore.getState())

    expect(persisted.prompt).toBe('prompt')
    expect(persisted.inputImages).toEqual([{ id: imageA.id, dataUrl: '' }])
  })

  it('omits input when restart input restore is disabled', () => {
    useStore.setState({ settings: { ...DEFAULT_SETTINGS, persistInputOnRestart: false } })

    const persisted = getPersistedState(useStore.getState())

    expect(persisted).not.toHaveProperty('prompt')
    expect(persisted).not.toHaveProperty('inputImages')
  })

  it('writes empty input when persisted input is cleared', () => {
    useStore.setState({ prompt: '', inputImages: [] })

    const persisted = getPersistedState(useStore.getState())

    expect(persisted.prompt).toBe('')
    expect(persisted.inputImages).toEqual([])
  })
})

describe('agent conversation creation', () => {
  beforeEach(() => {
    useStore.setState({
      agentConversations: [],
      activeAgentConversationId: null,
      agentSidebarCollapsed: false,
      agentEditingRoundId: null,
    })
  })

  it('refreshes the latest empty conversation instead of creating another one', () => {
    const olderEmpty = agentConversation({ id: 'older-empty', createdAt: 1_000, updatedAt: 1_000 })
    const latestEmpty = agentConversation({ id: 'latest-empty', createdAt: 2_000, updatedAt: 2_000 })
    const now = vi.spyOn(Date, 'now').mockReturnValue(3_000)
    useStore.setState({
      agentConversations: [olderEmpty, latestEmpty],
      activeAgentConversationId: olderEmpty.id,
      agentSidebarCollapsed: false,
      agentEditingRoundId: 'editing-round',
    })

    const id = useStore.getState().createAgentConversation()

    const state = useStore.getState()
    expect(id).toBe(latestEmpty.id)
    expect(state.activeAgentConversationId).toBe(latestEmpty.id)
    expect(state.agentConversations).toHaveLength(2)
    expect(state.agentConversations.find((item) => item.id === latestEmpty.id)).toMatchObject({
      createdAt: 3_000,
      updatedAt: 3_000,
    })
    expect(state.agentConversations.find((item) => item.id === olderEmpty.id)).toEqual(olderEmpty)
    expect(state.agentSidebarCollapsed).toBe(true)
    expect(state.agentEditingRoundId).toBeNull()
    now.mockRestore()
  })

  it('creates a new conversation when the latest conversation has messages', () => {
    const olderEmpty = agentConversation({ id: 'older-empty', createdAt: 1_000, updatedAt: 1_000 })
    const latestUsed = agentConversation({
      id: 'latest-used',
      activeRoundId: 'round-a',
      createdAt: 2_000,
      updatedAt: 2_000,
      rounds: [{
        id: 'round-a',
        index: 1,
        parentRoundId: null,
        userMessageId: 'message-a',
        prompt: 'prompt',
        inputImageIds: [],
        outputTaskIds: [],
        status: 'done',
        error: null,
        createdAt: 2_000,
        finishedAt: 2_000,
      }],
      messages: [{ id: 'message-a', role: 'user', content: 'prompt', roundId: 'round-a', createdAt: 2_000 }],
    })
    const now = vi.spyOn(Date, 'now').mockReturnValue(3_000)
    useStore.setState({ agentConversations: [olderEmpty, latestUsed], activeAgentConversationId: latestUsed.id })

    const id = useStore.getState().createAgentConversation()

    const state = useStore.getState()
    expect(id).not.toBe(olderEmpty.id)
    expect(id).not.toBe(latestUsed.id)
    expect(state.agentConversations).toHaveLength(3)
    expect(state.agentConversations[state.agentConversations.length - 1]).toMatchObject({ id, createdAt: 3_000, updatedAt: 3_000, messages: [], rounds: [] })
    expect(state.activeAgentConversationId).toBe(id)
    now.mockRestore()
  })
})

describe('data import', () => {
  beforeEach(async () => {
    await clearAmazonPlannerSessions()
    useStore.setState({
      tasks: [],
      agentConversations: [],
      activeAgentConversationId: null,
      showToast: vi.fn(),
    })
  })

  it('skips empty agent conversations when importing task data', async () => {
    const usedConversation = agentConversation({
      id: 'used-conversation',
      activeRoundId: 'round-a',
      rounds: [{
        id: 'round-a',
        index: 1,
        parentRoundId: null,
        userMessageId: 'message-a',
        prompt: 'prompt',
        inputImageIds: [],
        outputTaskIds: [],
        status: 'done',
        error: null,
        createdAt: 1,
        finishedAt: 2,
      }],
      messages: [{ id: 'message-a', role: 'user', content: 'prompt', roundId: 'round-a', createdAt: 1 }],
    })

    const imported = await importData(importFile({
      version: 3,
      exportedAt: new Date(0).toISOString(),
      tasks: [],
      agentConversations: [
        agentConversation({ id: 'empty-conversation' }),
        usedConversation,
      ],
      imageFiles: {},
    }), { importConfig: false, importTasks: true })

    const state = useStore.getState()
    expect(imported).toBe(true)
    expect(state.agentConversations.map((conversation) => conversation.id)).toEqual(['used-conversation'])
    expect(state.activeAgentConversationId).toBe('used-conversation')
  })

  it('merges imported agent conversations without replacing local conversations', async () => {
    const localConversation = agentConversation({
      id: 'local-conversation',
      title: '本地对话',
      createdAt: 1,
      updatedAt: 1,
    })
    const importedConversation = agentConversation({
      id: 'imported-conversation',
      activeRoundId: 'round-a',
      rounds: [{
        id: 'round-a',
        index: 1,
        parentRoundId: null,
        userMessageId: 'message-a',
        prompt: 'imported prompt',
        inputImageIds: [],
        outputTaskIds: [],
        status: 'done',
        error: null,
        createdAt: 2,
        finishedAt: 3,
      }],
      messages: [{ id: 'message-a', role: 'user', content: 'imported prompt', roundId: 'round-a', createdAt: 2 }],
    })
    useStore.setState({
      agentConversations: [localConversation],
      activeAgentConversationId: localConversation.id,
    })

    const imported = await importData(importFile({
      version: 3,
      exportedAt: new Date(0).toISOString(),
      tasks: [],
      agentConversations: [importedConversation],
      imageFiles: {},
    }), { importConfig: false, importTasks: true })

    const state = useStore.getState()
    expect(imported).toBe(true)
    expect(state.agentConversations.map((conversation) => conversation.id)).toEqual(['local-conversation', 'imported-conversation'])
    expect(state.activeAgentConversationId).toBe('local-conversation')
  })

  it('imports Amazon planner session history with task data', async () => {
    const session = amazonPlannerSession({
      id: 'imported-planner-session',
      referenceImageIds: ['image-a'],
      selectedStylePresetId: 'clean-tech',
      selectedStyleReferenceImageId: 'preset-style-image',
      styleImages: [{ candidateIndex: 0, imageId: 'style-image-a' }],
      selectedStyleIndex: 0,
    })

    const imported = await importData(importFile({
      version: 4,
      exportedAt: new Date(0).toISOString(),
      tasks: [],
      amazonPlannerSessions: [session],
      imageFiles: {},
    }), { importConfig: false, importTasks: true })

    expect(imported).toBe(true)
    expect(await getAllAmazonPlannerSessions()).toEqual([session])
    expect(useStore.getState().showToast).toHaveBeenCalledWith('已导入 0 条记录和 1 条策划历史', 'success')
  })

  it('imports custom style references with config data', async () => {
    useStore.setState({ settings: { ...DEFAULT_SETTINGS } })

    const imported = await importData(importFile({
      version: 4,
      exportedAt: new Date(0).toISOString(),
      settings: normalizeSettings({
        customStyleReferences: [
          {
            id: 'custom-style-a',
            basePresetId: 'clean-tech',
            title: 'Custom clean style',
            editState: {
              title: 'Custom clean style',
              palette: ['#FFFFFF', '#E5E7EB', '#111827', '#2563EB', '#16A34A', '#F97316'],
              typography: 'Clean sans',
              lighting: 'Soft light',
              material: 'Satin panels',
              density: 'rich',
            },
            imageId: 'custom-style-image',
            createdAt: 1,
            updatedAt: 2,
          },
        ],
      }),
    }), { importConfig: true, importTasks: false })

    expect(imported).toBe(true)
    expect(useStore.getState().settings.customStyleReferences).toHaveLength(1)
    expect(useStore.getState().settings.customStyleReferences[0]).toMatchObject({
      id: 'custom-style-a',
      imageId: 'custom-style-image',
    })
  })
})

describe('Seedream editor state and submission', () => {
  const homeProfile = createDefaultOpenAIProfile({ id: 'home-profile', apiKey: 'openai-key' })
  const editorProfile = createDefaultVolcengineProfile({ id: 'editor-profile', apiKey: 'ark-key' })

  beforeEach(async () => {
    await clearImages()
    vi.mocked(callImageApi).mockClear()
    useStore.setState({
      settings: normalizeSettings({
        profiles: [homeProfile, editorProfile],
        activeProfileId: homeProfile.id,
        seedreamEditorProfileId: editorProfile.id,
      }),
      prompt: 'home prompt',
      inputImages: [imageA],
      tasks: [],
      seedreamEditorDraft: {
        engine: 'home',
        sourceImageId: null,
        referenceImageIds: [],
        instruction: '',
        annotations: [],
        resolution: '2k',
        latestTaskId: null,
        updatedAt: 0,
      },
      showToast: vi.fn(),
    })
  })

  it('persists and restores image IDs, vector annotations, resolution, and latest task', () => {
    useStore.getState().setSeedreamEditorDraft({
      engine: 'seedream',
      sourceImageId: 'source-image',
      referenceImageIds: ['ref-a', 'ref-b'],
      instruction: '删除标签',
      annotations: [{
        id: 'annotation-a',
        kind: 'rectangle',
        color: '#ef4444',
        width: 0.006,
        points: [{ x: 0.2, y: 0.3 }, { x: 0.7, y: 0.8 }],
      }],
      resolution: '4k',
      latestTaskId: 'task-latest',
    })

    const persisted = getPersistedState(useStore.getState())
    const restored = mergePersistedState(persisted, useStore.getState())

    expect(restored.seedreamEditorDraft).toMatchObject({
      engine: 'seedream',
      sourceImageId: 'source-image',
      referenceImageIds: ['ref-a', 'ref-b'],
      instruction: '删除标签',
      resolution: '4k',
      latestTaskId: 'task-latest',
    })
    expect(restored.seedreamEditorDraft.annotations[0]).toMatchObject({ id: 'annotation-a', kind: 'rectangle' })
  })

  it('submits through the editor profile without changing the home active profile', async () => {
    const source = { id: 'source-image', dataUrl: 'data:image/png;base64,c291cmNl' }
    const guide = { id: 'guide-image', dataUrl: 'data:image/png;base64,Z3VpZGU=' }
    const reference = { id: 'reference-image', dataUrl: 'data:image/png;base64,cmVm' }
    await Promise.all([putImage(source), putImage(guide), putImage(reference)])

    const taskId = await submitTaskWithInput({
      apiProfileId: editorProfile.id,
      prompt: 'role prompt',
      inputImages: [source, guide, reference],
      params: { ...DEFAULT_PARAMS, size: '4K', n: 1 },
      category: { workflow: 'seedream-edit' },
      imageEditContext: {
        engine: 'seedream',
        sourceImageId: source.id,
        visualGuideImageId: guide.id,
        referenceImageIds: [reference.id],
        userInstruction: '替换框选的杯子',
      },
    })

    const state = useStore.getState()
    const submitted = state.tasks.find((item) => item.id === taskId)
    expect(state.settings.activeProfileId).toBe(homeProfile.id)
    expect(submitted).toMatchObject({
      apiProfileId: editorProfile.id,
      apiProvider: 'volcengine',
      inputImageIds: [source.id, guide.id, reference.id],
      params: { size: '4K', n: 1 },
      category: { workflow: 'seedream-edit' },
      imageEditContext: {
        engine: 'seedream',
        sourceImageId: source.id,
        visualGuideImageId: guide.id,
        referenceImageIds: [reference.id],
        userInstruction: '替换框选的杯子',
      },
    })
    await vi.waitFor(() => expect(callImageApi).toHaveBeenCalled())
    expect(vi.mocked(callImageApi).mock.calls[0][0].inputImageDataUrls).toEqual([
      source.dataUrl,
      guide.dataUrl,
      reference.dataUrl,
    ])
  })

  it('submits an image edit through the active home generation profile', async () => {
    const source = { id: 'gpt-source', dataUrl: 'data:image/png;base64,Z3B0LXNvdXJjZQ==' }
    const reference = { id: 'gpt-reference', dataUrl: 'data:image/png;base64,Z3B0LXJlZg==' }
    await Promise.all([putImage(source), putImage(reference)])

    const taskId = await submitTaskWithInput({
      apiProfileId: homeProfile.id,
      prompt: 'edit with the home image API',
      inputImages: [source, reference],
      params: { ...DEFAULT_PARAMS, size: '2048x2048', n: 1 },
      category: { workflow: 'seedream-edit' },
      imageEditContext: {
        engine: 'home',
        sourceImageId: source.id,
        visualGuideImageId: null,
        referenceImageIds: [reference.id],
        userInstruction: '把产品改成蓝色',
      },
    })

    const submitted = useStore.getState().tasks.find((item) => item.id === taskId)
    expect(useStore.getState().settings.activeProfileId).toBe(homeProfile.id)
    expect(submitted).toMatchObject({
      apiProfileId: homeProfile.id,
      apiProvider: 'openai',
      inputImageIds: [source.id, reference.id],
      category: { workflow: 'seedream-edit' },
      imageEditContext: { engine: 'home' },
    })
    await vi.waitFor(() => expect(callImageApi).toHaveBeenCalled())
    const imageApiCalls = vi.mocked(callImageApi).mock.calls
    expect(imageApiCalls[imageApiCalls.length - 1]?.[0].inputImageDataUrls).toEqual([
      source.dataUrl,
      reference.dataUrl,
    ])
  })

  it('retries a GPT editor task without requiring a Seedream profile', async () => {
    const source = { id: 'retry-source', dataUrl: 'data:image/png;base64,cmV0cnk=' }
    await putImage(source)
    const failedTask = task({
      id: 'gpt-edit-failed',
      prompt: 'edit with GPT',
      params: { ...DEFAULT_PARAMS, size: '2048x2048' },
      apiProvider: 'openai',
      apiProfileId: homeProfile.id,
      apiProfileName: homeProfile.name,
      apiMode: homeProfile.apiMode,
      apiModel: homeProfile.model,
      inputImageIds: [source.id],
      status: 'error',
      error: 'network error',
      category: { workflow: 'seedream-edit' },
      imageEditContext: {
        engine: 'home',
        sourceImageId: source.id,
        referenceImageIds: [],
        userInstruction: '保留主体并改色',
      },
    })
    useStore.setState({ tasks: [failedTask] })

    await retryTask(failedTask)

    const retried = useStore.getState().tasks.find((item) => item.id !== failedTask.id)
    expect(retried).toMatchObject({
      apiProvider: 'openai',
      apiProfileId: homeProfile.id,
      imageEditContext: { engine: 'home' },
    })
    expect(useStore.getState().seedreamEditorDraft).toMatchObject({
      engine: 'home',
      latestTaskId: retried?.id,
    })
  })

  it('restores a Seedream task into the editor instead of the home input', () => {
    openSeedreamTaskInEditor(task({
      id: 'seedream-task',
      prompt: 'role prompt',
      params: { ...DEFAULT_PARAMS, size: '4K' },
      category: { workflow: 'seedream-edit' },
      inputImageIds: ['source-image', 'guide-image', 'ref-a'],
      imageEditContext: {
        engine: 'seedream',
        sourceImageId: 'source-image',
        visualGuideImageId: 'guide-image',
        referenceImageIds: ['ref-a'],
        userInstruction: '把杯子改成绿色',
      },
    }))

    const state = useStore.getState()
    expect(state.prompt).toBe('home prompt')
    expect(state.inputImages).toEqual([imageA])
    expect(state.seedreamEditorDraft).toMatchObject({
      engine: 'seedream',
      sourceImageId: 'source-image',
      referenceImageIds: ['ref-a'],
      instruction: '把杯子改成绿色',
      annotations: [],
      resolution: '4k',
      latestTaskId: 'seedream-task',
    })
  })
})

describe('data export and clearing', () => {
  beforeEach(async () => {
    await clearAmazonPlannerSessions()
    await clearImages()
    useStore.setState({
      tasks: [],
      agentConversations: [],
      activeAgentConversationId: null,
      settings: settingsWithConfiguredImageProfile(),
      showToast: vi.fn(),
    })
  })

  it('exports Amazon planner session history in the backup manifest', async () => {
    const session = amazonPlannerSession({
      id: 'exported-planner-session',
      referenceImageIds: ['image-a'],
      selectedStylePresetId: 'clean-tech',
      selectedStyleReferenceImageId: 'preset-style-image',
      styleImages: [{ candidateIndex: 0, imageId: 'style-image-a' }],
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    })
    await putAmazonPlannerSession(session)
    await putImage({ id: 'image-a', dataUrl: 'data:image/png;base64,YQ==', createdAt: 1_700_000_000_000, source: 'upload' })
    await putImage({ id: 'preset-style-image', dataUrl: 'data:image/png;base64,Yw==', createdAt: 1_700_000_000_000, source: 'preset' })
    await putImage({ id: 'style-image-a', dataUrl: 'data:image/png;base64,Yg==', createdAt: 1_700_000_000_000, source: 'generated' })

    const clickedDownloads: Array<{ download?: string; href?: string }> = []
    const anchor = {
      href: '',
      download: '',
      click: vi.fn(() => {
        clickedDownloads.push({ download: anchor.download, href: anchor.href })
      }),
    }
    vi.stubGlobal('document', {
      createElement: vi.fn(() => anchor),
    })
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:backup')
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    await exportData({ exportConfig: false, exportTasks: true })

    expect(useStore.getState().showToast).not.toHaveBeenCalledWith(expect.stringContaining('导出失败'), 'error')
    const blob = createObjectUrl.mock.calls[0]?.[0] as Blob
    const buffer = await blob.arrayBuffer()
    const unzipped = unzipSync(new Uint8Array(buffer))
    const manifest = JSON.parse(strFromU8(unzipped['manifest.json'])) as ExportData
    expect(manifest.version).toBe(4)
    expect(manifest.amazonPlannerSessions).toEqual([session])
    expect(manifest.imageFiles).toHaveProperty('image-a')
    expect(manifest.imageFiles).toHaveProperty('preset-style-image')
    expect(manifest.imageFiles).toHaveProperty('style-image-a')
    expect(manifest.imageFiles?.['preset-style-image']?.source).toBe('preset')
    expect(clickedDownloads[0]?.download).toContain('amazon-image-studio-backup')

    createObjectUrl.mockRestore()
    revokeObjectUrl.mockRestore()
    vi.unstubAllGlobals()
  })

  it('exports custom style library config and referenced custom style images', async () => {
    const customStyle = {
      id: 'custom-style-a',
      basePresetId: 'clean-tech',
      title: 'Custom clean style',
      editState: {
        title: 'Custom clean style',
        palette: ['#FFFFFF', '#E5E7EB', '#111827', '#2563EB', '#16A34A', '#F97316'],
        typography: 'Clean sans',
        lighting: 'Soft light',
        material: 'Satin panels',
        density: 'rich' as const,
      },
      imageId: 'custom-style-image',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_100,
    }
    const session = amazonPlannerSession({
      id: 'custom-style-session',
      selectedStylePresetId: 'clean-tech',
      selectedStyleReferenceImageId: customStyle.imageId,
      selectedCustomStyleReferenceId: customStyle.id,
      selectedCustomStyleReferenceSnapshot: customStyle,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    })
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        customStyleReferences: [customStyle],
      }),
    })
    await putAmazonPlannerSession(session)
    await putImage({ id: customStyle.imageId, dataUrl: 'data:image/png;base64,Yw==', createdAt: 1_700_000_000_000, source: 'style-custom' })

    const anchor = { href: '', download: '', click: vi.fn() }
    vi.stubGlobal('document', {
      createElement: vi.fn(() => anchor),
    })
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:backup')
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    await exportData({ exportConfig: true, exportTasks: true })

    const blob = createObjectUrl.mock.calls[0]?.[0] as Blob
    const buffer = await blob.arrayBuffer()
    const unzipped = unzipSync(new Uint8Array(buffer))
    const manifest = JSON.parse(strFromU8(unzipped['manifest.json'])) as ExportData
    expect(manifest.settings?.customStyleReferences).toEqual([customStyle])
    expect(manifest.amazonPlannerSessions?.[0]).toMatchObject({
      selectedCustomStyleReferenceId: customStyle.id,
      selectedStyleReferenceImageId: customStyle.imageId,
    })
    expect(manifest.imageFiles?.[customStyle.imageId]?.source).toBe('style-custom')

    createObjectUrl.mockRestore()
    revokeObjectUrl.mockRestore()
    vi.unstubAllGlobals()
  })

  it('clears Amazon planner sessions when clearing task data', async () => {
    await putAmazonPlannerSession(amazonPlannerSession())

    await clearData({ clearConfig: false, clearTasks: true })

    expect(await getAllAmazonPlannerSessions()).toEqual([])
  })
})

describe('agent draft lifecycle', () => {
  const responsesProfile = createDefaultOpenAIProfile({ id: 'openai-responses', apiKey: 'openai-key', apiMode: 'responses' })
  const draftState = {
    prompt: `参考 ${getSelectedImageMentionLabel(0)} 生成`,
    inputImages: [imageA],
    maskDraft: {
      targetImageId: imageA.id,
      maskDataUrl: 'data:image/png;base64,mask',
      updatedAt: 1,
    },
    maskEditorImageId: imageA.id,
    agentEditingRoundId: 'round-a',
  }

  beforeEach(() => {
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        profiles: [responsesProfile],
        activeProfileId: responsesProfile.id,
      }),
      appMode: 'agent',
      agentConversations: [
        agentConversation({ id: 'conversation-a' }),
        agentConversation({ id: 'conversation-b' }),
      ],
      activeAgentConversationId: 'conversation-a',
      galleryInputDraft: null,
      agentInputDrafts: {},
      agentSidebarCollapsed: false,
      agentAssetPanelCollapsed: false,
      ...draftState,
    })
  })

  it('clears visible input but keeps the agent draft when returning to gallery mode', () => {
    useStore.getState().setAppMode('gallery')

    const state = useStore.getState()
    expect(state.appMode).toBe('gallery')
    expect(state.prompt).toBe('')
    expect(state.inputImages).toEqual([])
    expect(state.maskDraft).toBeNull()
    expect(state.maskEditorImageId).toBeNull()
    expect(state.agentEditingRoundId).toBeNull()
    expect(state.agentInputDrafts['conversation-a']).toMatchObject({
      prompt: draftState.prompt,
      inputImages: draftState.inputImages,
      maskDraft: draftState.maskDraft,
      maskEditorImageId: imageA.id,
    })
  })

  it('does not enter agent mode when requested from gallery mode', () => {
    useStore.getState().setAppMode('gallery')
    useStore.getState().setAppMode('agent')

    const state = useStore.getState()
    expect(state.appMode).toBe('gallery')
    expect(state.prompt).toBe('')
    expect(state.inputImages).toEqual([])
    expect(state.maskDraft).toBeNull()
    expect(state.maskEditorImageId).toBeNull()
    expect(state.agentEditingRoundId).toBeNull()
    expect(state.agentInputDrafts['conversation-a']).toMatchObject({
      prompt: draftState.prompt,
      inputImages: draftState.inputImages,
      maskDraft: draftState.maskDraft,
      maskEditorImageId: imageA.id,
    })
  })

  it('normalizes persisted agent mode back to gallery while retaining agent drafts', () => {
    const merged = mergePersistedState({
      appMode: 'agent',
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        persistInputOnRestart: true,
      }),
      galleryInputDraft: {
        prompt: 'gallery draft',
        inputImages: [imageB],
        maskDraft: null,
        maskEditorImageId: null,
      },
      agentConversations: [agentConversation({ id: 'conversation-a' })],
      activeAgentConversationId: 'conversation-a',
      agentInputDrafts: {
        'conversation-a': {
          prompt: 'agent draft',
          inputImages: [imageA],
          maskDraft: null,
          maskEditorImageId: null,
          updatedAt: Date.now(),
        },
      },
    }, useStore.getState())

    expect(merged.appMode).toBe('gallery')
    expect(merged.prompt).toBe('gallery draft')
    expect(merged.inputImages).toEqual([imageB])
    expect(merged.agentInputDrafts['conversation-a']?.prompt).toBe('agent draft')
  })

  it('keeps the gallery draft when agent mode is requested', () => {
    const galleryPrompt = `画廊 ${getSelectedImageMentionLabel(0)} 草稿`
    useStore.setState({
      appMode: 'gallery',
      prompt: galleryPrompt,
      inputImages: [imageB],
      maskDraft: null,
      maskEditorImageId: null,
      galleryInputDraft: null,
      agentInputDrafts: {
        'conversation-a': {
          prompt: draftState.prompt,
          inputImages: draftState.inputImages,
          maskDraft: draftState.maskDraft,
          maskEditorImageId: imageA.id,
        },
      },
    })

    useStore.getState().setAppMode('agent')

    let state = useStore.getState()
    expect(state.appMode).toBe('gallery')
    expect(state.galleryInputDraft).toMatchObject({ prompt: galleryPrompt, inputImages: [imageB] })
    expect(state.prompt).toBe(galleryPrompt)
    expect(state.inputImages).toEqual([imageB])

    useStore.getState().setAppMode('gallery')

    state = useStore.getState()
    expect(state.appMode).toBe('gallery')
    expect(state.prompt).toBe(galleryPrompt)
    expect(state.inputImages).toEqual([imageB])
  })

  it('persists the gallery draft while agent mode is active', () => {
    const galleryPrompt = 'gallery draft'
    useStore.setState({
      appMode: 'agent',
      galleryInputDraft: {
        prompt: galleryPrompt,
        inputImages: [imageB],
        maskDraft: null,
        maskEditorImageId: null,
      },
    })

    const persisted = getPersistedState(useStore.getState())

    expect(persisted.prompt).toBe(galleryPrompt)
    expect(persisted.inputImages).toEqual([{ id: imageB.id, dataUrl: '' }])
  })

  it('clears stale mentions in the visible input when switching conversations', () => {
    useStore.getState().setActiveAgentConversationId('conversation-b')

    const state = useStore.getState()
    expect(state.activeAgentConversationId).toBe('conversation-b')
    expect(state.prompt).toBe('')
    expect(state.inputImages).toEqual([])
    expect(state.maskDraft).toBeNull()
    expect(state.maskEditorImageId).toBeNull()
    expect(state.agentEditingRoundId).toBeNull()
    expect(state.agentInputDrafts['conversation-a']?.prompt).toBe(draftState.prompt)
  })

  it('restores the previous conversation draft when switching back', () => {
    useStore.getState().setActiveAgentConversationId('conversation-b')
    useStore.getState().setActiveAgentConversationId('conversation-a')

    const state = useStore.getState()
    expect(state.activeAgentConversationId).toBe('conversation-a')
    expect(state.prompt).toBe(draftState.prompt)
    expect(state.inputImages).toEqual(draftState.inputImages)
    expect(state.maskDraft).toEqual(draftState.maskDraft)
    expect(state.maskEditorImageId).toBe(imageA.id)
    expect(state.agentEditingRoundId).toBeNull()
  })

  it('keeps the current draft when selecting the already active conversation', () => {
    useStore.getState().setActiveAgentConversationId('conversation-a')

    const state = useStore.getState()
    expect(state.prompt).toBe(draftState.prompt)
    expect(state.inputImages).toEqual(draftState.inputImages)
    expect(state.maskDraft).toEqual(draftState.maskDraft)
    expect(state.maskEditorImageId).toBe(imageA.id)
  })

  it('persists agent drafts separately from the gallery input draft', () => {
    const persisted = getPersistedState(useStore.getState())

    expect(persisted).not.toHaveProperty('prompt')
    expect(persisted.agentInputDrafts['conversation-a']).toMatchObject({
      prompt: draftState.prompt,
      inputImages: [{ id: imageA.id, dataUrl: '' }],
      maskDraft: draftState.maskDraft,
      maskEditorImageId: imageA.id,
    })
    expect(persisted.agentInputDrafts['conversation-a']?.updatedAt).toEqual(expect.any(Number))
  })

  it('removes stale agent drafts except the last active conversation', () => {
    const now = 10 * 24 * 60 * 60 * 1000
    const staleUpdatedAt = now - 3 * 24 * 60 * 60 * 1000 - 1
    const recentUpdatedAt = now - 3 * 24 * 60 * 60 * 1000
    const activeDraft = { prompt: 'active', inputImages: [], maskDraft: null, maskEditorImageId: null, updatedAt: staleUpdatedAt }
    const staleDraft = { prompt: 'stale', inputImages: [], maskDraft: null, maskEditorImageId: null, updatedAt: staleUpdatedAt }
    const recentDraft = { prompt: 'recent', inputImages: [], maskDraft: null, maskEditorImageId: null, updatedAt: recentUpdatedAt }

    const cleaned = cleanStaleAgentInputDrafts({
      'conversation-a': activeDraft,
      'conversation-b': staleDraft,
      'conversation-c': recentDraft,
    }, 'conversation-a', now)

    expect(cleaned).toEqual({
      'conversation-a': activeDraft,
      'conversation-c': recentDraft,
    })
  })

})

describe('agent context for removed outputs', () => {
  beforeEach(() => {
    const profile = createDefaultOpenAIProfile({
      id: 'responses-profile',
      apiKey: 'test-key',
      apiMode: 'responses',
      model: DEFAULT_RESPONSES_MODEL,
    })
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        apiMode: 'responses',
        model: DEFAULT_RESPONSES_MODEL,
        profiles: [profile],
        activeProfileId: profile.id,
      }),
      prompt: '继续',
      inputImages: [],
      maskDraft: null,
      params: { ...DEFAULT_PARAMS },
      appMode: 'agent',
      tasks: [task({
        id: 'task-live',
        outputImages: ['image-live'],
        sourceMode: 'agent',
        agentRoundId: 'round-a',
        agentToolCallId: 'live-call',
      })],
      agentConversations: [agentConversation({
        id: 'conversation-a',
        activeRoundId: 'round-a',
        rounds: [{
          id: 'round-a',
          index: 1,
          parentRoundId: null,
          userMessageId: 'user-a',
          assistantMessageId: 'assistant-a',
          prompt: '画两张图',
          inputImageIds: [],
          outputTaskIds: ['task-deleted', 'task-live'],
          responseOutput: [
            { type: 'message', content: [{ type: 'output_text', text: '已生成两张图。' }] },
            { type: 'image_generation_call', id: 'deleted-call', result: 'deleted-base64' },
            { type: 'image_generation_call', id: 'live-call', result: 'live-base64' },
          ],
          status: 'done',
          error: null,
          createdAt: 1,
          finishedAt: 2,
        }],
        messages: [
          { id: 'user-a', role: 'user', content: '画两张图', roundId: 'round-a', createdAt: 1 },
          { id: 'assistant-a', role: 'assistant', content: '已生成两张图。', roundId: 'round-a', outputTaskIds: ['task-deleted', 'task-live'], createdAt: 2 },
        ],
      })],
      activeAgentConversationId: 'conversation-a',
      agentEditingRoundId: null,
      showToast: vi.fn(),
    })
    vi.mocked(callAgentResponsesApi).mockClear()
    vi.mocked(callAgentResponsesApi).mockResolvedValue({
      text: 'ok',
      images: [],
      outputItems: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }],
      responseId: 'response-b',
    })
  })

  it('does not send removed image_generation results back to the model', async () => {
    await submitAgentMessage()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const input = vi.mocked(callAgentResponsesApi).mock.calls[0][0].input
    const serializedInput = JSON.stringify(input)
    expect(serializedInput).not.toContain('deleted-base64')
    expect(serializedInput).toContain('live-base64')
    expect(serializedInput).not.toContain('Generated image removed')
    expect(serializedInput).toContain('removed_ref')
    expect(serializedInput).toContain('round-1-image-1')
    expect(serializedInput).toContain('round-1-image-2')
  })

  it('scrubs stored agent response payloads when deleting an output task', async () => {
    const rawResponsePayload = JSON.stringify({
      output: [
        { type: 'message', content: [{ type: 'output_text', text: '已生成两张图。' }] },
        { type: 'image_generation_call', id: 'deleted-call', result: 'deleted-base64' },
        { type: 'image_generation_call', id: 'live-call', result: 'live-base64' },
      ],
    }, null, 2)
    const deletedTask = task({
      id: 'task-deleted',
      outputImages: ['image-deleted'],
      rawResponsePayload,
      sourceMode: 'agent',
      agentRoundId: 'round-a',
      agentToolCallId: 'deleted-call',
    })
    const liveTask = task({
      id: 'task-live',
      outputImages: ['image-live'],
      rawResponsePayload,
      sourceMode: 'agent',
      agentRoundId: 'round-a',
      agentToolCallId: 'live-call',
    })
    useStore.setState((state) => ({
      tasks: [deletedTask, liveTask],
      agentConversations: state.agentConversations.map((conversation) => ({
        ...conversation,
        rounds: conversation.rounds.map((round) => round.id === 'round-a'
          ? { ...round, outputTaskIds: ['task-deleted', 'task-live'], responseOutput: JSON.parse(rawResponsePayload).output }
          : round,
        ),
      })),
    }))

    await removeTask(deletedTask)

    const state = useStore.getState()
    const serializedConversations = JSON.stringify(state.agentConversations)
    const remainingTaskPayload = state.tasks.find((item) => item.id === 'task-live')?.rawResponsePayload ?? ''
    expect(serializedConversations).not.toContain('deleted-base64')
    expect(remainingTaskPayload).not.toContain('deleted-base64')
    expect(serializedConversations).toContain('live-base64')
    expect(remainingTaskPayload).toContain('live-base64')
  })

  it('does not corrupt batch task payloads when deleting one of the batch tasks', async () => {
    const batchDeletedPayload = JSON.stringify({
      output: [{ type: 'image_generation_call', id: 'batch-deleted-call', result: 'batch-deleted-base64' }],
    }, null, 2)
    const batchLivePayload = JSON.stringify({
      output: [{ type: 'image_generation_call', id: 'batch-live-call', result: 'batch-live-base64' }],
    }, null, 2)
    const batchDeletedTask = task({
      id: 'batch-task-deleted',
      outputImages: ['batch-img-deleted'],
      rawResponsePayload: batchDeletedPayload,
      sourceMode: 'agent',
      agentRoundId: 'round-a',
      agentToolCallId: 'batch-deleted-call',
      agentBatchCallId: 'batch-fc-1',
    })
    const batchLiveTask = task({
      id: 'batch-task-live',
      outputImages: ['batch-img-live'],
      rawResponsePayload: batchLivePayload,
      sourceMode: 'agent',
      agentRoundId: 'round-a',
      agentToolCallId: 'batch-live-call',
      agentBatchCallId: 'batch-fc-1',
    })
    useStore.setState((state) => ({
      tasks: [batchDeletedTask, batchLiveTask],
      agentConversations: state.agentConversations.map((conversation) => ({
        ...conversation,
        rounds: conversation.rounds.map((round) => round.id === 'round-a'
          ? {
              ...round,
              outputTaskIds: ['batch-task-deleted', 'batch-task-live'],
              responseOutput: [
                { type: 'function_call', name: 'generate_image_batch', call_id: 'batch-fc-1', arguments: '{}' },
                { type: 'function_call_output', call_id: 'batch-fc-1', output: '{"images":[{"id":"1","status":"done"},{"id":"2","status":"done"}]}' },
              ],
            }
          : round,
        ),
      })),
    }))

    await removeTask(batchDeletedTask)

    const state = useStore.getState()
    const liveTaskPayload = state.tasks.find((item) => item.id === 'batch-task-live')?.rawResponsePayload ?? ''
    expect(liveTaskPayload).toContain('batch-live-base64')
    expect(liveTaskPayload).not.toContain('batch-deleted-base64')
    const serializedConversations = JSON.stringify(state.agentConversations)
    expect(serializedConversations).toContain('function_call_output')
    expect(serializedConversations).not.toContain('batch-deleted-base64')
  })
})

describe('agent batch reference resolution', () => {
  const responsesProfile = createDefaultOpenAIProfile({
    id: 'responses-profile',
    apiKey: 'test-key',
    apiMode: 'responses',
    model: DEFAULT_RESPONSES_MODEL,
  })

  beforeEach(async () => {
    await clearImages()
    await putImage(imageA)
    await putImage(imageB)
    vi.mocked(callAgentResponsesApi).mockClear()
    vi.mocked(callBatchImageSingle).mockClear()
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        apiMode: 'responses',
        model: DEFAULT_RESPONSES_MODEL,
        profiles: [responsesProfile],
        activeProfileId: responsesProfile.id,
      }),
      prompt: '继续生成',
      inputImages: [],
      maskDraft: null,
      params: { ...DEFAULT_PARAMS },
      appMode: 'agent',
      tasks: [
        task({ id: 'task-branch-a', outputImages: [imageA.id], sourceMode: 'agent', agentRoundId: 'round-2-a' }),
        task({ id: 'task-branch-b', outputImages: [imageB.id], sourceMode: 'agent', agentRoundId: 'round-2-b' }),
      ],
      agentConversations: [agentConversation({
        id: 'conversation-a',
        activeRoundId: 'round-2-b',
        rounds: [
          {
            id: 'round-1',
            index: 1,
            parentRoundId: null,
            userMessageId: 'user-1',
            assistantMessageId: 'assistant-1',
            prompt: '画基础图',
            inputImageIds: [],
            outputTaskIds: [],
            status: 'done',
            error: null,
            createdAt: 1,
            finishedAt: 2,
          },
          {
            id: 'round-2-a',
            index: 2,
            parentRoundId: 'round-1',
            userMessageId: 'user-2-a',
            assistantMessageId: 'assistant-2-a',
            prompt: '分支 A',
            inputImageIds: [],
            outputTaskIds: ['task-branch-a'],
            status: 'done',
            error: null,
            createdAt: 3,
            finishedAt: 4,
          },
          {
            id: 'round-2-b',
            index: 2,
            parentRoundId: 'round-1',
            userMessageId: 'user-2-b',
            assistantMessageId: 'assistant-2-b',
            prompt: '分支 B',
            inputImageIds: [],
            outputTaskIds: ['task-branch-b'],
            status: 'done',
            error: null,
            createdAt: 5,
            finishedAt: 6,
          },
        ],
        messages: [
          { id: 'user-1', role: 'user', content: '画基础图', roundId: 'round-1', createdAt: 1 },
          { id: 'assistant-1', role: 'assistant', content: '完成', roundId: 'round-1', createdAt: 2 },
          { id: 'user-2-a', role: 'user', content: '分支 A', roundId: 'round-2-a', createdAt: 3 },
          { id: 'assistant-2-a', role: 'assistant', content: '完成', roundId: 'round-2-a', outputTaskIds: ['task-branch-a'], createdAt: 4 },
          { id: 'user-2-b', role: 'user', content: '分支 B', roundId: 'round-2-b', createdAt: 5 },
          { id: 'assistant-2-b', role: 'assistant', content: '完成', roundId: 'round-2-b', outputTaskIds: ['task-branch-b'], createdAt: 6 },
        ],
      })],
      activeAgentConversationId: 'conversation-a',
      agentEditingRoundId: null,
      showToast: vi.fn(),
    })
  })

  it('resolves batch references from the active branch path only', async () => {
    vi.mocked(callAgentResponsesApi)
      .mockResolvedValueOnce({
        text: '',
        images: [],
        outputItems: [{
          type: 'function_call',
          name: 'generate_image_batch',
          call_id: 'batch-call',
          arguments: JSON.stringify({
            images: [{
              id: 'next-image',
              prompt: '参考 <ref id="round-2-image-1" /> 生成',
              reference_ids: ['round-2-image-1'],
            }],
          }),
        }],
        responseId: 'response-1',
      })
      .mockResolvedValueOnce({
        text: '完成',
        images: [],
        outputItems: [{ type: 'message', content: [{ type: 'output_text', text: '完成' }] }],
        responseId: 'response-2',
      })

    await submitAgentMessage()

    for (let i = 0; i < 5 && vi.mocked(callBatchImageSingle).mock.calls.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(callBatchImageSingle).toHaveBeenCalled()
    const batchArgs = vi.mocked(callBatchImageSingle).mock.calls[0][0]
    expect(batchArgs.referenceImageDataUrls).toEqual([imageB.dataUrl])
    expect(batchArgs.referenceImageDataUrls).not.toContain(imageA.dataUrl)
    expect(batchArgs.referenceIds).toEqual(['round-2-image-1'])
  })
})

describe('agent assistant regeneration', () => {
  const responsesProfile = createDefaultOpenAIProfile({ id: 'openai-responses', apiKey: 'openai-key', apiMode: 'responses' })

  beforeEach(() => {
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        profiles: [responsesProfile],
        activeProfileId: responsesProfile.id,
        alwaysShowRetryButton: false,
      }),
      params: { ...DEFAULT_PARAMS, n: 4 },
      agentEditingRoundId: 'round-a',
      agentConversations: [
        agentConversation({
          id: 'conversation-a',
          activeRoundId: 'round-a',
          rounds: [{
            id: 'round-a',
            index: 1,
            parentRoundId: null,
            userMessageId: 'user-a',
            assistantMessageId: 'assistant-a',
            prompt: '画一只猫',
            inputImageIds: [imageA.id],
            outputTaskIds: [],
            status: 'done',
            error: null,
            createdAt: 1,
            finishedAt: 2,
          }],
          messages: [
            { id: 'user-a', role: 'user', content: '画一只猫', roundId: 'round-a', inputImageIds: [imageA.id], createdAt: 1 },
            { id: 'assistant-a', role: 'assistant', content: '已完成。', roundId: 'round-a', createdAt: 2 },
          ],
        }),
      ],
      toast: null,
      showToast: vi.fn(),
      setConfirmDialog: vi.fn(),
    })
  })

  it('creates a sibling round from the assistant message regardless of retry setting', async () => {
    await regenerateAgentAssistantMessage('conversation-a', 'round-a')

    const conversation = useStore.getState().agentConversations[0]
    const newRound = conversation.rounds.find((round) => round.id !== 'round-a')
    expect(newRound).toMatchObject({
      index: 1,
      parentRoundId: null,
      prompt: '画一只猫',
      inputImageIds: [imageA.id],
      status: 'running',
      outputTaskIds: [],
    })
    expect(conversation.activeRoundId).toBe(newRound?.id)
    expect(conversation.messages).toContainEqual(expect.objectContaining({
      role: 'user',
      content: '画一只猫',
      roundId: newRound?.id,
      inputImageIds: [imageA.id],
    }))
    expect(useStore.getState().agentEditingRoundId).toBeNull()
  })

  it('overwrites the same round when regenerating an error assistant message', async () => {
    useStore.setState({
      agentConversations: [
        agentConversation({
          id: 'conversation-a',
          activeRoundId: 'round-a',
          rounds: [{
            id: 'round-a',
            index: 1,
            parentRoundId: null,
            userMessageId: 'user-a',
            assistantMessageId: 'assistant-a',
            prompt: '画一只猫',
            inputImageIds: [imageA.id],
            outputTaskIds: ['task-a'],
            status: 'error',
            error: '失败',
            createdAt: 1,
            finishedAt: 2,
          }],
          messages: [
            { id: 'user-a', role: 'user', content: '画一只猫', roundId: 'round-a', inputImageIds: [imageA.id], createdAt: 1 },
            { id: 'assistant-a', role: 'assistant', content: '请求失败：失败', roundId: 'round-a', outputTaskIds: ['task-a'], createdAt: 2 },
          ],
        }),
      ],
    })

    await regenerateAgentAssistantMessage('conversation-a', 'round-a')

    const conversation = useStore.getState().agentConversations[0]
    expect(conversation.rounds).toHaveLength(1)
    expect(conversation.activeRoundId).toBe('round-a')
    expect(conversation.rounds[0]).toMatchObject({
      id: 'round-a',
      status: 'running',
      error: null,
      outputTaskIds: [],
      finishedAt: null,
    })
    expect(conversation.messages.find((message) => message.id === 'assistant-a')).toMatchObject({
      content: '',
      outputTaskIds: [],
    })
  })
})

describe('reused task API profile', () => {
  const openaiProfile = createDefaultOpenAIProfile({ id: 'openai-profile', apiKey: 'openai-key' })
  const falProfile = createDefaultFalProfile({ id: 'fal-profile', name: 'fal 配置', apiKey: 'fal-key' })

  beforeEach(() => {
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        profiles: [openaiProfile, falProfile],
        activeProfileId: openaiProfile.id,
        reuseTaskApiProfileTemporarily: true,
      }),
      prompt: '',
      inputImages: [],
      maskDraft: null,
      params: { ...DEFAULT_PARAMS },
      tasks: [],
      showSettings: false,
      toast: null,
      reusedTaskApiProfileId: null,
      reusedTaskApiProfileName: null,
      reusedTaskApiProfileMissing: false,
      pendingTaskCategory: null,
      showToast: vi.fn(),
      setConfirmDialog: vi.fn(),
    })
  })

  it('resolves a task API profile by stored profile id', () => {
    const resolved = getTaskApiProfile(useStore.getState().settings, task({ apiProvider: 'fal', apiProfileId: falProfile.id }))

    expect(resolved?.id).toBe(falProfile.id)
  })

  it('does not resolve a task API profile by stored name or model', () => {
    const resolved = getTaskApiProfile(useStore.getState().settings, task({
      apiProvider: 'fal',
      apiProfileName: falProfile.name,
      apiModel: falProfile.model,
    }))

    expect(resolved).toBeNull()
  })

  it('reuses the task API profile temporarily without switching the active profile', async () => {
    await reuseConfig(task({
      apiProvider: 'fal',
      apiProfileId: falProfile.id,
      params: { ...DEFAULT_PARAMS, n: 8, size: 'auto', quality: 'auto' },
    }))

    const state = useStore.getState()
    expect(state.settings.activeProfileId).toBe(openaiProfile.id)
    expect(state.reusedTaskApiProfileId).toBe(falProfile.id)
    expect(state.params).toMatchObject({ n: 4, size: '1360x1024', quality: 'high' })
    expect(state.showToast).toHaveBeenCalledWith('已临时复用该任务的 API 配置「fal 配置」', 'success')
  })

  it('keeps selected image mentions when reusing a task with different current input images', async () => {
    await clearImages()
    await putImage(imageA)
    await putImage(imageB)
    const taskPrompt = `参考 ${getSelectedImageMentionLabel(1)} 生成`

    useStore.setState({
      prompt: `当前 ${getSelectedImageMentionLabel(1)}`,
      inputImages: [
        { id: 'current-x', dataUrl: 'data:image/png;base64,x' },
        { id: 'current-y', dataUrl: 'data:image/png;base64,y' },
      ],
    })

    await reuseConfig(task({
      apiProvider: 'openai',
      apiProfileId: openaiProfile.id,
      prompt: taskPrompt,
      inputImageIds: [imageA.id, imageB.id],
    }))

    const state = useStore.getState()
    expect(state.inputImages.map((img) => img.id)).toEqual([imageA.id, imageB.id])
    expect(state.prompt).toBe(taskPrompt)
  })

  it('clears temporary reuse when switching current settings to the reused API profile', async () => {
    await reuseConfig(task({ apiProvider: 'fal', apiProfileId: falProfile.id }))

    useStore.getState().setSettings({ activeProfileId: falProfile.id })

    const state = useStore.getState()
    expect(state.settings.activeProfileId).toBe(falProfile.id)
    expect(state.reusedTaskApiProfileId).toBeNull()
    expect(state.reusedTaskApiProfileMissing).toBe(false)
  })

  it('normalizes reused params to the current API profile when temporary reuse is disabled', async () => {
    useStore.setState({
      settings: normalizeSettings({
        ...useStore.getState().settings,
        reuseTaskApiProfileTemporarily: false,
      }),
    })

    await reuseConfig(task({
      apiProvider: 'fal',
      apiProfileId: falProfile.id,
      params: { ...DEFAULT_PARAMS, n: 8, size: 'auto', quality: 'auto' },
    }))

    const state = useStore.getState()
    expect(state.settings.activeProfileId).toBe(openaiProfile.id)
    expect(state.reusedTaskApiProfileId).toBeNull()
    expect(state.params).toMatchObject({ n: 8, size: 'auto', quality: 'auto' })
  })

  it('asks whether to submit with current API profile when the reused API profile is missing', async () => {
    await reuseConfig(task({ apiProvider: 'fal', apiProfileId: 'missing-profile' }))

    const state = useStore.getState()
    expect(state.tasks).toEqual([])
    expect(state.setConfirmDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: '找不到 API 配置',
      message: '找不到复用任务所使用的 API 配置「未知配置」，要使用当前的 API 配置「默认」提交任务吗？',
      confirmText: '使用当前配置提交',
      cancelText: '放弃提交',
    }))
    expect(state.showSettings).toBe(false)
  })
})
