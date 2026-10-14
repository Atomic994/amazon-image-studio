import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultAmazonPlannerProfile } from './apiProfiles'
import { translatePlannerPreviewText } from './listingPlannerApi'
import type { ApiProfile } from '../types'
import type { PlannerApiProgress } from './plannerProgress'

const source = '## A+L01\nUse 970x300. Brand: Example.\n### Prompt\nCreate a detailed product image.'
function profile(apiMode: 'chat' | 'responses' = 'chat'): ApiProfile {
  return { ...createDefaultAmazonPlannerProfile(), baseUrl: 'https://planner.example/v1', apiKey: 'test-only-key', model: 'planner-model', apiMode, apiProxy: false, timeout: 10 }
}
function jsonResponse(apiMode: 'chat' | 'responses', text = '## A+L01\n使用 970x300。品牌：Example。') {
  return new Response(JSON.stringify(apiMode === 'chat' ? { choices: [{ message: { content: text }, finish_reason: 'stop' }] } : { status: 'completed', output_text: text }), { headers: { 'Content-Type': 'application/json' } })
}
function sse(events: unknown[]) {
  return new Response(events.map((event) => `data: ${event === '[DONE]' ? event : JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } })
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('module translation through the configured planner LLM', () => {
  it.each(['chat', 'responses'] as const)('uses the exact %s planner configuration without image tools or planner schema', async (apiMode) => {
    const config = profile(apiMode)
    const fetchMock = vi.fn(async () => jsonResponse(apiMode))
    vi.stubGlobal('fetch', fetchMock)
    const result = await translatePlannerPreviewText({ text: source, profile: config })
    expect(result).toContain('使用 970x300')
    const [url, init] = (fetchMock.mock.calls as unknown as [string, RequestInit][])[0]!
    expect(url).toBe(`https://planner.example/v1/${apiMode === 'chat' ? 'chat/completions' : 'responses'}`)
    expect(init.headers).toMatchObject({ Authorization: 'Bearer test-only-key' })
    const body = JSON.parse(String(init.body))
    expect(body.model).toBe('planner-model')
    expect(body.stream).toBe(true)
    expect(body.tools).toBeUndefined()
    expect(body.response_format).toBeUndefined()
    expect(body.text).toBeUndefined()
    expect(apiMode === 'chat' ? body.messages[1].content : body.input).toBe(source)
    expect(config).toEqual(profile(apiMode))
  })

  it('reads streamed translation, preserves whitespace and never includes reasoning', async () => {
    const progress: PlannerApiProgress[] = []
    vi.stubGlobal('fetch', vi.fn(async () => sse([
      { choices: [{ delta: { reasoning_content: 'private reasoning' } }] },
      { choices: [{ delta: { content: '模块' } }] },
      { choices: [{ delta: { content: ' ' } }] },
      { choices: [{ delta: { content: 'A+L01' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] }, '[DONE]',
    ])))
    expect(await translatePlannerPreviewText({ text: source, profile: profile(), onProgress: (value) => progress.push(value) })).toBe('模块 A+L01')
    expect(progress.map((value) => value.phase)).toEqual(expect.arrayContaining(['connecting', 'connected', 'thinking', 'receiving', 'validating']))
    expect(progress[progress.length - 1]).toMatchObject({ phase: 'validating', receivedChars: '模块 A+L01'.length, attempt: 1, maxAttempts: 3 })
    expect(JSON.stringify(progress)).not.toContain('private reasoning')
    expect(progress.every((value) => value.completedPlans === undefined)).toBe(true)
  })

  it('reads Responses stream without duplicating completed snapshots', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sse([
      { type: 'response.output_text.delta', delta: '模块 A+L01' },
      { type: 'response.completed', response: { status: 'completed', output_text: '模块 A+L01' } },
    ])))
    expect(await translatePlannerPreviewText({ text: source, profile: profile('responses') })).toBe('模块 A+L01')
  })

  it('falls back only when the upstream explicitly rejects stream', async () => {
    const progress: PlannerApiProgress[] = []
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"error":{"message":"stream is not supported"}}', { status: 400 }))
      .mockResolvedValueOnce(jsonResponse('chat'))
    vi.stubGlobal('fetch', fetchMock)
    await translatePlannerPreviewText({ text: source, profile: profile(), onProgress: (value) => progress.push(value) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body).stream).toBe(false)
    expect(progress).toContainEqual(expect.objectContaining({ phase: 'fallback', attempt: 2, retryDelayMs: 0 }))
  })

  it('reports gateway retry delays and final nonstreamed character counts', async () => {
    vi.useFakeTimers()
    const progress: PlannerApiProgress[] = []
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"error":{"message":"openai_error"}}', { status: 504, headers: { 'Retry-After': '2' } }))
      .mockResolvedValueOnce(jsonResponse('chat', '完整译文'))
    vi.stubGlobal('fetch', fetchMock)
    const pending = translatePlannerPreviewText({ text: source, profile: profile(), onProgress: (value) => progress.push(value) })
    await vi.advanceTimersByTimeAsync(0)
    expect(progress).toContainEqual(expect.objectContaining({ phase: 'retrying', retryDelayMs: 2000, attempt: 2, message: expect.stringContaining('504') }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(await pending).toBe('完整译文')
    expect(progress[progress.length - 1]).toMatchObject({ phase: 'validating', receivedChars: 4, attempt: 2 })
  })

  it('stops automatic retries when cancelled while waiting', async () => {
    vi.useFakeTimers()
    const progress: PlannerApiProgress[] = []
    const fetchMock = vi.fn(async () => new Response('{"error":{"message":"openai_error"}}', { status: 504 }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const pending = translatePlannerPreviewText({ text: source, profile: profile(), signal: controller.signal, onProgress: (value) => progress.push(value) })
    const cancelled = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await cancelled
    await vi.advanceTimersByTimeAsync(5000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(progress[progress.length - 1]?.phase).toBe('retrying')
  })

  it('rejects wrong profiles, missing keys and empty content before issuing a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(translatePlannerPreviewText({ text: source, profile: { ...profile(), apiMode: 'images' } })).rejects.toThrow('翻译需要')
    await expect(translatePlannerPreviewText({ text: source, profile: { ...profile(), apiKey: '' } })).rejects.toThrow('缺少 API Key')
    await expect(translatePlannerPreviewText({ text: ' ', profile: profile() })).rejects.toThrow('没有可翻译')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects empty or truncated responses instead of caching them as successful translations', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse('chat', '')))
    await expect(translatePlannerPreviewText({ text: source, profile: profile() })).rejects.toThrow('未返回文本')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] }), { headers: { 'Content-Type': 'application/json' } })))
    await expect(translatePlannerPreviewText({ text: source, profile: profile() })).rejects.toThrow('length')
  })

  it('does not retry invalid credentials', async () => {
    const fetchMock = vi.fn(async () => new Response('{"error":{"message":"invalid key","code":"invalid_api_key"}}', { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(translatePlannerPreviewText({ text: source, profile: profile() })).rejects.toThrow('401')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('cancels outstanding translations and obeys the configured timeout', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const pending = translatePlannerPreviewText({ text: source, profile: profile(), signal: controller.signal })
    const cancelled = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await cancelled
    const timedOut = expect(translatePlannerPreviewText({ text: source, profile: { ...profile(), timeout: 2 } })).rejects.toThrow('翻译请求超时（2 秒）')
    await vi.advanceTimersByTimeAsync(2000)
    await timedOut
  })
})
