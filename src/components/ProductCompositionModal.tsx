import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AmazonPlannerSession, CompositionProduct, InputImage, ProductComposition } from '../types'
import { createInputImageFromFile } from '../store'
import { useStoredImageUrls } from '../hooks/useStoredImageUrls'
import { confirmedProductFacts, factsFromProductDraft, normalizeProductFacts, FACT_FIELDS, FACT_LIST_FIELDS } from '../lib/productFacts'
import { normalizeProductComposition, productCompositionErrors } from '../lib/productComposition'
import { normalizeReferenceUsage } from '../lib/referenceImageUsage'
import { localId } from '../lib/localId'
import ReferenceScopePicker from './ReferenceScopePicker'
import { Sheet } from './Sheet'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { useModalFocus } from '../hooks/useModalFocus'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'

const BUTTON = 'rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs disabled:opacity-40 dark:border-white/10 dark:bg-gray-900'
const FIELD = 'mt-1 w-full rounded-lg border border-gray-200 bg-white p-2 text-sm dark:border-white/10 dark:bg-gray-950'
export default function ProductCompositionModal({ session, slots, onApply, onClose }: { session: AmazonPlannerSession; slots: Array<{ slot: string; label: string }>; onApply: (value: ProductComposition | undefined, images: InputImage[]) => Promise<void>; onClose: () => void }) {
  const [added, setAdded] = useState<InputImage[]>([])
  const [products, setProducts] = useState<CompositionProduct[]>(() => structuredClone(session.productComposition?.products ?? [{ id: localId('product'), role: 'primary', title: session.draft.productTitle || '主商品', relationship: 'included', facts: confirmedProductFacts(session.productFacts)?.facts ?? factsFromProductDraft(session.draft), imageIds: session.referenceImageIds.filter((id) => normalizeReferenceUsage(session.referenceImageUsages?.[id]).purpose === 'product'), slots: [] }]))
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const panelRef = useRef<HTMLDivElement>(null), uploadRef = useRef<HTMLInputElement>(null), [uploadOwner, setUploadOwner] = useState('')
  const close = () => { if (!busy) onClose() }
  useCloseOnEscape(true, close); useModalFocus(true, panelRef); usePreventBackgroundScroll(true, panelRef)
  const cached = useStoredImageUrls([...session.referenceImageIds, ...added.map((image) => image.id)])
  const availableIds = [...new Set([...session.referenceImageIds.filter((id) => normalizeReferenceUsage(session.referenceImageUsages?.[id]).purpose === 'product'), ...added.map((image) => image.id)])]
  const update = (id: string, patch: Partial<CompositionProduct>) => setProducts((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row))
  const bind = (owner: string, id: string, checked: boolean) => setProducts((rows) => rows.map((row) => ({ ...row, imageIds: row.id === owner && checked ? [...new Set([...row.imageIds, id])] : row.imageIds.filter((imageId) => imageId !== id) })))
  const attempt = async (work: () => Promise<void>) => { if (busy) return; setBusy(true); setError(''); try { await work() } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setBusy(false) } }
  const apply = () => attempt(async () => {
    if (products.length < 2) throw new Error('请添加至少一件辅助商品，或选择“恢复单商品”')
    const composition = normalizeProductComposition({ products, confirmedAt: Date.now() })!
    const usedImages = added.filter((image) => composition.products.some((row) => row.imageIds.includes(image.id)))
    const errors = productCompositionErrors({ ...session, productComposition: composition, referenceImageIds: [...session.referenceImageIds, ...usedImages.map((image) => image.id)] })
    if (errors.length) throw new Error(errors.join('；'))
    await onApply(composition, usedImages); onClose()
  })
  return createPortal(<Sheet panelRef={panelRef} onClose={close} labelledBy="product-composition-title" rootClassName="z-[117]" className="flex max-h-[92dvh] max-w-6xl flex-col overflow-hidden pt-5">
    <div className="flex justify-between gap-3 border-b border-gray-100 p-4 dark:border-white/10"><div><h2 id="product-composition-title" className="font-semibold">多商品主辅组合</h2><p className="mt-1 text-xs text-gray-500">最多三件商品，每件绑定自己的实拍图。辅助商品可指定图片位；场景道具不会出现在 MAIN。</p></div><button type="button" className={BUTTON} disabled={busy} onClick={close}>关闭商品组合</button></div>
    <div className="min-h-0 overflow-y-auto p-4"><input ref={uploadRef} type="file" accept="image/*" multiple hidden onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; const owner = uploadOwner; void attempt(async () => { const images: InputImage[] = []; for (const file of files) { if (session.referenceImageIds.length + added.length + images.length >= 16) throw new Error('参考图最多 16 张，请先整理'); const image = await createInputImageFromFile(file); if (image) images.push(image) } setAdded((rows) => [...rows, ...images.filter((image) => !rows.some((row) => row.id === image.id))]); setProducts((rows) => rows.map((row) => ({ ...row, imageIds: row.id === owner ? [...new Set([...row.imageIds, ...images.map((image) => image.id)])] : row.imageIds.filter((id) => !images.some((image) => image.id === id)) }))) }) }} />
      <div className="grid items-start gap-4 lg:grid-cols-3">{products.map((product, index) => <fieldset disabled={busy} key={product.id} className="min-w-0 space-y-3 rounded-xl border border-gray-200 p-3 text-xs dark:border-white/10"><div className="flex justify-between"><h3 className="text-sm font-semibold">{product.role === 'primary' ? '主商品 · 视觉中心' : `辅助商品 ${index}`}</h3>{index > 0 && <button type="button" className="text-red-500" onClick={() => setProducts((rows) => rows.filter((row) => row.id !== product.id))}>移除此商品</button>}</div>
      <label className="block">商品名称<input aria-label={`组合商品 ${index + 1} 名称`} maxLength={100} className={FIELD} value={product.title} onChange={(event) => update(product.id, { title: event.target.value })} /></label>
      {index > 0 && <><label className="block">与主商品的关系<select aria-label={`辅助商品 ${index} 关系`} className={FIELD} value={product.relationship} onChange={(event) => update(product.id, { relationship: event.target.value === 'included' ? 'included' : 'prop' })}><option value="prop">场景道具，不随商品附赠</option><option value="included">已确认属于随附套装</option></select></label><ReferenceScopePicker label={`辅助商品 ${index} 适用图片位`} slots={slots.filter((slot) => product.relationship === 'included' || slot.slot !== 'MAIN')} value={product.slots} disabled={busy} onChange={(value) => update(product.id, { slots: value })} /></>}
      <h4 className="font-semibold">绑定实拍图（选中会从其他商品移过来）</h4><div className="grid grid-cols-3 gap-2">{availableIds.map((id, imageIndex) => <label key={id} className="relative cursor-pointer rounded-lg border p-1 dark:border-white/10">{cached[id] || added.find((image) => image.id === id)?.dataUrl ? <img src={cached[id] ?? added.find((image) => image.id === id)?.dataUrl} alt={`商品参考 ${imageIndex + 1}`} className="h-16 w-full object-contain" /> : <span>原图载入中</span>}<span className="flex items-center gap-1"><input type="checkbox" aria-label={`${product.title || `商品 ${index + 1}`} 绑定参考图 ${imageIndex + 1}`} checked={product.imageIds.includes(id)} onChange={(event) => bind(product.id, id, event.target.checked)} />{imageIndex + 1}</span></label>)}</div><button type="button" className={BUTTON} onClick={() => { setUploadOwner(product.id); uploadRef.current?.click() }}>为此商品上传实拍图</button>
      {index === 0 ? <p className="text-gray-500">主商品优先采用首页已确认的商品事实。没有确认时，使用当前商品信息；辅助商品事实独立保存。</p> : <details><summary className="cursor-pointer font-semibold">辅助商品事实与禁止改动项</summary>{FACT_FIELDS.map(([key, label]) => <label className="mt-2 block" key={key}>{label}<input aria-label={`${product.title || `辅助商品 ${index}`} ${label}`} maxLength={2000} className={FIELD} value={product.facts[key]} onChange={(event) => update(product.id, { facts: { ...product.facts, [key]: event.target.value } })} /></label>)}{FACT_LIST_FIELDS.map(([key, label]) => <label className="mt-2 block" key={key}>{label}<textarea aria-label={`${product.title || `辅助商品 ${index}`} ${label}`} rows={2} className={FIELD} value={product.facts[key].join('\n')} onChange={(event) => update(product.id, { facts: { ...product.facts, [key]: event.target.value.split('\n') } })} /></label>)}</details>}
      </fieldset>)}</div>
      <button type="button" disabled={busy || products.length >= 3} className={`${BUTTON} mt-3`} onClick={() => setProducts((rows) => [...rows, { id: localId('product'), role: 'secondary', title: '', relationship: 'prop', facts: normalizeProductFacts({}), imageIds: [], slots: slots.filter((slot) => slot.slot !== 'MAIN').map((slot) => slot.slot) }])}>添加辅助商品（{products.length}/3）</button>
      <p className="mt-3 text-xs text-gray-500">“确认组合”表示你核实了商品身份、包含关系和参数。风格/构图图片不能绑定为商品身份。组合变化后，受影响的策划和最终稿需要复核。</p>{error && <p role="alert" className="mt-3 text-xs text-red-600">{error}</p>}
      <div className="sticky bottom-0 mt-4 flex flex-wrap gap-2 rounded-xl bg-white p-3 dark:bg-gray-900"><button type="button" disabled={busy} className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-40" onClick={() => void apply()}>确认组合并应用</button><button type="button" disabled={busy} className={BUTTON} onClick={() => void attempt(async () => { await onApply(undefined, []); onClose() })}>恢复单商品</button></div>
    </div>
  </Sheet>, document.body)
}
