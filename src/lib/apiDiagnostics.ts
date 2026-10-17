import type { ApiProfile, AppSettings } from '../types'
import { DEFAULT_PARAMS } from '../types'
import { callImageApi } from './api'
import { canApiProfileGenerateImages, createApiProfileRequestSettings, isAliyunQwenImageProfile, validateApiProfile } from './apiProfiles'
import { buildApiUrl, readClientDevProxyConfig, shouldUseApiProxy } from './devProxy'
import { createLinkedAbortController, getApiErrorMessage } from './imageApiShared'
import { callPlannerStructuredAnalysis } from './listingPlannerApi'
import { normalizeParamsForSettings } from './paramCompatibility'
import { getImageDimensions } from './canvasImage'

export type DiagnosticKind = 'config' | 'models' | 'text' | 'image' | 'edit' | 'multi-reference'
export type DiagnosticRole = 'planner' | 'image'
export interface DiagnosticEvent { at: number; level: 'info' | 'warning' | 'error' | 'success'; message: string }
export interface DiagnosticFinding { code: string; title: string; suggestion: string; httpStatus?: number }
export interface DiagnosticResult extends DiagnosticFinding {
  kind: DiagnosticKind; status: 'success' | 'warning' | 'error' | 'cancelled'; elapsedMs: number; image?: string; models?: string[]
}
export const DIAGNOSTIC_LABELS: Record<DiagnosticKind, string> = {
  config: '检查配置', models: '读取模型列表', text: '策划文本与流式测试', image: '测试生图（1 张）', edit: '测试单图编辑（1 张）', 'multi-reference': '测试双参考图（1 张）',
}

/** Diagnostic output is ephemeral. Never include headers, request bodies or raw image URLs. */
export function redactDiagnosticText(value: string, secrets: string[] = []): string {
  let text = value
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
    text = text.split(secret).join('[已隐藏密钥]').split(encodeURIComponent(secret)).join('[已隐藏密钥]')
  }
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [已隐藏密钥]')
    .replace(/https?:\/\/[^\s<>"']+/gi, (address) => {
      try { const url = new URL(address); return `${url.origin}${url.pathname}${url.search || url.hash ? '?[已隐藏参数]' : ''}` } catch { return '[已隐藏地址]' }
    })
    .replace(/((?:api[_-]?key|access[_-]?token|authorization|password|secret|token|key)["']?\s*[:=]\s*["']?)([^\s,"'}]+)/gi, '$1[已隐藏密钥]')
    .replace(/data:image\/[^\s"']+/gi, '[图片数据]')
}

export function diagnoseApiError(error: unknown): DiagnosticFinding {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const message = error instanceof Error ? error.message : String(error)
  const httpStatus = typeof record.status === 'number' ? record.status : Number(message.match(/\bHTTP\s+(\d{3})\b/i)?.[1]) || undefined
  const finding = (code: string, title: string, suggestion: string) => ({ code, title, suggestion, ...(httpStatus ? { httpStatus } : {}) })
  if (/图片.*(?:下载失败|链接下载|URL 下载)/i.test(message)) return finding('image-download', '返回了图片链接，但下载失败', '检查图片域名跨域与链接有效期；接口支持时可开启“返回 Base64 图片数据”。')
  if (httpStatus === 401 || /invalid_api_key|incorrect api key|unauthorized/i.test(message)) return finding('authentication', '鉴权失败', '检查当前配置的 API Key、是否过期，以及中转是否要求 Bearer 鉴权。')
  if (httpStatus === 403 || /permission_denied|forbidden/i.test(message)) return finding('permission', '接口拒绝访问', '检查 Key 的模型权限、服务商 IP/区域限制和代理访问权限。')
  if (httpStatus === 404 || /model_not_found|unknown model|model .*not found/i.test(message)) return finding('not-found', '路径或模型不存在', '核对 API URL 的版本前缀、接口类型和模型 ID；模型列表接口不存在不代表策划或生图不可用。')
  if (httpStatus === 429 || /insufficient_quota|rate_limit|quota exceeded/i.test(message)) return finding('rate-limit', '额度不足或请求过于频繁', '检查中转与上游额度、并发限制和限流提示，稍后手动测试；本工具不自动重发。')
  if ([408, 504, 522, 524].includes(httpStatus ?? 0) || /timeout|timed? out|超时/i.test(message)) return finding('timeout', '请求超时', '若已有 HTTP 504/522/524，说明网关或上游超时；只调大网页超时无法修复上游。检查中转日志、流式保活，并减少单次策划量。')
  if ((httpStatus && httpStatus >= 500) || /openai_error|overloaded|server_error/i.test(message)) return finding('upstream', '中转或上游服务异常', '查看同一时间的中转日志，确认上游可用性、账号状态和模型路由；稍后手动测试。')
  if (/Failed to fetch|fetch failed|NetworkError|Load failed|network request failed/i.test(message)) return finding('network', '浏览器无法读取接口响应', '可能是网络、证书、CORS 或 HTTPS 页面请求 HTTP。浏览器不能单凭此错误区分原因，请结合控制台和中转日志核对；仅支持静态文件的部署不会自动解决 CORS。')
  if (/json|未返回|返回空|无法解析|未通过|无可用|没有返回/i.test(message)) return finding('response', '响应格式不符合预期', '核对接口类型与实际返回结构。HTTP 成功或普通聊天正常，不等于结构化策划、流式或图片接口兼容。')
  if (httpStatus === 400 || httpStatus === 422 || /不支持|unsupported|not support/i.test(message)) return finding('capability', '接口能力或参数不兼容', '核对模型是否支持当前操作、尺寸、参考图片数量和所选协议；可用其他单项测试定位。')
  return finding('unknown', '测试未完成', '根据下方已脱敏日志核对配置及中转日志；不要把 API Key 放进反馈内容。')
}

export function diagnosticAvailability(profile: ApiProfile, role: DiagnosticRole): Record<DiagnosticKind, string | null> {
  const openai = profile.provider === 'openai' && !isAliyunQwenImageProfile(profile)
  const image = role === 'image' && canApiProfileGenerateImages(profile)
  return {
    config: null,
    models: openai ? null : '此服务商不使用标准 /models 接口，可直接测试实际操作。',
    text: role === 'planner' && openai && (profile.apiMode === 'chat' || profile.apiMode === 'responses') ? null : '请在 AI 策划配置中测试 Chat Completions 或 Responses。',
    image: image ? null : '此配置不是图片生成配置。', edit: image ? null : '此配置不是图片编辑配置。', 'multi-reference': image ? null : '此配置不是图片生成配置。',
  }
}

export function diagnosticConfigWarnings(profile: ApiProfile, pageProtocol = ''): string[] {
  const warnings: string[] = []
  const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(profile.baseUrl) ? profile.baseUrl : `https://${profile.baseUrl}`)
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('API URL 必须使用 HTTP 或 HTTPS')
  if (url.username || url.password) throw new Error('API URL 不能包含用户名或密码；请使用 API Key 字段')
  if (url.search || url.hash) warnings.push('API URL 中的查询参数与锚点不会随标准请求发送，请改填服务商的基础地址。')
  if (url.protocol === 'http:' && pageProtocol === 'https:') warnings.push('当前 HTTPS 页面请求 HTTP 接口，浏览器可能拦截混合内容；请改用 HTTPS 地址。')
  if (profile.apiProxy && !shouldUseApiProxy(true, readClientDevProxyConfig(), profile.baseUrl)) warnings.push('当前部署未提供 API 代理，实际请求会由浏览器直连；请确保接口允许当前网站跨域访问。')
  return warnings
}

/** Tiny synthetic reference fixtures contain no user product data. */
export function createDiagnosticReference(color: string, second = false): string {
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持测试图绘制')
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 256, 256); ctx.fillStyle = color
  if (second) { ctx.beginPath(); ctx.arc(128, 128, 64, 0, Math.PI * 2); ctx.fill() } else ctx.fillRect(64, 64, 128, 128)
  return canvas.toDataURL('image/png')
}

export async function runApiDiagnostic(options: {
  kind: DiagnosticKind; role: DiagnosticRole; profile: ApiProfile; settings: AppSettings; timeoutSeconds: number
  signal?: AbortSignal; onEvent?: (event: DiagnosticEvent) => void; pageProtocol?: string
}): Promise<DiagnosticResult> {
  const { kind, profile } = options, startedAt = Date.now(), secrets = [profile.apiKey]
  const log = (message: string, level: DiagnosticEvent['level'] = 'info') => options.onEvent?.({ at: Date.now(), message: redactDiagnosticText(message, secrets).slice(0, 1600), level })
  const finish = (status: DiagnosticResult['status'], finding: DiagnosticFinding, extra: Partial<DiagnosticResult> = {}): DiagnosticResult => {
    const result = { kind, status, ...finding, ...extra, elapsedMs: Date.now() - startedAt }
    result.title = redactDiagnosticText(result.title, secrets); result.suggestion = redactDiagnosticText(result.suggestion, secrets)
    log(`${result.title}；${result.suggestion}`, status === 'cancelled' || status === 'warning' ? 'warning' : status)
    return result
  }
  const seconds = Math.max(10, Math.min(600, Number.isFinite(options.timeoutSeconds) ? options.timeoutSeconds : 120))
  const linked = createLinkedAbortController(seconds, options.signal), signal = linked.controller.signal
  try {
    signal.throwIfAborted()
    log(`${DIAGNOSTIC_LABELS[kind]} · ${profile.name} · ${profile.model} · ${profile.apiMode}`)
    const validation = validateApiProfile(profile)
    if (validation) return finish('error', { code: 'config', title: `配置不完整：${validation}`, suggestion: '先补全当前配置再执行网络测试。' })
    const unavailable = diagnosticAvailability(profile, options.role)[kind]
    if (unavailable) return finish('warning', { code: 'unsupported-test', title: '此配置不提供这项测试', suggestion: unavailable })
    let warnings: string[] = []
    try { warnings = profile.baseUrl ? diagnosticConfigWarnings(profile, options.pageProtocol) : [] } catch (error) {
      log(error instanceof Error ? error.message : String(error), 'error')
      return finish('error', { code: 'config', title: 'API URL 配置无效', suggestion: '请填写正确的 HTTP/HTTPS 基础地址，不要在 URL 中填写用户名或密码。' })
    }
    warnings.forEach((warning) => log(warning, 'warning'))
    if (kind === 'config') return finish(warnings.length ? 'warning' : 'success', { code: 'config', title: warnings.length ? '配置检查完成，有提示需核对' : '配置格式检查通过', suggestion: '此项不发送网络请求，不代表接口或模型已经可用。' })
    log(`本项超时 ${seconds} 秒；测试失败不会自动重发。停止等待不保证上游停止计算。`)
    if (kind === 'models') {
      const proxy = readClientDevProxyConfig(), url = buildApiUrl(profile.baseUrl, 'models', proxy, shouldUseApiProxy(profile.apiProxy, proxy, profile.baseUrl), { prefixV1: profile.apiMode !== 'chat' })
      log(`GET ${url}`)
      const response = await fetch(url, { headers: { Authorization: `Bearer ${profile.apiKey}` }, cache: 'no-store', signal })
      log(`已收到 HTTP ${response.status}`)
      if (!response.ok) throw Object.assign(new Error(await getApiErrorMessage(response)), { status: response.status })
      const payload: unknown = await response.json()
      const data = payload && typeof payload === 'object' && 'data' in payload ? (payload as { data: unknown }).data : null
      if (!Array.isArray(data)) throw new Error('模型列表不是预期的 JSON data 数组')
      const allIds = data.flatMap((row) => row && typeof row.id === 'string' ? [row.id] : [])
      const found = allIds.includes(profile.model)
      return finish(found ? 'success' : 'warning', { code: found ? 'models' : 'model-not-listed', title: `模型列表可读，共 ${allIds.length} 项${found ? '，包含当前模型' : '，未列出当前模型'}`, suggestion: '模型列表只用于辅助检查；仍需执行实际文本或图片测试确认权限与能力。', httpStatus: response.status }, { models: allIds.slice(0, 500).map((id) => redactDiagnosticText(id, secrets)) })
    }
    if (kind === 'text') {
      const proxy = readClientDevProxyConfig()
      log(`POST ${buildApiUrl(profile.baseUrl, profile.apiMode === 'chat' ? 'chat/completions' : 'responses', proxy, shouldUseApiProxy(profile.apiProxy, proxy, profile.baseUrl), { prefixV1: profile.apiMode !== 'chat' })}`)
      let transport = '', httpStatus: number | undefined
      await callPlannerStructuredAnalysis({ profile: { ...profile, timeout: seconds }, instructions: 'This is a connection diagnostic. Return exactly the JSON object {"ok":true}. Do not generate images or call tools.', text: 'Return {"ok":true}.', images: [],
        schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false }, schemaName: 'connection_diagnostic', maxAttempts: 1, signal,
        onTransport: (value) => { transport = value; log(value === 'sse' ? '正在读取 SSE 流式响应' : value === 'buffered-sse' ? '收到完整缓冲的 SSE 文本，无法证明实时流式保活' : '接口返回普通 JSON，尚未验证实时流式保活', value === 'sse' ? 'info' : 'warning') },
        onProgress: (progress) => { if (progress.httpStatus) { httpStatus = progress.httpStatus; log(`接口响应 HTTP ${httpStatus}`) } else if (progress.phase === 'receiving') log(`已接收 ${progress.receivedChars ?? 0} 字符`) },
        parse: (value) => { if (!value || typeof value !== 'object' || (value as { ok?: unknown }).ok !== true) throw new Error('结构化诊断结果未通过：需要 {"ok":true}'); return true },
      })
      return finish(transport === 'sse' ? 'success' : 'warning', { code: 'text', title: transport === 'sse' ? '结构化文本与 SSE 读取通过' : '结构化文本通过，实时流式未确认', suggestion: '短请求通过不保证长策划不会超时；多分钟的保活与模型输出仍需结合实际策划日志检查。', httpStatus })
    }
    const settings = createApiProfileRequestSettings(options.settings, { ...profile, timeout: seconds })!
    log('图片请求沿用当前服务商的适配器，包括兼容参数处理及异步任务状态查询。')
    const count = kind === 'edit' ? 1 : kind === 'multi-reference' ? 2 : 0
    const references = count ? [createDiagnosticReference('#2563eb'), ...(count === 2 ? [createDiagnosticReference('#f97316', true)] : [])] : []
    const params = normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: profile.provider === 'volcengine' ? 'auto' : '1024x1024', output_format: 'png', n: 1 }, settings, { hasInputImages: !!count })
    log(`准备提交实际图片请求：${count} 张内置测试参考图，输出数量 1，尺寸 ${params.size}；不发送你的商品图片。`)
    const result = await callImageApi({ settings, params, prompt: count === 2 ? 'Place the blue square from reference 1 and orange circle from reference 2 side by side on white. No text.' : count ? 'Keep the blue square and its position; change the white background to very pale gray. No text.' : 'A single blue square centered on a white background. No text.', inputImageDataUrls: references, signal,
      onCustomTaskEnqueued: () => log('服务商已接收异步任务，正在等待并读取结果'), onFalRequestEnqueued: () => log('fal.ai 任务已提交，正在等待结果'), onPartialImage: () => log('已收到预览，等待最终图片'),
    })
    signal.throwIfAborted()
    if (!result.images.length) throw new Error('接口未返回可用图片')
    log('已读取图片数据，正在检查是否可以解码')
    const dimensions = await getImageDimensions(result.images[0])
    signal.throwIfAborted()
    log(`测试图可以解码：${dimensions.width} × ${dimensions.height} px`)
    return finish('success', { code: 'image', title: '图片请求与结果读取通过', suggestion: count ? '请查看下方测试图，人工确认参考图内容是否被采用；接口返回图片不等于视觉内容符合要求。' : '下方是本次实际返回的图片。测试结果只保留在当前窗口，不加入生成历史。' }, { image: result.images[0] })
  } catch (error) {
    if (options.signal?.aborted) return finish('cancelled', { code: 'cancelled', title: '已停止等待', suggestion: '没有自动重发请求；已提交的上游任务可能仍在运行。' })
    if (signal.aborted) return finish('error', { code: 'timeout', title: `测试等待超过 ${seconds} 秒`, suggestion: '这是网页等待上限；上游可能仍在运行，请先核对中转日志再决定是否重试。' })
    log(error instanceof Error ? error.message : String(error), 'error')
    const finding = diagnoseApiError(error)
    return finish(kind === 'models' && finding.httpStatus === 404 ? 'warning' : 'error', finding)
  } finally { linked.cleanup() }
}

export function formatDiagnosticReport(profile: ApiProfile, events: DiagnosticEvent[], results: DiagnosticResult[]): string {
  const address = profile.baseUrl && !/^[a-z][a-z\d+.-]*:\/\//i.test(profile.baseUrl) ? `https://${profile.baseUrl}` : profile.baseUrl
  return redactDiagnosticText(['接口自检与错误诊断（不含 API Key）', `配置：${profile.name} · ${profile.model} · ${profile.apiMode}`, `地址：${address}`,
    ...results.map((row) => `${DIAGNOSTIC_LABELS[row.kind]}：${row.title} [${row.code}] ${(row.elapsedMs / 1000).toFixed(1)}秒\n${row.suggestion}`),
    ...events.map((event) => `[${new Date(event.at).toLocaleTimeString('zh-CN', { hour12: false })}] ${event.message}`),
  ].join('\n'), [profile.apiKey])
}
