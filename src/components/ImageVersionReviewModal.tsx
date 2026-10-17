import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { DEFAULT_PARAMS } from '../types'
import { openImageInSeedreamEditor, openOutputInReferenceLibrary, useStore } from '../store'
import { buildImageVersionHistory } from '../lib/imageVersions'
import { materialItemFromTask } from '../lib/materialCollections'
import { localId } from '../lib/localId'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { useModalFocus } from '../hooks/useModalFocus'
import { Sheet } from './Sheet'
import StoredImage from './StoredImage'
import { CloseIcon } from './icons'

const BUTTON = 'rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-white/[0.1] dark:bg-gray-900 dark:text-gray-200'

function ComparisonPane({ imageId, label, zoom }: { imageId: string; label: string; zoom: number }) {
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  return <section className="min-w-0 overflow-hidden rounded-xl border border-gray-200 dark:border-white/[0.1]">
    <div className="border-b border-gray-100 px-3 py-2 text-xs font-semibold text-gray-600 dark:border-white/[0.08] dark:text-gray-300">{label}</div>
    <div className="h-[28dvh] touch-pan-x touch-pan-y overflow-auto bg-gray-100 dark:bg-gray-950 sm:h-[39dvh]" style={{ cursor: zoom > 100 ? 'grab' : 'default' }}
      onPointerDown={(event) => { if (zoom <= 100) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop } }}
      onPointerMove={(event) => { if (!drag.current) return; event.currentTarget.scrollLeft = drag.current.left + drag.current.x - event.clientX; event.currentTarget.scrollTop = drag.current.top + drag.current.y - event.clientY }}
      onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}>
      <div className="flex items-center justify-center" style={{ width: `${zoom}%`, height: `${zoom}%`, minWidth: '100%', minHeight: '100%' }}>
        <StoredImage imageId={imageId} alt={label} draggable={false} className="h-full w-full select-none object-contain" />
      </div>
    </div>
  </section>
}

export default function ImageVersionReviewModal() {
  const imageId = useStore((state) => state.reviewImageId)
  const tasks = useStore((state) => state.tasks)
  const reviews = useStore((state) => state.imageResultReviews)
  const finals = useStore((state) => state.imageFinalSelections)
  const collections = useStore((state) => state.materialCollections)
  const [rightId, setRightId] = useState('')
  const [leftId, setLeftId] = useState('')
  const [note, setNote] = useState('')
  const [zoom, setZoom] = useState(100)
  const panelRef = useRef<HTMLDivElement>(null)
  const versions = useMemo(() => imageId ? buildImageVersionHistory(tasks, imageId) : [], [tasks, imageId])
  const current = versions.find((version) => version.imageId === rightId) ?? versions.find((version) => version.imageId === imageId)
  const saved = useMemo(() => {
    for (const collection of collections) for (const version of [...collection.versions].reverse()) {
      const item = version.items.find((item) => item.imageId === current?.imageId)
      if (item) return { item, title: collection.title, createdAt: version.createdAt }
    }
    return undefined
  }, [collections, current?.imageId])
  const root = versions[0]?.rootImageId ?? ''
  const close = () => useStore.getState().setReviewImageId(null)
  useCloseOnEscape(Boolean(imageId), close)
  usePreventBackgroundScroll(Boolean(imageId), panelRef)
  useModalFocus(Boolean(imageId), panelRef)
  useEffect(() => { if (imageId) { const rows = buildImageVersionHistory(tasks, imageId); setRightId(imageId); setLeftId(rows[0]?.imageId ?? imageId); setZoom(100) } }, [imageId])
  useEffect(() => { setNote(reviews[rightId]?.note ?? saved?.item.reviewNote ?? '') }, [rightId, saved])
  if (!imageId || !current) return null
  const versionLabel = (id: string) => { const version = versions.find((item) => item.imageId === id); return `v${version?.versionNumber ?? 1}${id === root ? ' · 原始版本' : ''}${finals[root] === id ? ' · 最终稿' : ''}` }
  const save = (status: 'approved' | 'changes-requested' | 'pending') => {
    useStore.getState().saveImageReview(root, current.imageId, status, note)
    useStore.getState().showToast(status === 'approved' ? '已设为最终稿，旧版本仍保留' : '审核意见已保存', 'success')
  }
  const edit = () => { openImageInSeedreamEditor(current.imageId); if (note.trim()) useStore.getState().updateImageEditorDraft(current.imageId, { instruction: note.trim() }); close() }
  const collect = () => {
    const item = current.task ? materialItemFromTask(current.task, current.imageId) : saved?.item ?? { id: localId('material-item'), imageId: current.imageId, slot: '', label: '原图', prompt: '', params: { ...DEFAULT_PARAMS }, referenceImageIds: [] }
    useStore.getState().openMaterialLibrary({ title: current.task?.category?.productTitle || saved?.title || '图片版本收藏', items: [{ ...item, reviewNote: note }] }); close()
  }
  return createPortal(<Sheet onClose={close} panelRef={panelRef} rootClassName="z-[116]" labelledBy="image-version-review-title" className="flex max-h-[92dvh] max-w-6xl flex-col overflow-hidden pt-5">
    <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-white/[0.08]">
      <div><h2 id="image-version-review-title" className="text-base font-semibold text-gray-900 dark:text-gray-100">生成结果对比与版本</h2><p className="mt-1 text-xs text-gray-500">共 {versions.length} 个版本；重新生成会保留历史，可选择最终稿。</p></div>
      <button type="button" className={BUTTON} onClick={close} aria-label="关闭图片版本对比"><CloseIcon className="h-4 w-4" /></button>
    </div>
    <div className="custom-scrollbar min-h-0 overflow-y-auto p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-gray-600 dark:text-gray-300">
        <label>对照 <select aria-label="对照图片版本" className={`${BUTTON} ml-2`} value={leftId} onChange={(event) => setLeftId(event.target.value)}>{versions.map((version) => <option key={version.imageId} value={version.imageId}>{versionLabel(version.imageId)}</option>)}</select></label>
        <label>当前 <select aria-label="当前图片版本" className={`${BUTTON} ml-2`} value={current.imageId} onChange={(event) => { setRightId(event.target.value); setZoom(100) }}>{versions.map((version) => <option key={version.imageId} value={version.imageId}>{versionLabel(version.imageId)}</option>)}</select></label>
        <label className="ml-auto flex items-center gap-2">同步缩放 <input aria-label="对比图片同步缩放" type="range" min="100" max="300" step="25" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} className="w-24" /><span>{zoom}%</span></label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2"><ComparisonPane imageId={leftId || root} label={`对照：${versionLabel(leftId || root)}`} zoom={zoom} /><ComparisonPane imageId={current.imageId} label={`当前：${versionLabel(current.imageId)}`} zoom={zoom} /></div>
      <div className="mt-3 flex flex-wrap gap-2">{versions.map((version) => <button key={version.imageId} type="button" aria-pressed={version.imageId === current.imageId} onClick={() => setRightId(version.imageId)} className={`${BUTTON} ${version.imageId === current.imageId ? 'ring-2 ring-blue-400/50' : ''}`}>{versionLabel(version.imageId)}{reviews[version.imageId]?.status === 'changes-requested' ? ' · 待修改' : ''}</button>)}</div>
      <label className="mt-4 block text-xs font-medium text-gray-600 dark:text-gray-300">审核意见 / 下一次编辑要求<textarea aria-label="图片版本审核意见" value={note} onChange={(event) => setNote(event.target.value)} rows={2} maxLength={4000} placeholder="例如：保留构图，修正商品颜色和文字。" className="mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm dark:border-white/[0.1] dark:bg-gray-950 dark:text-gray-100" /></label>
      <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => save('approved')} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white">通过并设为最终稿</button><button type="button" onClick={() => save('changes-requested')} className={BUTTON}>标记需要修改</button><button type="button" onClick={() => save(reviews[current.imageId]?.status ?? 'pending')} className={BUTTON}>保存意见</button><button type="button" onClick={edit} className={BUTTON}>编辑当前版本</button><button type="button" onClick={collect} className={BUTTON}>收藏当前版本</button></div>
      <button type="button" onClick={() => { openOutputInReferenceLibrary(current.imageId, current.task?.category ?? saved?.item.category); close() }} className={`${BUTTON} mt-3`}>存入参考图库</button>
      <details className="mt-4 text-xs text-gray-500"><summary className="cursor-pointer">查看本版本提示词与生成时间</summary><p className="mt-2">{current.createdAt ? new Date(current.createdAt).toLocaleString('zh-CN') : saved ? `收藏时间：${new Date(saved.createdAt).toLocaleString('zh-CN')}` : '原始图片（生成记录未保留）'}</p><pre className="mt-2 whitespace-pre-wrap break-words">{current.task?.imageEditContext?.userInstruction || current.task?.prompt || saved?.item.prompt || '原始图片，无生成提示词。'}</pre></details>
    </div>
  </Sheet>, document.body)
}
