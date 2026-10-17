import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AmazonPlannerSession, MaterialCollection, MaterialCollectionItem, MaterialCollectionVersion } from '../types'
import { buildFinalSetRows, finalSetCollectionDraft, finalSetDeliveryCollection, FINAL_SET_STATUS_LABELS } from '../lib/finalSets'
import { getImage } from '../lib/db'
import { loadImage } from '../lib/canvasImage'
import { materialAPlusPlan } from '../lib/imageDelivery'
import { openImageInSeedreamEditor, openOutputInReferenceLibrary, saveFinalSetSelection, useStore } from '../store'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { useModalFocus } from '../hooks/useModalFocus'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import MaterialDeliveryDialog from './MaterialDeliveryDialog'
import StoredImage from './StoredImage'
import { Sheet } from './Sheet'

const BUTTON = 'rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 disabled:opacity-40 dark:border-white/10 dark:bg-gray-900 dark:text-gray-200'
interface Availability { exists: boolean; dimensions?: string; format?: string }
export default function FinalSetOverviewModal({ session, scope, title, version, onClose }: { session?: AmazonPlannerSession; scope: string; title: string; version?: MaterialCollectionVersion; onClose: () => void }) {
  const tasks = useStore((state) => state.tasks), collections = useStore((state) => state.materialCollections)
  const reviews = useStore((state) => state.imageResultReviews), finals = useStore((state) => state.imageFinalSelections), selections = useStore((state) => state.finalSetSelections)
  const rows = useMemo(() => buildFinalSetRows({ session, tasks, collections, reviews, finals, selections, scope, version }), [session, tasks, collections, reviews, finals, selections, scope, version])
  const [previewIds, setPreviewIds] = useState<Record<string, string>>({}), [notes, setNotes] = useState<Record<string, string>>({}), [filter, setFilter] = useState('all')
  const [availability, setAvailability] = useState<Record<string, Availability>>({}), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [delivery, setDelivery] = useState<MaterialCollection | null>(null)
  const panelRef = useRef<HTMLDivElement>(null), close = () => { if (!busy && !delivery) onClose() }
  useCloseOnEscape(true, close); useModalFocus(true, panelRef); usePreventBackgroundScroll(true, panelRef)
  const preview = (row: typeof rows[number]) => row.candidates.find((item) => item.imageId === previewIds[row.slot]) ?? row.selected
  const neededIds = [...new Set(rows.flatMap((row) => [preview(row)?.imageId, row.final?.imageId]).filter((id): id is string => !!id))].sort().join('|')
  useEffect(() => {
    let stopped = false
    void (async () => {
      for (const id of neededIds ? neededIds.split('|') : []) {
        if (availability[id]) continue
        let value: Availability = { exists: false }
        try {
          const image = await getImage(id)
          if (image?.dataUrl) {
            const dimensions = image.width && image.height ? { width: image.width, height: image.height } : await loadImage(image.dataUrl).then((img) => ({ width: img.naturalWidth, height: img.naturalHeight }))
            value = { exists: true, dimensions: `${dimensions.width} × ${dimensions.height}`, format: image.dataUrl.match(/^data:image\/([^;,]+)/)?.[1]?.toUpperCase() ?? '图片' }
          }
        } catch { /* A missing or undecodable original must never be silently delivered. */ }
        if (stopped) return
        setAvailability((current) => ({ ...current, [id]: value }))
      }
    })()
    return () => { stopped = true }
  }, [neededIds])
  const checkedRows = rows.map((row) => row.final && availability[row.final.imageId]?.exists === false ? { ...row, final: undefined, status: 'needs-review' as const, reason: '最终稿原图已丢失，请恢复本地数据备份' } : row)
  const ready = checkedRows.filter((row) => row.status === 'approved' && row.final && availability[row.final.imageId]?.exists)
  const shown = checkedRows.filter((row) => filter === 'all' || (filter === 'unfinished' ? row.status !== 'approved' : !row.candidates.length))
  const attempt = async (work: () => Promise<void>) => { if (busy) return; setBusy(true); setError(''); try { await work() } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setBusy(false) } }
  const versionLabel = (item: MaterialCollectionItem) => {
    const key = `${session?.mode ?? (item.slot.startsWith('A+') ? 'aplus' : 'listing')}:${item.slot}`
    const plan = session?.moduleVersions?.[key]?.find((row) => row.id === item.category?.plannerModuleVersionId)
    return `${plan ? `策划 v${plan.versionNumber}` : '原策划版本未记录'} · ${item.category?.workflow === 'seedream-edit' ? '编辑结果' : '生成结果'}`
  }
  async function deliveryDraft() {
    const usable = checkedRows.filter((row) => ready.some((item) => item.slot === row.slot))
    for (const row of usable) if (!await getImage(row.final!.imageId)) { setAvailability((current) => ({ ...current, [row.final!.imageId]: { exists: false } })); throw new Error(`${row.slot} 原图已丢失，请恢复备份后重试`) }
    return finalSetCollectionDraft(title, scope, checkedRows.map((row) => usable.some((item) => item.slot === row.slot) ? row : { ...row, final: undefined, status: 'pending' }), session)
  }
  return <>{delivery && <MaterialDeliveryDialog collection={delivery} versionId="confirmed" onClose={() => setDelivery(null)} />}{createPortal(<Sheet panelRef={panelRef} onClose={close} labelledBy="final-set-title" rootClassName="z-[117]" className="flex max-h-[92dvh] max-w-6xl flex-col overflow-hidden pt-5">
    <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-white/10"><div><h2 id="final-set-title" className="font-semibold text-gray-900 dark:text-gray-100">整套最终稿总览 · {title}</h2><p className="mt-1 text-xs text-gray-500">按图片位确认最终稿。新生成结果不会自动替换已确认的图片；来源变化后需重新复核。</p></div><button type="button" className={BUTTON} disabled={busy || !!delivery} onClick={close}>关闭最终稿总览</button></div>
    <div className="custom-scrollbar min-h-0 overflow-y-auto p-4"><div className="mb-4 flex flex-wrap items-center gap-3 text-xs text-gray-600 dark:text-gray-300"><strong>已确认且原图可用 {ready.length} / {rows.length}</strong><span>缺少结果 {rows.filter((row) => !row.candidates.length).length} 项</span><select aria-label="最终稿总览筛选" value={filter} onChange={(event) => setFilter(event.target.value)} className={BUTTON}><option value="all">全部图片位</option><option value="unfinished">尚未确认</option><option value="missing">缺少结果</option></select></div>
      {error && <p role="alert" className="mb-3 text-xs text-red-600">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{shown.map((row) => {
        const item = preview(row), info = item ? availability[item.imageId] : undefined, noteKey = `${row.slot}:${item?.imageId ?? ''}`
        const savedSelection = selections[scope]?.[row.slot]
        const note = notes[noteKey] ?? (item ? savedSelection?.imageId === item.imageId ? savedSelection.item?.reviewNote ?? item.reviewNote ?? '' : item.reviewNote ?? '' : '')
        const copy = item ? materialAPlusPlan(item, version ?? { id: '', versionNumber: 1, createdAt: 0, note: '', items: [], plannerSession: session }) : undefined
        return <article key={row.slot} aria-label={`最终稿图片位 ${row.slot}`} className="min-w-0 rounded-xl border border-gray-200 p-3 dark:border-white/10"><div className="flex items-start justify-between gap-2"><h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{row.slot.startsWith('image:') ? row.label : `${row.slot} · ${row.label}`}</h3><span className={`shrink-0 rounded px-2 py-1 text-[10px] ${row.status === 'approved' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200'}`}>{FINAL_SET_STATUS_LABELS[row.status]}</span></div>
          <div className="mt-2 flex aspect-square items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-950">{item ? <StoredImage imageId={item.imageId} alt={`${row.slot} 最终稿候选`} className="h-full w-full object-contain" /> : <span className="p-3 text-center text-xs text-gray-500">{row.reason}</span>}</div>
          <p className="mt-2 text-xs text-gray-500">{row.reason}</p>
          {item && <><label className="mt-2 block text-xs text-gray-600 dark:text-gray-300">候选结果（{row.candidates.length}）<select aria-label={`${row.slot} 最终稿候选`} value={item.imageId} onChange={(event) => setPreviewIds((current) => ({ ...current, [row.slot]: event.target.value }))} className={`${BUTTON} mt-1 w-full`}>{row.candidates.map((candidate, index) => <option key={candidate.imageId} value={candidate.imageId}>结果 {index + 1} · {versionLabel(candidate)}{row.final?.imageId === candidate.imageId ? ' · 当前最终稿' : ''}</option>)}</select></label>
            <p className="mt-2 text-[11px] text-gray-500">{info ? info.exists ? `实际 ${info.dimensions} px · ${info.format}` : '原图丢失或无法解码' : '正在核对原图与尺寸…'}{row.currentVersionNumber ? ` · 当前策划 v${row.currentVersionNumber}` : ''}</p>
            {row.slot.startsWith('A+') && <p className="mt-1 text-[11px] text-gray-500">{copy ? `${copy.uploadSize} · ${copy.textTitle || copy.textBody ? '已关联本结果的 A+ 外置文案' : '此模块无外置文案'}` : '此结果未关联可核实的 A+ 文案版本'}</p>}
            <label className="mt-2 block text-xs text-gray-600 dark:text-gray-300">审核意见<textarea aria-label={`${row.slot} 最终稿审核意见`} rows={2} maxLength={4000} value={note} onChange={(event) => setNotes((current) => ({ ...current, [noteKey]: event.target.value }))} className="mt-1 w-full rounded-lg border border-gray-200 bg-white p-2 text-xs dark:border-white/10 dark:bg-gray-950" /></label>
            <button type="button" disabled={busy || !info?.exists} onClick={() => void attempt(async () => { await saveFinalSetSelection(scope, row.slot, { imageId: item.imageId, confirmedAt: Date.now(), contextFingerprint: row.contextFingerprint, plannerModuleVersionId: row.currentVersionId, item: { ...item, reviewNote: note } }, note); useStore.getState().showToast(`${row.slot} 最终稿已确认`, 'success') })} className="mt-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">{row.final?.imageId === item.imageId ? '重新确认并保存意见' : '设为此图片位最终稿'}</button>
            <div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={busy} className={BUTTON} onClick={() => { onClose(); useStore.getState().setReviewImageId(item.imageId) }}>对比版本</button><button type="button" disabled={busy || !info?.exists} className={BUTTON} onClick={() => { onClose(); openImageInSeedreamEditor(item.imageId) }}>编辑此图</button><button type="button" disabled={busy || !info?.exists} className={BUTTON} onClick={() => { onClose(); openOutputInReferenceLibrary(item.imageId, item.category) }}>存入参考图库</button></div>
          </>}
        </article>
      })}</div>
      {!shown.length && <p className="py-8 text-center text-sm text-gray-500">当前筛选下没有图片位。</p>}
      <div className="sticky bottom-0 mt-4 rounded-xl bg-white/95 p-3 dark:bg-gray-900/95"><p className="mb-2 text-xs text-gray-500">{ready.length === rows.length && rows.length ? '所有图片位已确认，可导出整套最终稿。' : `尚有 ${rows.length - ready.length} 项未确认或原图不可用；部分导出会在清单中列出缺项。`}</p><div className="flex flex-wrap gap-2"><button type="button" disabled={busy || !rows.length || ready.length !== rows.length} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40" onClick={() => void attempt(async () => setDelivery(finalSetDeliveryCollection(await deliveryDraft())))}>整套最终稿交付 / ZIP</button><button type="button" disabled={busy || !ready.length} className={BUTTON} onClick={() => void attempt(async () => setDelivery(finalSetDeliveryCollection(await deliveryDraft())))}>仅导出已确认项（{ready.length}）</button><button type="button" disabled={busy || !ready.length} className={BUTTON} onClick={() => void attempt(async () => { const draft = await deliveryDraft(); onClose(); useStore.getState().openMaterialLibrary(draft) })}>收藏已确认最终稿</button></div></div>
    </div>
  </Sheet>, document.body)}</>
}
