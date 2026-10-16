import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultAmazonPlannerProfile } from './apiProfiles'
import { extractProductFacts, analyzeReferenceImage } from './productContextApi'
import { normalizeProductFacts } from './productFacts'
import { normalizeReferenceUsage } from './referenceImageUsage'
import { normalizeReferenceAnalysis } from './referenceAnalysis'

const profile = { ...createDefaultAmazonPlannerProfile(), apiMode: 'chat' as const, baseUrl: 'https://planner.example/v1', model: 'vision', apiKey: 'local-test-only' }
const image = 'data:image/png;base64,YQ=='
const observation = normalizeReferenceAnalysis({ summary: '圆形灯座', visibleDetails: ['黑色灯臂'], uncertainties: ['材质未知'] })
const facts = normalizeProductFacts({ productName: '台灯', color: '黑色', needsConfirmation: ['材质待核实'] })
const request = { profile, image, usage: normalizeReferenceUsage({ purpose: 'composition', note: '只参考位置' }) }
function response(value: unknown, chat = true) {
  return new Response(JSON.stringify(chat ? { choices: [{ message: { content: JSON.stringify(value) } }] } : { output_text: JSON.stringify(value) }), { headers: { 'Content-Type': 'application/json' } })
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
describe('structured product context APIs', () => {
  it('sends a multimodal Chat request with role boundaries and a validated complete analysis', async () => {
    const fetchMock = vi.fn(async () => response(observation)); vi.stubGlobal('fetch', fetchMock)
    expect(await analyzeReferenceImage(request)).toEqual(observation)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://planner.example/v1/chat/completions')
    const body = JSON.parse(String(init.body))
    expect(body.stream).toBe(true); expect(body.response_format.type).toBe('json_object')
    expect(body.messages[1].content[1].image_url.url).toBe(image)
    expect(body.messages[1].content[0].text).toContain('Composition reference')
    expect(body.messages[0].content).toContain('never turn the pictured product')
  })
  it('sends Responses strict schema and returns an unconfirmed facts draft', async () => {
    const fetchMock = vi.fn(async () => response(facts, false)); vi.stubGlobal('fetch', fetchMock)
    const result = await extractProductFacts({ profile: { ...profile, apiMode: 'responses' }, listingText: 'Black lamp', manualFacts: normalizeProductFacts({}), productImages: [image] })
    expect(result).toEqual(facts)
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(body.text.format.name).toBe('product_facts_draft'); expect(body.text.format.strict).toBe(true)
    expect(body.text.format.schema.required).toContain('needsConfirmation')
    expect(body.input[0].content[1].image_url).toBe(image)
    expect(body.instructions).toContain('NOT user confirmed')
  })
  it('does not pretend DeepSeek text-only profiles saw images', async () => {
    const deepseek = { ...profile, baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' }
    await expect(analyzeReferenceImage({ ...request, profile: deepseek })).rejects.toThrow('不支持读取图片')
    const fetchMock = vi.fn(async () => response(facts)); vi.stubGlobal('fetch', fetchMock)
    await extractProductFacts({ profile: deepseek, listingText: 'Black lamp', manualFacts: facts, productImages: [image] })
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(JSON.stringify(body)).not.toContain('data:image')
    expect(body.messages[0].content).toContain('No images are supplied')
  })
  it('rejects incomplete or empty JSON instead of saving a partial result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ summary: 'partial' })))
    await expect(analyzeReferenceImage(request)).rejects.toThrow('字段不完整')
    vi.stubGlobal('fetch', vi.fn(async () => response(normalizeReferenceAnalysis({}))))
    await expect(analyzeReferenceImage(request)).rejects.toThrow('摘要为空')
  })
  it('retries transient 504 errors under the same abort signal and reports retries', async () => {
    vi.useFakeTimers()
    const progress: string[] = []
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{"error":{"message":"openai_error"}}', { status: 504 })).mockResolvedValueOnce(response(observation))
    vi.stubGlobal('fetch', fetchMock)
    const result = analyzeReferenceImage({ ...request, onProgress: (event) => progress.push(event.phase) })
    await vi.advanceTimersByTimeAsync(1000)
    expect(await result).toEqual(observation); expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][1].signal).toBe(fetchMock.mock.calls[1][1].signal)
    expect(progress).toContain('retrying'); expect(progress).toContain('validating')
  })
  it('uses non-stream mode only after an explicit unsupported-stream error', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{"error":{"message":"stream is not supported"}}', { status: 400 })).mockResolvedValueOnce(response(observation))
    vi.stubGlobal('fetch', fetchMock)
    expect(await analyzeReferenceImage(request)).toEqual(observation)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).stream).toBe(true)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).stream).toBe(false)
  })
  it('does not retry authentication errors or send requests after cancellation', async () => {
    const fetchMock = vi.fn(async () => new Response('{"error":{"message":"invalid_api_key"}}', { status: 401 })); vi.stubGlobal('fetch', fetchMock)
    await expect(analyzeReferenceImage(request)).rejects.toThrow('401'); expect(fetchMock).toHaveBeenCalledTimes(1)
    const controller = new AbortController(); controller.abort()
    await expect(analyzeReferenceImage({ ...request, signal: controller.signal })).rejects.toBeDefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('reads Chat SSE content while excluding reasoning from analysis and progress', async () => {
    const content = JSON.stringify(observation), phases: number[] = []
    const sse = [`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'private-reasoning-never-display' } }] })}\n\n`, `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`, 'data: [DONE]\n\n'].join('')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sse, { headers: { 'Content-Type': 'text/event-stream' } })))
    const result = await analyzeReferenceImage({ ...request, onProgress: (event) => { if (event.receivedChars !== undefined) phases.push(event.receivedChars) } })
    expect(result).toEqual(observation); expect(phases).toContain(content.length)
    expect(JSON.stringify(result)).not.toContain('private-reasoning')
  })
})
