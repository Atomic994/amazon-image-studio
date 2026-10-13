import { describe, expect, it, vi } from 'vitest'
import { readJsonServerSentEvents, readJsonServerSentEventText, ServerSentEventError } from './serverSentEvents'

describe('JSON server-sent event transport', () => {
  it('reports heartbeat activity even when no JSON content has arrived', async () => {
    const activity = vi.fn()
    const event = vi.fn()
    await readJsonServerSentEvents(new Response(': keepalive\n\ndata: [DONE]\n\n'), event, { onActivity: activity })
    expect(activity).toHaveBeenCalled()
    expect(event).not.toHaveBeenCalled()
  })
  it('handles UTF-8 characters and CRLF delimiters split at every byte boundary', async () => {
    const bytes = new TextEncoder().encode(': keepalive\r\n\r\nevent: response.output_text.delta\r\ndata: {"delta":"中文 content "}\r\n\r\ndata: [DONE]\r\n\r\n')
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
        controller.close()
      },
    })
    const onEvent = vi.fn()
    const onDone = vi.fn()
    await readJsonServerSentEvents(new Response(stream), onEvent, { onDone })
    expect(onEvent).toHaveBeenCalledExactlyOnceWith({ type: 'response.output_text.delta', delta: '中文 content ' })
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(stream.locked).toBe(false)
  })

  it('joins multiline data and reads a final event without a trailing separator', async () => {
    const onEvent = vi.fn()
    await readJsonServerSentEventText('data: {"type":"delta",\ndata: "text":"hello"}\n\ndata: {"type":"completed"}', onEvent)
    expect(onEvent.mock.calls).toEqual([[{ type: 'delta', text: 'hello' }], [{ type: 'completed' }]])
  })

  it('preserves the error inside a failed Responses event and releases the stream', async () => {
    const response = new Response('event: response.failed\ndata: {"response":{"error":{"code":"openai_error","message":"Gateway timed out"}}}\n\n')
    await expect(readJsonServerSentEvents(response, vi.fn())).rejects.toMatchObject({
      name: 'ServerSentEventError', code: 'openai_error', message: 'Gateway timed out',
    })
    expect(response.body?.locked).toBe(false)
  })

  it('ends and cancels an open connection on DONE without waiting for EOF', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n')) },
      cancel,
    })
    const onDone = vi.fn()
    await readJsonServerSentEvents(new Response(stream), vi.fn(), { onDone })
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(stream.locked).toBe(false)
  })

  it('allows a completed event handler to end an open stream', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('data: {"type":"response.completed"}\n\n')) },
      cancel,
    })
    await readJsonServerSentEvents(new Response(stream), () => false)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(stream.locked).toBe(false)
  })

  it('reports malformed stream events without silently dropping data', async () => {
    await expect(readJsonServerSentEventText('data: {broken JSON}\n\n', vi.fn())).rejects.toThrow('无法解析的 JSON')
    await expect(readJsonServerSentEventText('data: {"type":"response.incomplete","response":{"incomplete_details":{"reason":"max_output_tokens"}}}\n\n', vi.fn())).rejects.toBeInstanceOf(ServerSentEventError)
  })
})
