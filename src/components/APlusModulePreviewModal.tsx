import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ApiProfile } from '../types'
import type { PlannerModulePreview } from '../lib/plannerModulePreview'
import { translatePlannerPreviewText } from '../lib/listingPlannerApi'
import { copyTextToClipboard } from '../lib/clipboard'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { useStore } from '../store'
import { Sheet } from './Sheet'
import MarkdownRenderer from './MarkdownRenderer'
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, CopyIcon } from './icons'

const BUTTON = 'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-white/[0.06]'

export default function APlusModulePreviewModal({ modules, initialIndex, profile, onClose }: {
  modules: PlannerModulePreview[]
  initialIndex: number
  profile: ApiProfile | null
  onClose: () => void
}) {
  const [index, setIndex] = useState(Math.min(Math.max(0, initialIndex), modules.length - 1))
  const [view, setView] = useState<'source' | 'zh'>('source')
  const [translations, setTranslations] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const controllerRef = useRef<AbortController | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const showToast = useStore((state) => state.showToast)
  const module = modules[index]
  const content = module?.content ?? ''
  const translated = translations[content]
  const displayed = view === 'zh' && translated ? translated : content

  const cancel = () => {
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
    setTranslations({})
    setView('source')
    setBusy(false)
    setError('')
    return () => { controllerRef.current?.abort(); controllerRef.current = null }
  }, [profile?.id, profile?.baseUrl, profile?.apiKey, profile?.model, profile?.apiMode, profile?.apiProxy, profile?.timeout])

  useEffect(() => {
    contentRef.current?.scrollTo(0, 0)
    controllerRef.current?.abort()
    controllerRef.current = null
    setBusy(false)
    setError('')
    setView('source')
  }, [content])

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

  const translate = async () => {
    if (controllerRef.current || !content) return
    if (translated) { setView('zh'); return }
    if (!profile) { setError('请先在设置中配置 AI 策划的 LLM。'); return }
    const controller = new AbortController()
    controllerRef.current = controller
    setBusy(true)
    setError('')
    try {
      const result = await translatePlannerPreviewText({ text: content, profile, signal: controller.signal })
      if (controllerRef.current !== controller || controller.signal.aborted) return
      setTranslations((current) => ({ ...current, [content]: result }))
      setView('zh')
    } catch (err) {
      if (controllerRef.current === controller && !controller.signal.aborted) {
        setError(`翻译失败：${err instanceof Error ? err.message : String(err)}`)
      }
    } finally {
      if (controllerRef.current === controller) { controllerRef.current = null; setBusy(false) }
    }
  }

  const copy = async () => {
    try { await copyTextToClipboard(displayed); showToast('模块内容已复制', 'success') }
    catch { showToast('复制失败', 'error') }
  }

  return createPortal(
    <Sheet onClose={close} rootClassName="z-[115]" panelRef={panelRef} className="flex max-h-[92dvh] max-w-4xl flex-col pt-5" labelledBy="module-preview-title">
      <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-white/[0.08]">
        <div className="min-w-0">
          <h2 id="module-preview-title" className="break-words text-base font-semibold text-gray-900 dark:text-gray-100">{module?.slot} · {module?.title}</h2>
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{module?.uploadSize ? `上传 ${module.uploadSize} · ` : ''}生成 {module?.generationSize}</div>
        </div>
        <button ref={closeButtonRef} type="button" onClick={close} className={`${BUTTON} w-8 border-0 px-0`} aria-label="关闭模块预览" title="关闭"><CloseIcon className="h-4 w-4" /></button>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-2 dark:border-white/[0.08]">
        <div className="ios-segmented inline-flex h-8 items-center p-0.5" role="tablist" aria-label="预览语言">
          <button type="button" role="tab" aria-selected={view === 'source'} onClick={() => setView('source')} className={`ios-segment h-7 px-3 text-xs font-medium ${view === 'source' ? 'text-gray-900 dark:text-white' : 'text-gray-500'}`}>原文</button>
          <button type="button" role="tab" aria-selected={view === 'zh'} disabled={!translated} onClick={() => setView('zh')} className={`ios-segment h-7 px-3 text-xs font-medium disabled:opacity-40 ${view === 'zh' ? 'text-gray-900 dark:text-white' : 'text-gray-500'}`}>中文</button>
        </div>
        <button type="button" onClick={busy ? cancel : () => void translate()} className={BUTTON} title={profile ? `使用 AI 策划模型 ${profile.model}` : '未配置 AI 策划模型'}>{busy ? '停止翻译' : '翻译为中文'}</button>
        <button type="button" onClick={() => void copy()} className={BUTTON}><CopyIcon className="h-3.5 w-3.5" />复制</button>
        {modules.length > 1 && <div className="ml-auto flex items-center gap-1.5">
          <button type="button" onClick={() => navigate(index - 1)} disabled={index <= 0} className={`${BUTTON} w-8 px-0`} aria-label="上一个模块" title="上一个模块"><ChevronLeftIcon className="h-4 w-4" /></button>
          <span className="min-w-10 text-center text-xs tabular-nums text-gray-500">{index + 1}/{modules.length}</span>
          <button type="button" onClick={() => navigate(index + 1)} disabled={index >= modules.length - 1} className={`${BUTTON} w-8 px-0`} aria-label="下一个模块" title="下一个模块"><ChevronRightIcon className="h-4 w-4" /></button>
        </div>}
      </div>
      {busy && <div role="status" className="px-4 pt-3 text-xs text-blue-600 dark:text-blue-300">正在翻译 · {profile?.model}</div>}
      {error && <div role="alert" className="break-words px-4 pt-3 text-xs text-red-600 dark:text-red-300">{error}</div>}
      <div ref={contentRef} className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
        <MarkdownRenderer content={displayed} className="break-words text-sm text-gray-700 [overflow-wrap:anywhere] dark:text-gray-200" />
      </div>
    </Sheet>,
    document.body,
  )
}
