import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PlannerGenerationSpec } from '../lib/plannerGeneration'
import { getImage, hashDataUrl } from '../lib/db'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { useModalFocus } from '../hooks/useModalFocus'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import type { PlannerRunLogState } from '../lib/plannerRunLog'
import PlannerRunLog from './PlannerRunLog'
import StoredImage from './StoredImage'
import { Sheet } from './Sheet'

const BUTTON = 'rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 disabled:opacity-40 dark:border-white/10 dark:text-gray-200'
export default function PlannerGenerationDialog({ mode, specs, activeSlot, busy, log, onCopyLog, onStop, onUpdate, onSubmit, onClose }: {
  mode: 'inspect' | 'queue'; specs: PlannerGenerationSpec[]; activeSlot?: string; busy: boolean; log: PlannerRunLogState
  onCopyLog: () => void; onStop: () => void; onUpdate: (slots: string[]) => Promise<void>; onSubmit: (slots: string[], queue: boolean) => Promise<void>; onClose: () => void
}) {
  const [selected, setSelected] = useState<string[]>(activeSlot ? [activeSlot] : specs.map((item) => item.slot))
  const [localBusy, setLocalBusy] = useState(false), [error, setError] = useState(''), [images, setImages] = useState<Record<string, { present: boolean; analysisValid?: boolean }>>({})
  const panelRef = useRef<HTMLDivElement>(null)
  const close = () => { if (!busy && !localBusy) onClose() }
  useCloseOnEscape(true, close); useModalFocus(true, panelRef); usePreventBackgroundScroll(true, panelRef)
  const sourceKey = JSON.stringify(specs.map((item) => [item.slot, item.references.map((ref) => [ref.id, ref.analysis?.imageHash])]))
  useEffect(() => {
    let cancelled = false
    const refs = [...new Map(specs.flatMap((item) => item.references).map((ref) => [ref.id, ref])).values()]
    void Promise.all(refs.map(async (ref) => { const image = await getImage(ref.id); return [ref.id, { present: !!image?.dataUrl, analysisValid: ref.analysis ? !!image && await hashDataUrl(image.dataUrl) === ref.analysis.imageHash : undefined }] as const }))
      .then((entries) => { if (!cancelled) setImages(Object.fromEntries(entries)) }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { cancelled = true }
  }, [sourceKey])
  const shown = mode === 'inspect' ? specs.filter((item) => item.slot === activeSlot) : specs
  const chosen = shown.filter((item) => selected.includes(item.slot)), stale = chosen.filter((item) => item.stale)
  const checksPending = chosen.some((item) => item.references.some((ref) => !images[ref.id]))
  const invalid = chosen.some((item) => item.errors.length || item.references.some((ref) => images[ref.id]?.present === false))
  const attempt = async (work: () => Promise<void>) => { setLocalBusy(true); setError(''); try { await work() } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setLocalBusy(false) } }
  return createPortal(<Sheet onClose={close} panelRef={panelRef} labelledBy="planner-generation-title" rootClassName="z-[117]" className="flex max-h-[92dvh] max-w-4xl flex-col overflow-hidden pt-5">
    <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-white/10"><div><h2 id="planner-generation-title" className="text-base font-semibold text-gray-900 dark:text-gray-100">{mode === 'queue' ? '整套生成队列 · 选择图片位' : '生成前检查 · 实际参考图'}</h2><p className="mt-1 text-xs text-gray-500">核对实际发送顺序、用途、事实版本和尺寸。每个图片位生成 1 张。</p></div><button type="button" disabled={busy || localBusy} className={`${BUTTON} shrink-0`} onClick={close}>关闭检查</button></div>
    <div className="custom-scrollbar min-h-0 overflow-y-auto p-4">{mode === 'queue' && <label className="mb-3 flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300"><input type="checkbox" aria-label="选择全部策划图片位" checked={!!shown.length && shown.every((item) => selected.includes(item.slot))} onChange={(event) => setSelected(event.target.checked ? shown.map((item) => item.slot) : [])} disabled={busy || localBusy} />选择全部图片位</label>}
      <div className="space-y-3">{shown.map((spec) => <article key={spec.slot} className="rounded-xl border border-gray-200 p-3 dark:border-white/10"><label className="flex items-start gap-2 text-sm font-semibold text-gray-800 dark:text-gray-100">{mode === 'queue' && <input type="checkbox" aria-label={`队列选择 ${spec.slot}`} disabled={busy || localBusy} checked={selected.includes(spec.slot)} onChange={(event) => setSelected((ids) => event.target.checked ? [...ids, spec.slot] : ids.filter((id) => id !== spec.slot))} />}<span>{spec.slot} · {spec.label}</span></label><p className="mt-1 text-xs text-gray-500">策划 {spec.versionLabel} · {spec.size} · {spec.factsVersion ? `商品事实 v${spec.factsVersion}` : '未绑定已确认事实'} · 实际发送 {spec.references.length} 张参考图</p>
        {spec.stale && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">此方案引用的事实或参考上下文已变化，可先更新此图片位。</p>}
        {!!spec.errors.length && <ul className="mt-2 list-disc pl-4 text-xs text-red-600">{spec.errors.map((value) => <li key={value}>{value}</li>)}</ul>}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{spec.references.map((ref, index) => <div key={ref.id} className="min-w-0 rounded-lg bg-gray-50 p-2 text-[11px] text-gray-500 dark:bg-gray-950"><StoredImage imageId={ref.id} alt={`${spec.slot} 实际参考图 ${index + 1}`} className="aspect-square w-full rounded object-contain" /><strong className="mt-1 block text-gray-700 dark:text-gray-200">第 {index + 1} 张{ref.hidden ? ' · 隐藏风格图' : ''}</strong><p className="mt-1 break-words">{ref.role}</p><p className="mt-1">{!images[ref.id] ? '核对原图中…' : images[ref.id].present ? '原图可用' : '原图缺失，请重新选择'}</p>{ref.analysis && <p>{images[ref.id]?.analysisValid ? `含${ref.analysis.selectedRevisionId ? '人工修订' : 'AI'}分析` : '分析与原图不匹配，生成时跳过分析文本'}</p>}</div>)}</div>
        {!spec.references.length && <p className="mt-2 text-xs text-gray-500">本项为纯文本生图，不附参考图片。</p>}{!!spec.excludedIds.length && <p className="mt-2 text-[11px] text-gray-500">另有 {spec.excludedIds.length} 张参考图限定其他图片位，本次不发送。</p>}<details className="mt-2 text-xs text-gray-500"><summary className="cursor-pointer">查看本次生图提示词</summary><pre className="mt-2 whitespace-pre-wrap break-words">{spec.prompt}</pre></details>
      </article>)}</div>
      {error && <p role="alert" className="mt-3 whitespace-pre-wrap break-words text-xs text-red-600 dark:text-red-300">{error}</p>}
      {(busy || log.status !== 'idle') && <PlannerRunLog state={log} onCopy={onCopyLog} />}
      <div className="sticky bottom-0 mt-4 flex flex-wrap items-center gap-2 rounded-xl bg-white/95 p-3 dark:bg-gray-900/95"><span className="mr-auto text-xs text-gray-500">本次选择 {chosen.length} 项 · 将生成 {chosen.length} 张图片</span>{busy && <button type="button" className={BUTTON} onClick={onStop}>停止更新策划</button>}<button type="button" className={BUTTON} disabled={busy || localBusy || !stale.length} onClick={() => void attempt(() => onUpdate(stale.map((item) => item.slot)))}>只更新受影响模块（{stale.length}）</button><button type="button" disabled={busy || localBusy || !chosen.length || invalid || checksPending} onClick={() => void attempt(() => onSubmit(chosen.map((item) => item.slot), mode === 'queue'))} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">{localBusy ? '正在处理…' : mode === 'queue' ? '加入并生成选中项' : '生成此图'}</button></div>
    </div>
  </Sheet>, document.body)
}
