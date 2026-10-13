export function isEventStreamResponse(response: Response): boolean {
  return response.headers.get('Content-Type')?.toLowerCase().includes('text/event-stream') ?? false
}

export function looksLikeServerSentEvents(text: string): boolean {
  return /^(?:event|data):\s*/m.test(text.trimStart())
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getStringValue(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

export class ServerSentEventError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message)
    this.name = 'ServerSentEventError'
  }
}

export function assertSuccessfulStreamEvent(event: Record<string, unknown>): void {
  const response = isRecordValue(event.response) ? event.response : event
  const error = event.error ?? response.error
  const type = getStringValue(event, 'type')
  const status = getStringValue(response, 'status')
  if (error || type === 'error' || type?.endsWith('.failed') || status === 'failed') {
    const code = isRecordValue(error) ? getStringValue(error, 'code') ?? getStringValue(error, 'type') : undefined
    const message = isRecordValue(error)
      ? getStringValue(error, 'message') ?? code
      : typeof error === 'string' ? error : undefined
    throw new ServerSentEventError(message ?? getStringValue(event, 'message') ?? '流式请求失败', code)
  }
  if (type === 'response.incomplete' || status === 'incomplete') {
    const details = response.incomplete_details
    const reason = isRecordValue(details) ? getStringValue(details, 'reason') : undefined
    throw new ServerSentEventError(`AI 策划输出不完整${reason ? `：${reason}` : ''}`, reason ?? 'incomplete')
  }
  if (status === 'cancelled') {
    throw new ServerSentEventError('接口取消了 AI 策划请求', 'cancelled')
  }
}

type JsonServerSentEventHandler = (event: Record<string, unknown>) => void | false | Promise<void | false>

interface ServerSentEventReadOptions {
  signal?: AbortSignal
  onDone?: () => void
  onActivity?: () => void
}

function parseServerSentEventBlock(block: string): string | null {
  const dataLines: string[] = []
  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue
    if (!line.startsWith('data:')) continue
    dataLines.push(line.slice(5).replace(/^ /, ''))
  }

  const data = dataLines.join('\n').trim()
  return data || null
}

async function processServerSentEventBlock(
  block: string,
  onEvent: JsonServerSentEventHandler,
  options: ServerSentEventReadOptions,
): Promise<boolean> {
  const data = parseServerSentEventBlock(block)
  if (!data) return true
  if (data === '[DONE]') {
    options.onDone?.()
    return false
  }

  let event: unknown
  try {
    event = JSON.parse(data)
  } catch {
    throw new Error('流式响应包含无法解析的 JSON 事件')
  }
  if (!isRecordValue(event)) return true
  const eventName = block.split(/\r?\n/).find((line) => line.startsWith('event:'))?.slice(6).trim()
  if (eventName && !event.type) event.type = eventName
  assertSuccessfulStreamEvent(event)

  return await onEvent(event) !== false
}

export async function readJsonServerSentEventText(
  text: string,
  onEvent: JsonServerSentEventHandler,
  options: ServerSentEventReadOptions = {},
): Promise<void> {
  const normalized = text.replace(/\r\n/g, '\n')
  for (const block of normalized.split(/\n\n+/)) {
    options.signal?.throwIfAborted()
    if (block.trim()) options.onActivity?.()
    if (block.trim() && !await processServerSentEventBlock(block, onEvent, options)) break
  }
}

export async function readJsonServerSentEvents(
  response: Response,
  onEvent: JsonServerSentEventHandler,
  options: ServerSentEventReadOptions = {},
): Promise<void> {
  if (!response.body) throw new Error('接口未返回可读取的流式响应')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const abortReader = () => { void reader.cancel(options.signal?.reason).catch(() => {}) }
  options.signal?.addEventListener('abort', abortReader, { once: true })
  try {
    while (true) {
      options.signal?.throwIfAborted()
      const { value, done } = await reader.read()
      options.signal?.throwIfAborted()
      if (done) break
      if (value.length) options.onActivity?.()
      buffer += decoder.decode(value, { stream: true })

      let separator = buffer.match(/\r?\n\r?\n/)
      while (separator?.index !== undefined) {
        const block = buffer.slice(0, separator.index)
        buffer = buffer.slice(separator.index + separator[0].length)
        if (!await processServerSentEventBlock(block, onEvent, options)) return
        separator = buffer.match(/\r?\n\r?\n/)
      }
    }
    buffer += decoder.decode()
    if (buffer.trim()) await processServerSentEventBlock(buffer, onEvent, options)
  } finally {
    options.signal?.removeEventListener('abort', abortReader)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
