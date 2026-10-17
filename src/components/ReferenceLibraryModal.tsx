import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReferenceImageUsage, ReferenceLibraryItem, ReferenceLibrarySeed } from '../types'
import { createInputImageFromFile, useStore } from '../store'
import { getImage, referenceLibraryDb } from '../lib/db'
import { prepareLibraryReuse, referenceLibraryEntry } from '../lib/referenceLibrary'
import { normalizeReferenceUsage, REFERENCE_PURPOSE_LABELS } from '../lib/referenceImageUsage'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { useModalFocus } from '../hooks/useModalFocus'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { Sheet } from './Sheet'
import StoredImage from './StoredImage'
import ReferenceScopePicker from './ReferenceScopePicker'
import { getAPlusModuleSpecs, getAmazonListingImageSlots } from '../lib/listingPlanner'

export type { ReferenceLibrarySeed } from '../types'
const BUTTON = 'rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 disabled:opacity-40 dark:border-white/10 dark:bg-gray-900 dark:text-gray-200'
const FIELD = 'mt-1.5 w-full rounded-lg border border-gray-200 bg-white p-2 text-sm dark:border-white/10 dark:bg-gray-950 dark:text-gray-100'
export default function ReferenceLibraryModal({ seed, slots, onUse, onClose, saveOnly = false }: { seed?: ReferenceLibrarySeed; slots: Array<{ slot: string; label: string }>; onUse?: (items: ReferenceLibraryItem[]) => Promise<void>; onClose: () => void; saveOnly?: boolean }) {
  const library = useStore((state) => state.referenceLibrary)
  const scopeOptions = slots.length ? slots : [...getAmazonListingImageSlots(12).map((slot) => ({ slot, label: slot === 'MAIN' ? '产品主图' : '产品附图' })), ...(['standard', 'standard-large', 'premium', 'mobile'] as const).flatMap((type) => getAPlusModuleSpecs(type))]
  const [selected, setSelected] = useState<string[]>([]), [query, setQuery] = useState(''), [purpose, setPurpose] = useState('')
  const [editing, setEditing] = useState<ReferenceLibrarySeed | null>(null), [editingId, setEditingId] = useState('')
  const [title, setTitle] = useState(''), [tags, setTags] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [deleting, setDeleting] = useState('')
  const [overridePurpose, setOverridePurpose] = useState(''), [overrideScope, setOverrideScope] = useState(false), [reuseSlots, setReuseSlots] = useState<string[]>([])
  const [overrideNote, setOverrideNote] = useState(false), [reuseNote, setReuseNote] = useState('')
  const panelRef = useRef<HTMLDivElement>(null), inputRef = useRef<HTMLInputElement>(null)
  const close = () => { if (!busy) onClose() }
  useCloseOnEscape(true, close); useModalFocus(true, panelRef); usePreventBackgroundScroll(true, panelRef)
  function edit(item: ReferenceLibrarySeed, existing?: ReferenceLibraryItem) {
    setEditing({ ...item, origin: item.origin ?? existing?.origin }); setEditingId(existing?.id ?? ''); setTitle(existing?.title ?? (item.origin ? '生成结果参考' : '我的参考图')); setTags(existing?.tags.join(', ') ?? ''); setError('')
  }
  useEffect(() => { if (seed) edit(seed, library.find((item) => item.imageId === seed.imageId)) }, [seed])
  const attempt = async (work: () => Promise<void>) => {
    if (busy) return
    setBusy(true); setError('')
    try { await work() } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setBusy(false) }
  }
  const visible = library.filter((item) => (!purpose || item.usage.purpose === purpose) && (!query.trim() || [item.title, ...item.tags, item.usage.note].join(' ').toLowerCase().includes(query.trim().toLowerCase()))).sort((a, b) => b.updatedAt - a.updatedAt)
  const save = () => editing && attempt(async () => {
    if (!await getImage(editing.imageId)) throw new Error('参考原图已不存在，请重新上传')
    const item = referenceLibraryEntry({ ...editing, title, tags }, library.find((item) => item.id === editingId))
    await referenceLibraryDb.put(item)
    useStore.setState((state) => ({ referenceLibrary: [item, ...state.referenceLibrary.filter((row) => row.id !== item.id)] }))
    setEditing(null); setSelected([item.id]); useStore.getState().showToast('参考图、用途及分析修订已收藏', 'success')
    if (saveOnly) onClose()
  })
  return createPortal(<Sheet onClose={close} panelRef={panelRef} labelledBy="reference-library-title" rootClassName="z-[118]" className="flex max-h-[92dvh] max-w-4xl flex-col overflow-hidden pt-5">
    <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-white/10"><div className="min-w-0"><h2 id="reference-library-title" className="text-base font-semibold text-gray-900 dark:text-gray-100">参考图库</h2><p className="mt-1 text-xs text-gray-500">收藏输入参考图、用途、标签及分析版本；保存在当前浏览器，可随本地数据备份迁移。</p></div><button type="button" disabled={busy} onClick={close} className={`${BUTTON} shrink-0`}>关闭图库</button></div>
    <div className="custom-scrollbar min-h-0 overflow-y-auto p-4">{error && <p role="alert" className="mb-3 break-words text-xs text-red-600">{error}</p>}
      {editing ? <><button type="button" className={BUTTON} disabled={busy} onClick={() => setEditing(null)}>返回图库列表</button><StoredImage imageId={editing.imageId} alt="待收藏参考图" className="mx-auto mt-3 max-h-48 object-contain" />
        {editing.origin && <p className="mt-3 rounded-lg bg-blue-50 p-2 text-xs text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">来源：生成结果{editing.origin.slot ? ` · ${editing.origin.slot}` : ''}。默认仅参考构图，不把生成内容当作商品事实。</p>}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-gray-500">参考图名称<input aria-label="参考图库名称" value={title} maxLength={100} className={FIELD} onChange={(event) => setTitle(event.target.value)} /></label>
          <label className="text-xs text-gray-500">标签（逗号分隔）<input aria-label="参考图库标签" value={tags} maxLength={1000} placeholder="家居, 木质场景, 俯拍" className={FIELD} onChange={(event) => setTags(event.target.value)} /></label>
          <label className="text-xs text-gray-500">用途<select aria-label="图库参考图用途" value={editing.usage.purpose} className={FIELD} onChange={(event) => setEditing({ ...editing, usage: { ...editing.usage, purpose: event.target.value as ReferenceImageUsage['purpose'] } })}>{Object.entries(REFERENCE_PURPOSE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <ReferenceScopePicker label="图库参考图范围" value={editing.usage.slots} slots={scopeOptions} onChange={(value) => setEditing({ ...editing, usage: { ...editing.usage, slots: value } })} disabled={busy} />
        </div>
        <label className="mt-3 block text-xs text-gray-500">使用说明<textarea aria-label="图库参考图说明" value={editing.usage.note} rows={2} maxLength={1000} className={FIELD} onChange={(event) => setEditing({ ...editing, usage: { ...editing.usage, note: event.target.value } })} /></label><p className="mt-2 text-[11px] text-gray-500">已带入 {editing.analyses.length} 份分析快照；使用时会重新核对图片内容、用途、说明及模型，匹配后才复用。</p>
        <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy || !title.trim()} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40" onClick={() => void save()}>{busy ? '正在保存…' : editingId ? '更新这张参考图' : '保存到参考图库'}</button>{editingId && <button type="button" disabled={busy} className={BUTTON} onClick={() => setEditingId('')}>另存为新条目</button>}</div>
      </> : <><div className="flex flex-wrap gap-2"><input aria-label="搜索参考图库" placeholder="搜索名称、标签或说明" value={query} className={`${FIELD} mt-0 min-w-0 flex-1`} onChange={(event) => setQuery(event.target.value)} /><select aria-label="按参考用途筛选" value={purpose} className={BUTTON} onChange={(event) => setPurpose(event.target.value)}><option value="">全部用途</option>{Object.entries(REFERENCE_PURPOSE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button type="button" disabled={busy} className={BUTTON} onClick={() => inputRef.current?.click()}>上传并收藏</button></div>
        <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy || !visible.length} className={BUTTON} onClick={() => setSelected((ids) => [...new Set([...ids, ...visible.map((item) => item.id)])])}>选中当前筛选结果</button><button type="button" disabled={busy || !selected.length} className={BUTTON} onClick={() => setSelected([])}>清除选择</button></div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">{visible.map((item) => <article key={item.id} className="min-w-0 rounded-xl border border-gray-200 p-2 dark:border-white/10"><label className="block cursor-pointer"><StoredImage imageId={item.imageId} alt={item.title} className="aspect-square w-full rounded-lg object-contain" /><span className="mt-2 flex items-start gap-2 text-xs font-semibold text-gray-700 dark:text-gray-200"><input type="checkbox" aria-label={`选用参考图 ${item.title}`} checked={selected.includes(item.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /><span className="break-words">{item.title}</span></span></label><p className="mt-1 text-[11px] text-gray-500">{REFERENCE_PURPOSE_LABELS[item.usage.purpose]} · {item.usage.slots.join(', ') || '全部图片位'}{item.origin ? ' · 生成结果' : ''}</p><div className="mt-1 flex flex-wrap gap-1">{item.tags.map((tag) => <button key={tag} type="button" className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600 dark:bg-blue-500/10" onClick={() => setQuery(tag)}>{tag}</button>)}</div><div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={busy} className="text-xs text-blue-600" onClick={() => edit({ imageId: item.imageId, usage: normalizeReferenceUsage(item.usage), analyses: item.analyses }, item)}>编辑资料</button><button type="button" disabled={busy} className="text-xs text-red-500" onClick={() => setDeleting(item.id)}>移出图库</button></div>{deleting === item.id && <div className="mt-2 text-[11px] text-gray-500"><p>移出此条目？策划和套组中的引用仍保留。</p><button type="button" className={BUTTON} disabled={busy} onClick={() => void attempt(async () => { await referenceLibraryDb.remove(item.id); useStore.setState((state) => ({ referenceLibrary: state.referenceLibrary.filter((row) => row.id !== item.id) })); setSelected((ids) => ids.filter((id) => id !== item.id)); setDeleting('') })}>确认移出</button></div>}</article>)}</div>
        {!visible.length && <p className="py-8 text-center text-sm text-gray-500">{library.length ? '没有匹配的参考图' : '还没有收藏参考图。可上传，或从首页参考图卡片点击“收藏到图库”。'}</p>}
        {!saveOnly && <details className="mt-4 rounded-xl border border-gray-200 p-3 text-xs text-gray-600 dark:border-white/10 dark:text-gray-300"><summary className="cursor-pointer font-semibold">此次加入时统一设置用途和范围（可选）</summary><p className="mt-2 text-[11px] text-gray-500">只影响当前策划，图库中保存的资料保持不变。相同原图不会重复加入；已在当前参考图中的原图会更新用途和范围。</p><label className="mt-2 block">此次用途<select aria-label="此次复用用途" value={overridePurpose} onChange={(event) => setOverridePurpose(event.target.value)} className={FIELD}><option value="">沿用各图原用途</option>{Object.entries(REFERENCE_PURPOSE_LABELS).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label><label className="mt-2 flex gap-2"><input type="checkbox" aria-label="统一此次适用范围" checked={overrideScope} onChange={(event) => setOverrideScope(event.target.checked)} />统一此次适用范围</label>{overrideScope && <ReferenceScopePicker label="此次复用图片位" value={reuseSlots} slots={slots} onChange={setReuseSlots} />}<label className="mt-2 flex gap-2"><input type="checkbox" aria-label="统一此次使用说明" checked={overrideNote} onChange={(event) => setOverrideNote(event.target.checked)} />统一此次使用说明</label>{overrideNote && <textarea aria-label="此次复用说明" maxLength={1000} value={reuseNote} onChange={(event) => setReuseNote(event.target.value)} className={FIELD} />}</details>}
        {!saveOnly && <div className="sticky bottom-0 mt-4 flex items-center justify-between gap-2 rounded-xl bg-white/95 p-3 dark:bg-gray-900/95"><span className="text-xs text-gray-500">已选 {selected.length} 个条目 · 按勾选顺序加入</span><button type="button" disabled={busy || !selected.length || !onUse} onClick={() => void attempt(async () => { const items = selected.map((id) => library.find((item) => item.id === id)).filter((item): item is ReferenceLibraryItem => !!item); await onUse!(prepareLibraryReuse(items, { ...(overridePurpose ? { purpose: overridePurpose as ReferenceImageUsage['purpose'] } : {}), ...(overrideScope ? { slots: reuseSlots } : {}), ...(overrideNote ? { note: reuseNote } : {}) })); onClose() })} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">加入当前参考图</button></div>}
      </>}
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void attempt(async () => { const image = await createInputImageFromFile(file); if (!image) throw new Error('请选择图片文件'); edit({ imageId: image.id, usage: normalizeReferenceUsage(), analyses: [] }); setTitle(file.name.replace(/\.[^.]+$/, '')) }) }} />
    </div>
  </Sheet>, document.body)
}
