import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { generationQueueDb } from '../lib/db'
import { assertQueueControl, cancelQueueItem, configureGenerationQueue, retryQueueItems } from '../lib/generationQueueRunner'
import { formatPlannerElapsed } from '../lib/plannerRunLog'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { useModalFocus } from '../hooks/useModalFocus'
import { Sheet } from './Sheet'

const BUTTON = 'rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 disabled:opacity-40 dark:border-white/10 dark:text-gray-200'
const LABELS = { queued: '等待中', running: '正在生成', done: '已完成', error: '失败', cancelled: '已取消', interrupted: '执行状态待核对' }
export default function GenerationQueueModal() {
  const open = useStore((state) => state.generationQueueOpen), items = useStore((state) => state.generationQueue)
  const paused = useStore((state) => state.generationQueuePaused), concurrency = useStore((state) => state.generationQueueConcurrency)
  const message = useStore((state) => state.generationQueueMessage), tasks = useStore((state) => state.tasks)
  const [now, setNow] = useState(Date.now), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const close = () => useStore.setState({ generationQueueOpen: false })
  useCloseOnEscape(open, close); useModalFocus(open, panelRef); usePreventBackgroundScroll(open, panelRef)
  useEffect(() => { if (!open) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [open])
  if (!open) return null
  const attempt = async (work: () => Promise<unknown>) => { setBusy(true); setError(''); try { await work() } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setBusy(false) } }
  const waiting = items.filter((row) => row.status === 'queued'), running = items.filter((row) => row.status === 'running'), failed = items.filter((row) => row.status === 'error' || row.status === 'interrupted')
  return createPortal(<Sheet onClose={close} panelRef={panelRef} labelledBy="generation-queue-title" rootClassName="z-[119]" className="flex max-h-[92dvh] max-w-4xl flex-col overflow-hidden pt-5">
    <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-white/10"><div><h2 id="generation-queue-title" className="text-base font-semibold text-gray-900 dark:text-gray-100">生成队列</h2><p className="mt-1 text-xs text-gray-500">运行时保持网页打开。刷新后等待项保留并暂停；已发出请求的状态需核对后再重试。</p></div><button type="button" className={`${BUTTON} shrink-0`} onClick={close}>关闭队列</button></div>
    <div className="custom-scrollbar min-h-0 overflow-y-auto p-4"><div className="flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-300"><span>等待 {waiting.length} · 生成 {running.length} · 完成 {items.filter((row) => row.status === 'done').length} · 失败 {failed.length}</span><label className="ml-auto">同时生成 <select aria-label="队列并发上限" className={BUTTON} value={concurrency} onChange={(event) => void attempt(() => configureGenerationQueue({ generationQueueConcurrency: event.target.value === '2' ? 2 : 1 }))}><option value="1">1 张</option><option value="2">2 张</option></select></label></div>
      <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={!waiting.length} className={BUTTON} onClick={() => void attempt(() => configureGenerationQueue({ generationQueuePaused: !paused }))}>{paused ? '恢复队列' : '暂停等待项'}</button><button type="button" disabled={busy || !failed.length} className={BUTTON} onClick={() => void attempt(() => retryQueueItems(failed.map((row) => row.id)))}>只重试失败项</button><button type="button" disabled={busy || !waiting.length} className={BUTTON} onClick={() => void attempt(async () => { await configureGenerationQueue({ generationQueuePaused: true }); for (const item of waiting) await cancelQueueItem(item.id) })}>取消等待项</button><button type="button" disabled={busy || !items.some((row) => row.status === 'done' || row.status === 'cancelled')} className={BUTTON} onClick={() => void attempt(async () => { await assertQueueControl(); const ids = items.filter((row) => row.status === 'done' || row.status === 'cancelled').map((row) => row.id); for (const id of ids) await generationQueueDb.remove(id); useStore.setState((state) => ({ generationQueue: state.generationQueue.filter((row) => !ids.includes(row.id)) })) })}>清理已完成 / 已取消</button></div>
      <p role="status" className="mt-2 text-xs text-blue-600 dark:text-blue-300">{paused ? '队列已暂停，正在执行的请求继续处理。' : '队列按顺序启动任务；每项使用加入队列时保存的配置。'}</p>
      {(error || message) && <p role="alert" className="mt-3 whitespace-pre-wrap break-words text-xs text-red-600 dark:text-red-300">{error || message}</p>}
      <div className="mt-4 space-y-2">{[...items].reverse().map((item) => { const task = tasks.find((task) => task.id === item.taskId); return <article key={item.id} className="rounded-xl border border-gray-200 p-3 text-xs text-gray-600 dark:border-white/10 dark:text-gray-300"><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><strong className="break-words text-gray-800 dark:text-gray-100">{item.slot} · {item.title}</strong><p className="mt-1">{LABELS[item.status]} · 第 {item.attempt} 次 · {item.request.params.size} · {item.request.inputImageIds.length} 张参考图{item.request.productFactsSnapshot ? ` · 商品事实 v${item.request.productFactsSnapshot.versionNumber}` : ''}</p>{item.status === 'running' && <p className="mt-1">已用时 {formatPlannerElapsed(now - (task?.createdAt ?? item.updatedAt))} · 等待接口返回图片</p>}</div><div className="flex flex-wrap gap-2">{item.taskId && <button type="button" className={BUTTON} onClick={() => { close(); useStore.getState().setDetailTaskId(item.taskId!) }}>查看任务</button>}{['queued', 'running'].includes(item.status) && <button type="button" className={BUTTON} disabled={busy} onClick={() => void attempt(() => cancelQueueItem(item.id))}>{item.status === 'queued' ? '取消此项' : '停止等待'}</button>}{['error', 'interrupted', 'cancelled'].includes(item.status) && <button type="button" className={BUTTON} disabled={busy} onClick={() => void attempt(() => retryQueueItems([item.id]))}>重试此项</button>}</div></div>{item.error && <p className="mt-2 whitespace-pre-wrap break-words text-red-600 dark:text-red-300">{item.error}</p>}</article> })}</div>
      {!items.length && <p className="py-10 text-center text-sm text-gray-500">队列为空。在首页点击“整套生成”，选择需要生成的图片位。</p>}
    </div>
  </Sheet>, document.body)
}
