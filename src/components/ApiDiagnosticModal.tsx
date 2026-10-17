import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ApiProfile, AppSettings } from '../types'
import { DIAGNOSTIC_LABELS, diagnosticAvailability, formatDiagnosticReport, redactDiagnosticText, runApiDiagnostic, type DiagnosticEvent, type DiagnosticKind, type DiagnosticResult, type DiagnosticRole } from '../lib/apiDiagnostics'
import { copyTextToClipboard, getClipboardFailureMessage } from '../lib/clipboard'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { useModalFocus } from '../hooks/useModalFocus'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { Sheet } from './Sheet'

const BUTTON = 'rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 disabled:opacity-40 dark:border-white/10 dark:bg-gray-900 dark:text-gray-200'
const STATUS = { success: '通过', warning: '需核对', error: '失败', cancelled: '已停止' }
export default function ApiDiagnosticModal({ profile, settings, role, onClose }: { profile: ApiProfile; settings: AppSettings; role: DiagnosticRole; onClose: () => void }) {
  const [events, setEvents] = useState<DiagnosticEvent[]>([]), [results, setResults] = useState<DiagnosticResult[]>([])
  const [running, setRunning] = useState<DiagnosticKind | null>(null), [elapsed, setElapsed] = useState(0)
  const [timeout, setTimeoutSeconds] = useState(Math.max(10, Math.min(120, profile.timeout || 120))), [copyMessage, setCopyMessage] = useState('')
  const panelRef = useRef<HTMLDivElement>(null), runRef = useRef<AbortController | null>(null), startedAt = useRef(0)
  const identity = JSON.stringify({ profile, provider: settings.customProviders.find((item) => item.id === profile.provider) })
  const identityRef = useRef(identity); identityRef.current = identity
  useEffect(() => {
    runRef.current?.abort(); runRef.current = null; setRunning(null); setEvents([]); setResults([]); setCopyMessage('')
    return () => { runRef.current?.abort(); runRef.current = null }
  }, [identity])
  useEffect(() => { if (!running) return; const timer = setInterval(() => setElapsed(Date.now() - startedAt.current), 1000); return () => clearInterval(timer) }, [running])
  const close = () => { runRef.current?.abort(); runRef.current = null; onClose() }
  useCloseOnEscape(true, close); useModalFocus(true, panelRef); usePreventBackgroundScroll(true, panelRef)
  const availability = diagnosticAvailability(profile, role)
  const kinds: DiagnosticKind[] = role === 'planner' ? ['config', 'models', 'text'] : ['config', 'models', 'image', 'edit', 'multi-reference']
  const run = async (kind: DiagnosticKind) => {
    if (runRef.current) return
    const controller = new AbortController(), requestIdentity = identity
    runRef.current = controller; startedAt.current = Date.now(); setElapsed(0); setRunning(kind); setCopyMessage('')
    const current = () => runRef.current === controller && identityRef.current === requestIdentity
    const result = await runApiDiagnostic({ kind, role, profile: structuredClone(profile), settings: structuredClone(settings), timeoutSeconds: timeout, signal: controller.signal, pageProtocol: window.location.protocol,
      onEvent: (event) => { if (current()) setEvents((rows) => [...rows, event].slice(-200)) },
    })
    if (current()) { setResults((rows) => [...rows, result].slice(-20)); setRunning(null); runRef.current = null }
  }
  const copy = async () => {
    try { await copyTextToClipboard(formatDiagnosticReport(profile, events, results)); setCopyMessage('已复制脱敏报告') } catch (error) { setCopyMessage(getClipboardFailureMessage('复制失败，可手动选择日志文本', error)) }
  }
  const latestImage = [...results].reverse().find((result) => result.image)?.image
  return createPortal(<Sheet panelRef={panelRef} onClose={close} labelledBy="api-diagnostic-title" rootClassName="z-[118]" className="flex max-h-[92dvh] max-w-3xl flex-col overflow-hidden pt-5">
    <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-white/10"><div><h2 id="api-diagnostic-title" className="font-semibold text-gray-900 dark:text-gray-100">接口自检与错误诊断</h2><p className="mt-1 break-all text-xs text-gray-500">{redactDiagnosticText(`${profile.name} · ${profile.model} · ${profile.apiMode}`, [profile.apiKey])}</p></div><button type="button" className={BUTTON} onClick={close}>关闭自检</button></div>
    <div className="custom-scrollbar min-h-0 overflow-y-auto p-4 text-xs text-gray-700 dark:text-gray-200">
      <p className="rounded-xl bg-blue-50 p-3 leading-5 text-blue-800 dark:bg-blue-500/10 dark:text-blue-200">逐项测试当前配置；打开窗口不会自动发送请求。文本、生图和编辑测试会调用真实接口，可能消耗额度。图片测试只使用内置图形，不发送你的商品图片，也不加入生成历史。</p>
      <p className="mt-3 leading-5 text-gray-500">结果仅代表本次测试。模型列表可读不代表模型有生成权限；短文本通过也不保证长时间策划不会超时。日志只在当前窗口保留，复制时隐藏密钥和 URL 参数。</p>
      <div className="my-3 flex flex-wrap items-center gap-2"><label>测试超时（秒）<input aria-label="接口自检超时秒数" type="number" min={10} max={600} value={timeout} disabled={!!running} onChange={(event) => setTimeoutSeconds(Number(event.target.value))} onBlur={() => setTimeoutSeconds((value) => Math.max(10, Math.min(600, value || 120)))} className={`${BUTTON} ml-2 w-20`} /></label>{running && <><span role="status">{DIAGNOSTIC_LABELS[running]} · 等待 {Math.floor(elapsed / 1000)} 秒</span><button type="button" className={`${BUTTON} text-red-600`} disabled={runRef.current?.signal.aborted} onClick={() => runRef.current?.abort()}>停止等待</button></>}</div>
      <div className="flex flex-wrap gap-2">{kinds.map((kind) => <button type="button" key={kind} disabled={!!running || !!availability[kind]} title={availability[kind] ?? undefined} onClick={() => void run(kind)} className={BUTTON}>{DIAGNOSTIC_LABELS[kind]}</button>)}</div>
      {availability.models && <p className="mt-2 text-gray-500">{availability.models}</p>}
      <div className="mt-4 space-y-2" aria-live="polite">{results.map((result, index) => <section key={index} aria-label={`${DIAGNOSTIC_LABELS[result.kind]}测试结果`} className={`rounded-xl border p-3 ${result.status === 'error' ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200' : result.status === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200' : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200'}`}><strong>{DIAGNOSTIC_LABELS[result.kind]} · {STATUS[result.status]} · {(result.elapsedMs / 1000).toFixed(1)} 秒{result.httpStatus ? ` · HTTP ${result.httpStatus}` : ''}</strong><p className="mt-1 font-medium">{result.title}</p><p className="mt-1 leading-5">{result.suggestion}</p>{result.models && <details className="mt-2"><summary className="cursor-pointer">查看模型 ID（最多显示 500 项）</summary><pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-all">{result.models.join('\n') || '空列表'}</pre></details>}</section>)}</div>
      {latestImage && <figure className="mt-4"><img src={latestImage} alt="接口自检返回的测试图片" className="mx-auto max-h-64 rounded-lg object-contain" /><figcaption className="mt-2 text-center text-gray-500">最近一次返回的测试图，请人工核对图形与参考内容。</figcaption></figure>}
      <div className="mt-4 flex flex-wrap items-center gap-2"><strong>诊断日志</strong><button type="button" className={BUTTON} disabled={!events.length} onClick={() => void copy()}>复制脱敏报告</button><button type="button" className={BUTTON} disabled={!!running || !events.length} onClick={() => { setEvents([]); setResults([]); setCopyMessage('') }}>清空结果</button><span role="status">{copyMessage}</span></div>
      <pre aria-label="接口自检日志" className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-gray-100 p-3 leading-5 dark:bg-gray-950">{events.length ? events.map((event) => `[${new Date(event.at).toLocaleTimeString('zh-CN', { hour12: false })}] ${event.message}`).join('\n') : '选择一项开始测试。'}</pre>
    </div>
  </Sheet>, document.body)
}
