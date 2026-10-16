import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AmazonPlannerSessionDraft, ApiProfile, InputImage, ProductFactsState, ReferenceAnalysisSnapshot, ReferenceImageUsage } from '../types'
import { resolveInputImagesForRequest } from '../store'
import { ANALYSIS_LIST_FIELDS, effectiveReferenceAnalysis, refreshReferenceAnalysis, referenceAnalysisCache, referenceAnalysisIdentity, referenceProfileIdentity, resolveReferenceAnalyses } from '../lib/referenceAnalysis'
import { analyzeReferenceImage, extractProductFacts } from '../lib/productContextApi'
import { confirmProductFacts, confirmedProductFacts, contextFingerprint, FACT_FIELDS, FACT_LIST_FIELDS, factsFromProductDraft, normalizeProductFacts } from '../lib/productFacts'
import { normalizeReferenceUsage, REFERENCE_PURPOSE_LABELS } from '../lib/referenceImageUsage'
import { prepareReferenceImagePayload } from '../lib/referenceImagePayload'
import { formatPlannerLogForCopy } from '../lib/plannerRunLog'
import { copyTextToClipboard } from '../lib/clipboard'
import { usePlannerRunLog } from '../hooks/usePlannerRunLog'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { useModalFocus } from '../hooks/useModalFocus'
import PlannerRunLog from './PlannerRunLog'
import StoredImage from './StoredImage'
import { Sheet } from './Sheet'
import ReferenceAnalysisEditor from './ReferenceAnalysisEditor'

const BUTTON = 'rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-white/[0.1] dark:bg-gray-900 dark:text-gray-200'
const INPUT = 'mt-1.5 w-full rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs text-gray-800 dark:border-white/[0.1] dark:bg-gray-950 dark:text-gray-100'

export default function ProductContextPanel(props: {
  sessionKey: string; listingText: string; draft: AmazonPlannerSessionDraft; images: InputImage[]; usages: Record<string, ReferenceImageUsage>
  facts: ProductFactsState; analyses: Record<string, ReferenceAnalysisSnapshot>; profile?: ApiProfile | null; disabled: boolean
  analysisTarget: string | null; onCloseAnalysis: () => void; onBusy: (value: boolean) => void
  onFacts: (value: ProductFactsState, persist?: boolean) => Promise<void>; onAnalyses: (value: Record<string, ReferenceAnalysisSnapshot>, persist?: boolean) => Promise<void>
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [operation, setOperation] = useState<'facts' | 'reference'>('facts')
  const [versionId, setVersionId] = useState('')
  const [savingFacts, setSavingFacts] = useState(false)
  const [logImageId, setLogImageId] = useState('')
  const controllerRef = useRef<AbortController | null>(null)
  const latest = useRef(props); latest.current = props
  const log = usePlannerRunLog('analysis')
  const current = confirmedProductFacts(props.facts)
  const productImages = props.images.filter((image) => normalizeReferenceUsage(props.usages[image.id]).purpose === 'product')
  const sourceFingerprint = contextFingerprint([props.listingText.trim(), productImages.map((image) => image.id)])
  const referenceKey = contextFingerprint([props.sessionKey, props.images.map((image) => [image.id, normalizeReferenceUsage(props.usages[image.id])]), props.profile ? referenceProfileIdentity(props.profile) : ''])
  const sourceKey = contextFingerprint([referenceKey, props.listingText])
  const target = props.images.find((image) => image.id === props.analysisTarget)
  const analysis = target ? props.analyses[target.id] : undefined
  const close = () => { if (operation === 'reference') stop(); props.onCloseAnalysis() }
  function stop() {
    controllerRef.current?.abort()
    controllerRef.current = null; setBusy(false); latest.current.onBusy(false)
    log.finish('stopped', '本次分析已停止，原有记录已保留')
  }
  useEffect(() => {
    if (controllerRef.current) stop()
    log.reset()
    setError('')
  }, [sourceKey])
  useEffect(() => {
    let cancelled = false
    // Looking up a cache never sends an AI request or extends its TTL.
    if (props.profile && props.images.length) {
      void resolveInputImagesForRequest(props.images).then(async (images) => {
        if (cancelled || !latest.current.profile) return
        // Session restoration and manual saving can finish while original bytes are loading.
        // Resolve against the latest durable snapshot; never let an older cache read replace it.
        const current = latest.current, before = JSON.stringify(current.analyses)
        const resolved = await resolveReferenceAnalyses(images, current.usages, current.analyses, current.profile!, false)
        if (!cancelled && before === JSON.stringify(latest.current.analyses) && JSON.stringify(resolved) !== before) await latest.current.onAnalyses(resolved, false)
      }).catch((reason) => { if (!cancelled) setError(`参考图缓存检查失败：${reason instanceof Error ? reason.message : String(reason)}`) })
    } else if (Object.keys(props.analyses).length) void props.onAnalyses({}, false)
    return () => { cancelled = true }
  }, [referenceKey])
  useEffect(() => () => { controllerRef.current?.abort(); latest.current.onBusy(false) }, [])
  const copyLog = () => { void copyTextToClipboard(formatPlannerLogForCopy(log.state)).catch(() => setError('日志复制失败，请手动选择日志内容')) }
  const updateFacts = async (value: ProductFactsState, persist = false) => {
    if (savingFacts) return
    if (persist) setSavingFacts(true)
    try { await props.onFacts(value, persist); setError('') } catch (reason) { setError(`商品事实保存失败：${reason instanceof Error ? reason.message : String(reason)}`) } finally { if (persist) setSavingFacts(false) }
  }
  const run = async (kind: 'facts' | 'reference', refresh = false) => {
    if (busy || props.disabled) return
    if (!props.profile) { setError('请先在设置中配置支持 Chat Completions 或 Responses 的 AI 策划模型'); return }
    const controller = new AbortController(); controllerRef.current = controller
    setBusy(true); props.onBusy(true); setError(''); setOperation(kind)
    setLogImageId(kind === 'reference' ? target?.id ?? '' : '')
    const profile = props.profile, images = kind === 'facts' ? productImages : target ? [target] : []
    log.start({ model: profile.model, apiMode: profile.apiMode, totalPlans: 0, referenceCount: images.length, mode: kind === 'facts' ? '商品事实提取（待人工确认）' : '参考图分析', apiKey: profile.apiKey })
    try {
      const resolved = await resolveInputImagesForRequest(images, controller.signal)
      controller.signal.throwIfAborted()
      if (kind === 'reference') {
        const image = resolved[0]
        if (!image) throw new Error('参考图已不存在，请重新选择')
        const usage = normalizeReferenceUsage(props.usages[image.id])
        const identity = await referenceAnalysisIdentity(image, usage, profile)
        log.add(refresh ? '已选择强制重新分析，跳过已有缓存' : '正在检查图片内容、用途、说明和模型对应的本地缓存')
        controller.signal.throwIfAborted()
        const saved = props.analyses[image.id]?.id === identity.id ? props.analyses[image.id] : undefined
        let cached = refresh ? undefined : saved
        if (!refresh && !cached) { try { cached = await referenceAnalysisCache.get(identity.id) } catch { log.add('临时缓存不可读，继续请求 LLM 分析') } }
        let snapshot: ReferenceAnalysisSnapshot
        if (cached) {
          log.add('命中本地缓存，本次无需请求 LLM；未使用 30 天的临时缓存会清理')
          snapshot = { ...cached, imageId: image.id }
          try { await referenceAnalysisCache.put(snapshot) } catch { log.add('临时缓存不可写，已复用保存在策划中的分析快照') }
        } else {
          log.add('没有有效缓存，准备参考图并请求 LLM')
          const payload = await prepareReferenceImagePayload([image.dataUrl], { signal: controller.signal })
          const result = await analyzeReferenceImage({ profile, image: payload.dataUrls[0], usage, signal: controller.signal, onProgress: log.progress })
          controller.signal.throwIfAborted()
          snapshot = refreshReferenceAnalysis(saved, { ...identity, imageId: image.id, usage, analysis: result, model: profile.model, createdAt: Date.now() })
          try { await referenceAnalysisCache.put(snapshot) } catch { log.add('临时缓存写入失败；分析结果仍会随本次策划保存') }
        }
        controller.signal.throwIfAborted()
        await latest.current.onAnalyses({ ...latest.current.analyses, [image.id]: snapshot }, true)
        log.finish('success', cached ? '已复用参考图分析缓存，未请求 LLM' : '参考图分析完成并已保存；正式生图仍会附带参考原图')
      } else {
        const payload = await prepareReferenceImagePayload(resolved.map((image) => image.dataUrl), { signal: controller.signal })
        log.add('仅使用商品实物图和文字资料提取事实；风格图、构图图不作为商品事实来源')
        const result = await extractProductFacts({ profile, listingText: props.listingText, manualFacts: props.facts.draft, productImages: payload.dataUrls, signal: controller.signal, onProgress: log.progress })
        controller.signal.throwIfAborted()
        await latest.current.onFacts({ ...latest.current.facts, draft: result, draftSource: 'ai' }, true)
        log.finish('success', '商品事实草稿已提取，请逐项核实后点击“确认并保存新版本”；当前已确认版本未被替换')
      }
    } catch (reason) {
      if (controller.signal.aborted) { log.finish('stopped', '本次分析已停止，原有记录已保留'); return }
      const message = reason instanceof Error ? reason.message : String(reason)
      // The log renderer redacts credentials; user-facing errors use that same path.
      setError(message.split(profile.apiKey || '\0').join('[已隐藏密钥]')); log.finish('error', message)
    } finally {
      if (controllerRef.current === controller) { controllerRef.current = null; setBusy(false); latest.current.onBusy(false) }
    }
  }
  const locked = busy || savingFacts || props.disabled
  return <section className="mt-4 rounded-2xl border border-blue-100 bg-white/80 p-3 dark:border-blue-500/20 dark:bg-gray-900/70">
    <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">商品事实确认</h3>
    <p className="mt-1 text-xs leading-relaxed text-gray-500">{current ? `当前使用已确认 v${current.versionNumber}；修改草稿后需要重新确认才会生效。` : '可选：核实商品外观、配件和禁止改动项，减少策划及编辑时把商品画错。草稿不会自动生效。'}</p>
    {current && current.sourceFingerprint !== sourceFingerprint && <p role="status" className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">商品文字或实物参考图已改变，请复核已确认事实。旧版本仍保留。</p>}
    {error && <p role="alert" className="mt-2 whitespace-pre-wrap break-words text-xs text-red-600 dark:text-red-300">{error}</p>}
    <details className="mt-3">
      <summary className="cursor-pointer text-xs font-semibold text-blue-600 dark:text-blue-300">查看 / 编辑商品事实与版本</summary>
      <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={locked} className={BUTTON} onClick={() => void updateFacts({ ...props.facts, draft: factsFromProductDraft(props.draft), draftSource: 'manual' })}>从商品信息填入草稿</button><button type="button" disabled={locked} className={BUTTON} onClick={() => void run('facts')}>{operation === 'facts' && busy ? '正在提取…' : 'AI 提取事实草稿'}</button>{busy && <button type="button" className={BUTTON} onClick={stop}>停止分析</button>}</div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{FACT_FIELDS.map(([key, label]) => <label key={key} className="text-xs text-gray-600 dark:text-gray-300">{label}<input aria-label={`商品事实：${label}`} value={props.facts.draft[key]} disabled={locked} maxLength={2000} placeholder="未知请留空" className={INPUT} onChange={(event) => void updateFacts({ ...props.facts, draft: { ...props.facts.draft, [key]: event.target.value }, draftSource: 'manual' })} /></label>)}{FACT_LIST_FIELDS.map(([key, label]) => <label key={key} className="text-xs text-gray-600 dark:text-gray-300">{label}<textarea aria-label={`商品事实：${label}`} value={props.facts.draft[key].join('\n')} disabled={locked} rows={3} placeholder="每行一项" className={INPUT} onChange={(event) => void updateFacts({ ...props.facts, draft: { ...props.facts.draft, [key]: event.target.value.split('\n') }, draftSource: 'manual' })} /></label>)}</div>
      <p className="mt-2 text-[11px] text-gray-500">材质、尺寸、认证及性能请以实测或资料为准。AI 无法从照片证实的内容请保留在“尚未核实”中。</p>
      <div className="mt-3 flex flex-wrap items-center gap-2"><button type="button" disabled={locked} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40" onClick={() => { try { void updateFacts(confirmProductFacts(props.facts, sourceFingerprint, productImages.map((image) => image.id)), true) } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } }}>确认并保存新版本</button>{current && <button type="button" disabled={locked} className={BUTTON} onClick={() => void updateFacts({ ...props.facts, selectedVersionId: undefined }, true)}>停止使用已确认事实</button>}</div>
      {!!props.facts.versions.length && <div className="mt-3 flex flex-wrap gap-2"><select aria-label="商品事实历史版本" disabled={locked} value={versionId || current?.id || props.facts.versions[props.facts.versions.length - 1].id} className={`${INPUT} mt-0 min-w-0 flex-1`} onChange={(event) => setVersionId(event.target.value)}>{[...props.facts.versions].reverse().map((version) => <option key={version.id} value={version.id}>v{version.versionNumber}{version.id === current?.id ? ' · 当前使用' : ''} · {new Date(version.confirmedAt).toLocaleString('zh-CN')}</option>)}</select><button type="button" disabled={locked} className={BUTTON} onClick={() => { const version = props.facts.versions.find((item) => item.id === (versionId || current?.id || props.facts.versions[props.facts.versions.length - 1].id)); if (version) void updateFacts({ ...props.facts, draft: normalizeProductFacts(version.facts), selectedVersionId: version.id }, true) }}>使用此事实版本</button></div>}
    </details>
    {operation === 'facts' && log.state.status !== 'idle' && <PlannerRunLog state={log.state} onCopy={copyLog} />}
    {target && <ReferenceAnalysisSheet imageId={target.id} usage={normalizeReferenceUsage(props.usages[target.id])} snapshot={analysis} busy={busy && operation === 'reference'} disabled={locked} error={error} onClose={close} onAnalyze={(refresh) => void run('reference', refresh)} onStop={stop} onSave={(snapshot) => props.onAnalyses({ ...props.analyses, [target.id]: snapshot }, true)} log={operation === 'reference' && logImageId === target.id ? <PlannerRunLog state={log.state} onCopy={copyLog} /> : null} />}
  </section>
}

function ReferenceAnalysisSheet({ imageId, usage, snapshot, busy, disabled, error, onClose, onAnalyze, onStop, onSave, log }: {
  imageId: string; usage: ReferenceImageUsage; snapshot?: ReferenceAnalysisSnapshot; busy: boolean; disabled: boolean; error: string
  onClose: () => void; onAnalyze: (refresh: boolean) => void; onStop: () => void; log: React.ReactNode
  onSave: (snapshot: ReferenceAnalysisSnapshot) => Promise<void>
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const effective = snapshot ? effectiveReferenceAnalysis(snapshot) : undefined
  useCloseOnEscape(true, onClose); usePreventBackgroundScroll(true, panelRef); useModalFocus(true, panelRef)
  return createPortal(<Sheet onClose={onClose} panelRef={panelRef} labelledBy="reference-analysis-title" rootClassName="z-[117]" className="flex max-h-[92dvh] max-w-3xl flex-col overflow-hidden pt-5">
    <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-white/[0.08]"><div className="min-w-0 flex-1"><h2 id="reference-analysis-title" className="text-base font-semibold text-gray-900 dark:text-gray-100">参考图分析 · {REFERENCE_PURPOSE_LABELS[usage.purpose]}</h2><p className="mt-1 text-xs text-gray-500">临时缓存未使用 30 天自动清理；保存到策划或素材套组的分析快照随版本保留。</p></div><button type="button" className={`${BUTTON} shrink-0`} onClick={onClose}>关闭</button></div>
    <div className="custom-scrollbar min-h-0 overflow-y-auto p-4"><StoredImage imageId={imageId} alt="当前分析参考图" className="mx-auto max-h-52 rounded-xl object-contain" /><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={disabled} className={BUTTON} onClick={() => onAnalyze(false)}>{snapshot ? '复用缓存 / 检查分析' : '开始分析（优先缓存）'}</button><button type="button" disabled={disabled} className={BUTTON} onClick={() => onAnalyze(true)}>强制重新分析</button>{busy && <button type="button" className={BUTTON} onClick={onStop}>停止分析</button>}</div>
      {error && <p role="alert" className="mt-3 break-words text-xs text-red-600 dark:text-red-300">{error}</p>}{log}
      {snapshot && effective ? <><ReferenceAnalysisEditor snapshot={snapshot} disabled={disabled} onSave={onSave} /><div className="mt-4 space-y-3 text-sm text-gray-700 dark:text-gray-200"><p className="text-[11px] text-gray-500">模型 {snapshot.model} · {new Date(snapshot.createdAt).toLocaleString('zh-CN')} · 已保存分析</p><p className="whitespace-pre-wrap">{effective.summary}</p>{ANALYSIS_LIST_FIELDS.filter(([key]) => effective[key].length).map(([key, label]) => <div key={key}><h3 className="text-xs font-semibold">{label}</h3><ul className="mt-1 list-disc space-y-1 pl-5 text-xs">{effective[key].map((value, index) => <li key={index}>{value}</li>)}</ul></div>)}</div></> : <p className="mt-4 text-xs text-gray-500">还没有与当前图片、用途、范围、说明及模型匹配的分析。策划可直接使用参考原图，无需强制执行此步骤。</p>}
    </div>
  </Sheet>, document.body)
}
