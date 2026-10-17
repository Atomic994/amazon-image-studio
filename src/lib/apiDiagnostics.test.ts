import { afterEach, describe, expect, it, vi } from 'vitest'
import { callImageApi } from './api'
import { createDefaultAmazonPlannerProfile, createDefaultFalProfile, createDefaultOpenAIProfile, DEFAULT_SETTINGS } from './apiProfiles'
import { diagnosticAvailability, diagnosticConfigWarnings, diagnoseApiError, formatDiagnosticReport, redactDiagnosticText, runApiDiagnostic, type DiagnosticEvent } from './apiDiagnostics'
import { getApiErrorMessage } from './imageApiShared'
import { getImageDimensions } from './canvasImage'

vi.mock('./api', () => ({ callImageApi: vi.fn() }))
vi.mock('./canvasImage', async (original) => ({ ...await original<typeof import('./canvasImage')>(), getImageDimensions: vi.fn().mockResolvedValue({ width: 1024, height: 1024 }) }))
const profile = createDefaultAmazonPlannerProfile({ apiKey: 'diagnostic-secret-key', baseUrl: 'https://cpa.example:81/v1', apiMode: 'chat', model: 'test-planner' })
const options = () => ({ role: 'planner' as const, profile, settings: DEFAULT_SETTINGS, timeoutSeconds: 30 })
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const sseResponse = (text: string) => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); vi.mocked(callImageApi).mockReset() })
describe('API diagnostics classification and privacy', () => {
  it.each([[401, 'authentication'], [403, 'permission'], [404, 'not-found'], [429, 'rate-limit'], [504, 'timeout'], [522, 'timeout'], [524, 'timeout'], [502, 'upstream'], [400, 'capability']])('preserves HTTP %s and gives a specific diagnosis', (status, code) => {
    expect(diagnoseApiError(new Error(`HTTP ${status}: problem`))).toMatchObject({ httpStatus: status, code })
  })
  it('does not claim a network failure proves CORS', () => {
    const result = diagnoseApiError(new TypeError('Failed to fetch'))
    expect(result.code).toBe('network'); expect(result.suggestion).toContain('不能单凭此错误区分')
    expect(diagnoseApiError(new Error('图片 URL 下载失败：HTTP 403')).code).toBe('image-download')
    expect(diagnoseApiError(new Error('无法解析 JSON')).code).toBe('response')
  })
  it('redacts exact and encoded secrets, bearer tokens, userinfo and URL query/fragment', () => {
    const result = redactDiagnosticText('key=a/b+c Bearer other-secret https://user:pass@host/v1?token=query-secret#fragment api_key="named-secret" '+encodeURIComponent('a/b+c'), ['a/b+c'])
    expect(result).not.toMatch(/a\/b\+c|a%2Fb|other-secret|user:pass|query-secret|fragment|named-secret/)
    expect(result).toContain('https://host/v1')
  })
  it('keeps a complete multi-line copy report rather than truncating its tail', () => {
    const events: DiagnosticEvent[] = Array.from({ length: 25 }, (_, index) => ({ at: index, level: 'info', message: `Event ${index}: ${'x'.repeat(100)}` }))
    const report = formatDiagnosticReport({ ...profile, baseUrl: 'https://host/v1?api_key=query-secret' }, events, [])
    expect(report).toContain('Event 24'); expect(report).not.toContain('query-secret'); expect(report).not.toContain(profile.apiKey)
    expect(formatDiagnosticReport({ ...profile, baseUrl: 'host/v1?key=no-scheme-secret' }, [], [])).not.toContain('no-scheme-secret')
  })
  it('reports mixed content, ignored proxy and query configuration without guessing capabilities', () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'false')
    const warnings = diagnosticConfigWarnings({ ...profile, baseUrl: 'http://cpa.example/v1?x=1', apiProxy: true }, 'https:')
    expect(warnings).toHaveLength(3)
    expect(() => diagnosticConfigWarnings({ ...profile, baseUrl: 'https://user:pass@host/v1' })).toThrow('用户名或密码')
    expect(diagnosticAvailability(createDefaultFalProfile(), 'image').models).toContain('不使用标准')
    expect(diagnosticAvailability(profile, 'planner').image).toBeTruthy()
  })
  it('retains status and a gateway text body when it is not JSON', async () => {
    expect(await getApiErrorMessage(new Response('Gateway upstream timeout', { status: 504 }))).toBe('HTTP 504: Gateway upstream timeout')
    expect(await getApiErrorMessage(jsonResponse({ error: { message: 'no permission' } }, 403))).toBe('HTTP 403: no permission')
  })
})

describe('API diagnostics requests', () => {
  it('checks local configuration without issuing any network request', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    expect((await runApiDiagnostic({ ...options(), kind: 'config' })).status).toBe('success'); expect(fetch).not.toHaveBeenCalled()
    expect((await runApiDiagnostic({ ...options(), kind: 'text', profile: { ...profile, apiKey: '' } })).code).toBe('config'); expect(fetch).not.toHaveBeenCalled()
    expect((await runApiDiagnostic({ ...options(), kind: 'text', profile: { ...profile, baseUrl: 'https://[bad' } })).code).toBe('config'); expect(fetch).not.toHaveBeenCalled()
  })
  it('uses the configured chat base path and searches all model IDs before limiting display', async () => {
    const data = Array.from({ length: 550 }, (_, i) => ({ id: i === 549 ? profile.model : `model-${i}` }))
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ data }))
    const result = await runApiDiagnostic({ ...options(), profile: { ...profile, baseUrl: 'https://host/custom/api' }, kind: 'models' })
    expect(fetch.mock.calls[0][0]).toBe('https://host/custom/api/models'); expect(result.status).toBe('success'); expect(result.models).toHaveLength(500)
  })
  it('treats a missing /models route as inconclusive and never falls back to a paid request', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ error: 'no route' }, 404))
    const result = await runApiDiagnostic({ ...options(), kind: 'models' })
    expect(result).toMatchObject({ status: 'warning', code: 'not-found', httpStatus: 404 }); expect(fetch).toHaveBeenCalledTimes(1); expect(callImageApi).not.toHaveBeenCalled()
  })
  it('reads actual SSE text using the planning parser and validates the structured result', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(sseResponse('{"ok":true}'))
    const events: DiagnosticEvent[] = []
    const result = await runApiDiagnostic({ ...options(), kind: 'text', onEvent: (event) => events.push(event) })
    expect(result).toMatchObject({ status: 'success', code: 'text', httpStatus: 200 })
    expect(fetch.mock.calls[0][0]).toBe('https://cpa.example:81/v1/chat/completions')
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({ model: profile.model, stream: true, response_format: { type: 'json_object' } })
    expect(events.some((event) => event.message.includes('SSE'))).toBe(true)
  })
  it('tests Responses with the actual JSON schema and does not claim plain JSON is live SSE', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ output_text: '{"ok":true}' }))
    const result = await runApiDiagnostic({ ...options(), profile: { ...profile, apiMode: 'responses' }, kind: 'text' })
    expect(result).toMatchObject({ status: 'warning', code: 'text' })
    expect(fetch.mock.calls[0][0]).toBe('https://cpa.example:81/v1/responses')
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({ text: { format: { name: 'connection_diagnostic', type: 'json_schema' } } })
  })
  it('rejects malformed / false results even when HTTP succeeds', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(sseResponse('{"ok":false}'))
    expect(await runApiDiagnostic({ ...options(), kind: 'text' })).toMatchObject({ status: 'error', code: 'response' })
  })
  it('does not automatically retry 504 and keeps secret-bearing errors out of the log', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ error: { message: `openai_error ${profile.apiKey} https://host/v1?key=url-secret` } }, 504))
    const events: DiagnosticEvent[] = []
    const result = await runApiDiagnostic({ ...options(), kind: 'text', onEvent: (event) => events.push(event) })
    expect(result).toMatchObject({ status: 'error', code: 'timeout', httpStatus: 504 }); expect(fetch).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(events)).not.toContain(profile.apiKey); expect(JSON.stringify(events)).not.toContain('url-secret')
  })
  it('distinguishes user cancellation and local timeout, with no retry', async () => {
    vi.useFakeTimers()
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })))
    const controller = new AbortController(), cancelled = runApiDiagnostic({ ...options(), kind: 'text', signal: controller.signal })
    controller.abort(); expect((await cancelled).status).toBe('cancelled')
    const expired = runApiDiagnostic({ ...options(), kind: 'models', timeoutSeconds: 10 }); await vi.advanceTimersByTimeAsync(10_001)
    expect(await expired).toMatchObject({ status: 'error', code: 'timeout' }); expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('runs image probes with a snapshot, one output and only synthetic reference inputs', async () => {
    const context = { fillRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn() }
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => context, toDataURL: () => 'data:image/png;base64,fixture' }) })
    vi.mocked(callImageApi).mockResolvedValue({ images: ['data:image/png;base64,output'] })
    const imageProfile = createDefaultOpenAIProfile({ apiKey: 'local-test', baseUrl: 'https://images.example/v1', model: 'test-image' })
    const result = await runApiDiagnostic({ ...options(), role: 'image', profile: imageProfile, kind: 'multi-reference' })
    expect(result).toMatchObject({ status: 'success', image: 'data:image/png;base64,output' })
    expect(callImageApi).toHaveBeenCalledTimes(1)
    const request = vi.mocked(callImageApi).mock.calls[0][0]
    expect(request.inputImageDataUrls).toHaveLength(2); expect(request.params).toMatchObject({ n: 1, size: '1024x1024' }); expect(request.settings.activeProfileId).toBe(imageProfile.id)
    expect(DEFAULT_SETTINGS.apiKey).toBe(''); expect(getImageDimensions).toHaveBeenCalledWith('data:image/png;base64,output')
  })
})
