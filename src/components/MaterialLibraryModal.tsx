import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore, saveMaterialCollection, removeMaterialCollection, renameMaterialCollection, reuseMaterialItem, openImageInSeedreamEditor, exportData } from '../store'
import { localId } from '../lib/localId'
import { materialCollectionCandidates } from '../lib/materialCollections'
import { downloadImageIds } from '../lib/downloadImages'
import MaterialDeliveryDialog from './MaterialDeliveryDialog'
import FinalSetOverviewModal from './FinalSetOverviewModal'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { useModalFocus } from '../hooks/useModalFocus'
import { Sheet } from './Sheet'
import StoredImage from './StoredImage'
import { CloseIcon } from './icons'

const BUTTON = 'rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-white/[0.1] dark:bg-gray-900 dark:text-gray-200'
const INPUT = 'rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 dark:border-white/[0.1] dark:bg-gray-950 dark:text-gray-100'

export default function MaterialLibraryModal() {
  const open = useStore((state) => state.materialLibraryOpen)
  const collections = useStore((state) => state.materialCollections)
  const draft = useStore((state) => state.materialCollectionDraft)
  const [selectedId, setSelectedId] = useState('')
  const [versionId, setVersionId] = useState('')
  const [title, setTitle] = useState('')
  const [targetId, setTargetId] = useState('')
  const [note, setNote] = useState('')
  const [selectedImages, setSelectedImages] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [deliveryVersionId, setDeliveryVersionId] = useState('')
  const [finalVersionId, setFinalVersionId] = useState('')
  const [error, setError] = useState('')
  const [rename, setRename] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [search, setSearch] = useState('')
  const candidateItems = useMemo(() => draft ? materialCollectionCandidates(draft, collections.find((item) => item.id === targetId)) : [], [draft, targetId, collections])
  const panelRef = useRef<HTMLDivElement>(null)
  const collection = collections.find((item) => item.id === selectedId)
  const version = collection?.versions.find((item) => item.id === versionId) ?? collection?.versions[collection.versions.length - 1]
  const visibleCollections = useMemo(() => [...collections].filter((item) => !search.trim() || item.title.toLowerCase().includes(search.trim().toLowerCase())).sort((a, b) => b.updatedAt - a.updatedAt), [collections, search])
  const close = () => { if (!busy && !deliveryVersionId && !finalVersionId) useStore.getState().closeMaterialLibrary() }
  useCloseOnEscape(open, close)
  usePreventBackgroundScroll(open, panelRef)
  useModalFocus(open, panelRef)
  useEffect(() => {
    if (!open) return
    setError(''); setConfirmDelete(false)
    if (draft) {
      setTitle(draft.title); setTargetId(''); setNote('')
    }
  }, [open, draft])
  useEffect(() => {
    if (!open || !draft) return
    const slots = new Set<string>()
    setSelectedImages(candidateItems.filter((item) => {
      if ((!draft.plannerSession && !targetId) || !item.slot) return true
      if (slots.has(item.slot)) return false
      slots.add(item.slot); return true
    }).map((item) => item.id))
  }, [open, draft, candidateItems, targetId])
  useEffect(() => { setVersionId(''); setRename(collection?.title ?? ''); setConfirmDelete(false) }, [selectedId])
  if (!open) return null
  const attempt = async (work: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true); setError('')
    try { await work() } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setBusy(false) }
  }
  const save = () => draft && attempt(async () => {
    const saved = await saveMaterialCollection({ ...draft, title, items: candidateItems.filter((item) => selectedImages.includes(item.id)) }, targetId || undefined, note)
    useStore.setState({ materialCollectionDraft: null })
    setSelectedId(saved.id); setVersionId('')
    useStore.getState().showToast('素材套组已保存到本地', 'success')
  })
  const restore = () => {
    if (!version?.plannerSession) return
    const at = Date.now()
    const session = JSON.parse(JSON.stringify(version.plannerSession))
    useStore.getState().requestPlannerRestore({ ...session, id: localId('planner'), sourceCollection: { collectionId: collection!.id, versionId: version.id }, createdAt: at, updatedAt: at })
    close()
  }
  return <>{collection && finalVersionId && <FinalSetOverviewModal key={`${collection.id}:${finalVersionId}`} session={collection.versions.find((row) => row.id === finalVersionId)?.plannerSession} version={collection.versions.find((row) => row.id === finalVersionId)} scope={`collection:${collection.id}:${finalVersionId}`} title={collection.title} onClose={() => setFinalVersionId('')} />}{collection && deliveryVersionId && <MaterialDeliveryDialog collection={collection} versionId={deliveryVersionId} onClose={() => setDeliveryVersionId('')} />}{createPortal(<Sheet onClose={close} panelRef={panelRef} rootClassName="z-[115]" labelledBy="material-library-title" className="flex max-h-[92dvh] max-w-5xl flex-col overflow-hidden pt-5">
    <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-white/[0.08]">
      <div><h2 id="material-library-title" className="text-base font-semibold text-gray-900 dark:text-gray-100">{draft ? '收藏成套素材' : '素材收藏库'}</h2><p className="mt-1 text-xs text-gray-500">保存在当前浏览器。套组保留图片、提示词、参考图和策划快照，可通过本地数据备份迁移。</p></div>
      <button type="button" disabled={busy} onClick={close} className={BUTTON} aria-label="关闭素材收藏库"><CloseIcon className="h-4 w-4" /></button>
    </div>
    <div className="custom-scrollbar min-h-0 overflow-y-auto p-4">
      {error && <p role="alert" className="mb-3 rounded-xl bg-red-50 p-3 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
      {draft ? <div>
        <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-gray-600 dark:text-gray-300">保存位置<select aria-label="素材套组保存位置" value={targetId} onChange={(event) => { setTargetId(event.target.value); setTitle(collections.find((item) => item.id === event.target.value)?.title ?? draft.title) }} className={`${INPUT} mt-1.5 w-full`}><option value="">创建新套组</option>{collections.map((item) => <option key={item.id} value={item.id}>{item.title} · 新增版本</option>)}</select></label><label className="text-xs text-gray-600 dark:text-gray-300">套组名称<input aria-label="素材套组名称" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} className={`${INPUT} mt-1.5 w-full`} /></label></div>
        <label className="mt-3 block text-xs text-gray-600 dark:text-gray-300">版本说明<input aria-label="素材套组版本说明" value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} placeholder="例如：确认版、替换主图后的第二版" className={`${INPUT} mt-1.5 w-full`} /></label>
        <p className="mt-4 text-xs text-gray-500">选择要保留的图片（已选 {selectedImages.length}/{candidateItems.length}）。{draft.plannerSession && '整套策划和参考图配置也会保存。'}{targetId && !draft.finalSet && '已带上原套组素材；同图片位优先选中新结果，其余可自行调整。'}{draft.finalSet && '本次只收藏已确认最终稿；取消勾选的图片位会记为缺项。'}</p>
        {!candidateItems.length && <p className="mt-3 rounded-xl bg-blue-50 p-3 text-xs text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">目前没有生成结果，本次将收藏策划与参考配置；生图后可向同一套组追加版本。</p>}
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">{candidateItems.map((item) => <label key={item.id} className="overflow-hidden rounded-xl border border-gray-200 p-2 dark:border-white/[0.1]"><div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-950"><StoredImage imageId={item.imageId} alt={item.label} className="h-full w-full object-contain" /></div><span className="mt-2 flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300"><input type="checkbox" checked={selectedImages.includes(item.id)} onChange={(event) => setSelectedImages((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} />{item.slot || item.label}</span></label>)}</div>
        <div className="mt-4 flex gap-2"><button type="button" disabled={busy || !title.trim() || (!selectedImages.length && !draft.plannerSession)} onClick={() => void save()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy ? '正在保存…' : targetId ? '保存为新版本' : '保存素材套组'}</button><button type="button" disabled={busy} onClick={() => useStore.setState({ materialCollectionDraft: null })} className={BUTTON}>返回素材库</button></div>
      </div> : <>
        <div className="mb-4 flex flex-wrap items-center gap-2"><input aria-label="搜索素材套组" placeholder="搜索套组名称" value={search} onChange={(event) => setSearch(event.target.value)} className={`${INPUT} min-w-0 flex-1`} /><button type="button" onClick={() => void attempt(() => exportData({ exportTasks: true, exportConfig: false }))} className={BUTTON}>备份本地数据</button></div>
        {!collection ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visibleCollections.map((item) => { const latest = item.versions[item.versions.length - 1]; return <button type="button" key={item.id} onClick={() => setSelectedId(item.id)} className="overflow-hidden rounded-xl border border-gray-200 bg-white p-3 text-left transition hover:border-blue-400 dark:border-white/[0.1] dark:bg-gray-900"><div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-950">{latest?.items[0] ? <StoredImage imageId={latest.items[0].imageId} alt={item.title} className="h-full w-full object-contain" /> : <span className="text-xs text-gray-400">策划与参考配置</span>}</div><div className="mt-3 font-semibold text-gray-800 dark:text-gray-100">{item.title}</div><p className="mt-1 text-xs text-gray-500">{item.versions.length} 个版本 · {latest?.items.length ?? 0} 张图片</p></button> })}
          {!visibleCollections.length && <p className="col-span-full rounded-xl border border-dashed border-gray-200 p-10 text-center text-sm text-gray-500 dark:border-white/[0.1]">{search ? '没有找到匹配的素材套组。' : '还没有素材套组。可在首页点击“收藏整套素材”，或从图片对比窗口收藏结果。'}</p>}
        </div> : <div>
          <div className="flex flex-wrap items-center gap-2"><button type="button" onClick={() => setSelectedId('')} className={BUTTON}>返回套组列表</button><h3 className="min-w-0 break-words font-semibold text-gray-900 dark:text-gray-100">{collection.title}</h3><select aria-label="素材套组版本" className={`${INPUT} ml-auto`} value={version?.id ?? ''} onChange={(event) => setVersionId(event.target.value)}>{[...collection.versions].reverse().map((item) => <option key={item.id} value={item.id}>v{item.versionNumber} · {new Date(item.createdAt).toLocaleDateString('zh-CN')}</option>)}</select></div>
          {version?.note && <p className="mt-3 text-xs text-gray-500">{version.note}</p>}
          <button type="button" disabled={busy || !version} onClick={() => setFinalVersionId(version!.id)} className={`${BUTTON} mt-3`}>整套最终稿总览</button>
          <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={!version?.plannerSession || busy} onClick={restore} className={BUTTON}>恢复整套策划</button><button type="button" disabled={!version?.items.length || busy} onClick={() => void attempt(() => downloadImageIds(version!.items.map((item) => item.imageId)))} className={BUTTON}>下载此版本图片</button></div>
          <div className="mt-3"><button type="button" disabled={!version?.items.length || busy} onClick={() => setDeliveryVersionId(version!.id)} className={BUTTON}>交付预览 / 导出本套 ZIP</button><p className="mt-1 text-[11px] text-gray-500">可保留原图或调整交付尺寸，含图片位对应的 A+ 外置文案。完整迁移请用“备份本地数据”。</p></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{version?.items.map((item) => <article key={item.id} className="overflow-hidden rounded-xl border border-gray-200 p-3 dark:border-white/[0.1]"><div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-950"><StoredImage imageId={item.imageId} alt={item.label} className="h-full w-full object-contain" /></div><p className="mt-2 text-xs font-semibold text-gray-700 dark:text-gray-200">{item.slot || item.label}</p><div className="mt-2 flex flex-wrap gap-1.5"><button type="button" className={BUTTON} onClick={() => { close(); useStore.getState().setReviewImageId(item.imageId) }}>对比 / 版本</button><button type="button" className={BUTTON} onClick={() => { openImageInSeedreamEditor(item.imageId); close() }}>编辑此图</button><button type="button" disabled={busy} className={BUTTON} onClick={() => void attempt(async () => { await reuseMaterialItem(item); useStore.getState().showToast('已复用提示词、参数和参考图，未提交生成', 'success'); useStore.getState().closeMaterialLibrary(); window.location.hash = '' })}>复用配置</button></div>{item.reviewNote && <p className="mt-2 text-xs text-gray-500">{item.reviewNote}</p>}</article>)}</div>
          <details className="mt-5 rounded-xl border border-gray-200 p-3 text-xs dark:border-white/[0.1]"><summary className="cursor-pointer text-gray-500">管理套组</summary><div className="mt-3 flex gap-2"><input aria-label="重命名素材套组" value={rename} onChange={(event) => setRename(event.target.value)} className={`${INPUT} min-w-0 flex-1`} /><button type="button" disabled={busy || !rename.trim()} onClick={() => void attempt(() => renameMaterialCollection(collection.id, rename))} className={BUTTON}>保存名称</button><button type="button" disabled={busy} onClick={() => setConfirmDelete(true)} className="rounded-lg px-3 py-2 text-red-600">删除套组</button></div>{confirmDelete && <div className="mt-3 rounded-lg bg-red-50 p-3 text-red-700 dark:bg-red-500/10 dark:text-red-300"><p>删除该套组及其收藏版本？已有生成任务不会删除。</p><div className="mt-2 flex gap-2"><button type="button" disabled={busy} className={BUTTON} onClick={() => void attempt(async () => { await removeMaterialCollection(collection.id); setSelectedId('') })}>确认删除套组</button><button type="button" onClick={() => setConfirmDelete(false)} className={BUTTON}>取消</button></div></div>}</details>
        </div>}
      </>}
    </div>
  </Sheet>, document.body)}</>
}
