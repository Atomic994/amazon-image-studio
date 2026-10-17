import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ApiProfile } from '../types'
import type { PlannerModulePreview } from '../lib/plannerModulePreview'
import { translatePlannerPreviewText } from '../lib/listingPlannerApi'
import { copyTextToClipboard } from '../lib/clipboard'
import { previewTranslationCache } from '../lib/previewTranslationCache'
import { formatPlannerLogForCopy, redactPlannerLogMessage } from '../lib/plannerRunLog'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { useTranslationRunLog } from '../hooks/useTranslationRunLog'
import { useStore } from '../store'
import { Sheet } from './Sheet'
import MarkdownRenderer from './MarkdownRenderer'
import PlannerRunLog from './PlannerRunLog'
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, CopyIcon } from './icons'

const BUTTON = 'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-white/[0.06]'

export default function APlusModulePreviewModal({ modules, initialIndex, profile, onClose, terminologyContext = '' }: {
  modules: PlannerModulePreview[]
  initialIndex: number
  profile: ApiProfile | null
  onClose: () => void
  terminologyContext?: string
}) {
  const [index, setIndex] = useState(Math.min(Math.max(0, initialIndex), modules.length - 1))
  const [view, setView] = useState<'source' | 'zh'>('source')
  const [translation, setTranslation] = useState<{ key: string; text: string; cached: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const controllerRef = useRef<AbortController | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const showToast = useStore((state) => state.showToast)
  const module = modules[index]
  const content = module?.content ?? ''
  const cacheSource = terminologyContext ? `${content}\n\nCATEGORY TRANSLATION CONTEXT: ${terminologyContext}` : content
  const translationKey = JSON.stringify([cacheSource, profile?.provider, profile?.baseUrl, profile?.apiMode, profile?.model])
  const translated = translation?.key === translationKey ? translation.text : ''
  const displayed = view === 'zh' && translated ? translated : content
  const { state: log, reset: resetLog, start: startLog, add: addLog, progress: progressLog, finish: finishLog } = useTranslationRunLog()

  const cancel = () => {
    if (controllerRef.current) finishLog('stopped', '已停止翻译，未保存未完成的译文；已有译文仍可查看。')
    controllerRef.current?.abort()
    controllerRef.current = null
    setBusy(false)
  }
  const close = () => { cancel(); onClose() }
  useCloseOnEscape(true, close)
  usePreventBackgroundScroll(true, panelRef)

  useEffect(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    const cached = profile && content ? previewTranslationCache.get(cacheSource, profile, { touch: false }) : undefined
    setTranslation(cached ? { key: translationKey, text: cached.text, cached: true } : null)
    resetLog()
    setView('source')
    setBusy(false)
    setError('')
    return () => { controllerRef.current?.abort(); controllerRef.current = null }
  }, [content, translationKey, profile?.id, profile?.baseUrl, profile?.apiKey, profile?.model, profile?.apiMode, profile?.apiProxy, profile?.timeout, resetLog])

  useEffect(() => {
    contentRef.current?.scrollTo(0, 0)
  }, [index, view])

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeButtonRef.current?.focus()
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const elements = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]') ?? [])
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (event.shiftKey && (document.activeElement === first || !panelRef.current?.contains(document.activeElement))) {
        event.preventDefault(); last?.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !panelRef.current?.contains(document.activeElement))) {
        event.preventDefault(); first?.focus()
      }
    }
    document.addEventListener('keydown', trapFocus)
    return () => { document.removeEventListener('keydown', trapFocus); if (previousFocus?.isConnected) previousFocus.focus() }
  }, [])

  const navigate = (next: number) => {
    cancel()
    setError('')
    setView('source')
    setIndex(next)
  }

  const translate = async (refresh = false) => {
    if (controllerRef.current || !content) return
    if (!profile) { setError('请先在设置中配置 AI 策划的 LLM。'); return }
    setError('')
    startLog({ model: profile.model, apiMode: profile.apiMode, apiKey: profile.apiKey, refresh })
    if (!refresh) {
      if (translated && !translation?.cached) {
        setView('zh')
        finishLog('success', '已复用本次窗口中的译文，未发起 LLM 请求；浏览器本地缓存不可用。')
        return
      }
      const cached = previewTranslationCache.get(cacheSource, profile)
      if (cached) {
        setTranslation({ key: translationKey, text: cached.text, cached: true })
        setView('zh')
        finishLog('success', `已使用浏览器本地缓存（${cached.text.length.toLocaleString('zh-CN')} 个字符），未发起 LLM 请求；30 天保留期从本次使用起计算。`)
        return
      }
      addLog('未找到可用缓存，准备请求 AI 策划模型。')
    }
    const controller = new AbortController()
    controllerRef.current = controller
    setBusy(true)
    try {
      const result = await translatePlannerPreviewText({ text: content, terminologyContext, profile, signal: controller.signal,
        onProgress: (progress) => { if (controllerRef.current === controller && !controller.signal.aborted) progressLog(progress) },
      })
      if (controllerRef.current !== controller || controller.signal.aborted) return
      const cached = previewTranslationCache.put(cacheSource, profile, result)
      setTranslation({ key: translationKey, text: result, cached })
      setView('zh')
      addLog(cached ? '完整译文已保存到浏览器本地，30 天未使用后自动清理。' : '浏览器本地缓存不可用或空间不足，本次译文仍可在当前窗口查看。', cached ? 'info' : 'warning')
      finishLog('success', '翻译完成，原文保持不变；如需更新译文，可以点击“重新翻译”。')
    } catch (err) {
      if (controllerRef.current === controller && !controller.signal.aborted) {
        const message = redactPlannerLogMessage(err instanceof Error ? err.message : String(err), profile.apiKey)
        setError(`翻译失败：${message}`)
        finishLog('error', `翻译失败：${message}；未覆盖已有译文。`)
      }
    } finally {
      if (controllerRef.current === controller) { controllerRef.current = null; setBusy(false) }
    }
  }

  const copy = async () => {
    try { await copyTextToClipboard(displayed); showToast('模块内容已复制', 'success') }
    catch { showToast('复制失败', 'error') }
  }

  const copyLog = async () => {
    try { await copyTextToClipboard(formatPlannerLogForCopy(log)); showToast('翻译日志已复制', 'success') }
    catch { showToast('复制日志失败', 'error') }
  }

  return createPortal(
    <Sheet onClose={close} rootClassName="z-[115]" panelRef={panelRef} className="flex max-h-[92dvh] max-w-4xl flex-col pt-5" labelledBy="module-preview-title">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-white/[0.08]">
        <div className="min-w-0">
          <h2 id="module-preview-title" className="break-words text-base font-semibold text-gray-900 dark:text-gray-100">{module?.slot} · {module?.title}</h2>
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{module?.uploadSize ? `上传 ${module.uploadSize} · ` : ''}生成 {module?.generationSize}</div>
        </div>
        <button ref={closeButtonRef} type="button" onClick={close} className={`${BUTTON} w-8 border-0 px-0`} aria-label="关闭模块预览" title="关闭"><CloseIcon className="h-4 w-4" /></button>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-2 dark:border-white/[0.08]">
        <div className="ios-segmented inline-flex h-8 items-center p-0.5" role="tablist" aria-label="预览语言">
          <button type="button" role="tab" aria-selected={view === 'source'} onClick={() => setView('source')} className={`ios-segment h-7 px-3 text-xs font-medium ${view === 'source' ? 'text-gray-900 dark:text-white' : 'text-gray-500'}`}>原文</button>
          <button type="button" role="tab" aria-selected={view === 'zh'} disabled={!translated} onClick={() => { if (busy) { if (profile) previewTranslationCache.get(cacheSource, profile); setView('zh') } else void translate() }} className={`ios-segment h-7 px-3 text-xs font-medium disabled:opacity-40 ${view === 'zh' ? 'text-gray-900 dark:text-white' : 'text-gray-500'}`}>中文</button>
        </div>
        <button type="button" onClick={busy ? cancel : () => void translate()} className={BUTTON} title={profile ? `使用 AI 策划模型 ${profile.model}` : '未配置 AI 策划模型'}>{busy ? '停止翻译' : '翻译为中文'}</button>
        {translated && <button type="button" onClick={() => void translate(true)} disabled={busy} className={BUTTON} title="忽略旧缓存重新请求模型，成功后更新缓存">重新翻译</button>}
        <button type="button" onClick={() => void copy()} className={BUTTON}><CopyIcon className="h-3.5 w-3.5" />复制</button>
        {modules.length > 1 && <div className="ml-auto flex items-center gap-1.5">
          <button type="button" onClick={() => navigate(index - 1)} disabled={index <= 0} className={`${BUTTON} w-8 px-0`} aria-label="上一个模块" title="上一个模块"><ChevronLeftIcon className="h-4 w-4" /></button>
          <span className="min-w-10 text-center text-xs tabular-nums text-gray-500">{index + 1}/{modules.length}</span>
          <button type="button" onClick={() => navigate(index + 1)} disabled={index >= modules.length - 1} className={`${BUTTON} w-8 px-0`} aria-label="下一个模块" title="下一个模块"><ChevronRightIcon className="h-4 w-4" /></button>
        </div>}
      </div>
      <div className="shrink-0 border-b border-gray-100 px-4 pb-3 dark:border-white/[0.08]">
        <p className="pt-2 text-[11px] text-gray-500 dark:text-gray-400">{translated ? translation?.cached ? '本地译文已就绪，可随时切换原文和中文。每次使用后重新计算 30 天保留期。' : '译文仅在当前窗口保留，本地缓存暂不可用。' : '译文保存在当前浏览器，30 天未使用后自动清理。'}</p>
        <PlannerRunLog state={log} onCopy={() => void copyLog()} />
      </div>
      {error && <div role="alert" className="max-h-24 shrink-0 overflow-y-auto break-words px-4 pt-3 text-xs text-red-600 dark:text-red-300">{error}</div>}
      <div ref={contentRef} className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
        {/* Reset the static Markdown renderer when a refreshed translation replaces the current text. */}
        <MarkdownRenderer key={displayed} content={displayed} className="break-words text-sm text-gray-700 [overflow-wrap:anywhere] dark:text-gray-200" />
      </div>
    </Sheet>,
    document.body,
  )
}
