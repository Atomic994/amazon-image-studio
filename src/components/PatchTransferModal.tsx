import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import type { NormalizedFrame, PatchTransferSnapshot, PatchTransferSpec } from '../types'
import { createInputImageFromDataUrl, createInputImageFromFile } from '../store'
import { useStoredImageUrls } from '../hooks/useStoredImageUrls'
import { FULL_FRAME, normalizeFrame, renderPatchTransfer } from '../lib/patchTransfer'
import { createProtectedEditGuide, validateProtectedEditInputs } from '../lib/localEditProtection'
import { Sheet } from './Sheet'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { useModalFocus } from '../hooks/useModalFocus'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'

const BUTTON = 'rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs disabled:opacity-40 dark:border-white/10 dark:bg-gray-900'
function FrameSelector({ dataUrl, value, onChange, label }: { dataUrl: string; value: NormalizedFrame; onChange: (value: NormalizedFrame) => void; label: string }) {
  const [drag, setDrag] = useState<{ x: number; y: number; frame: NormalizedFrame } | null>(null)
  const selected = drag?.frame ?? value
  const point = (event: PointerEvent<HTMLDivElement>) => { const rect = event.currentTarget.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) } }
  return <div><p className="mb-2 text-xs font-semibold">{label} · 拖动重新框选</p><div role="group" aria-label={label} className="relative mx-auto w-fit max-w-full touch-none select-none overflow-hidden rounded-lg bg-gray-100" onPointerDown={(event) => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); const p = point(event); setDrag({ ...p, frame: { ...p, width: 0, height: 0 } }) }} onPointerMove={(event) => { if (!drag) return; const p = point(event); setDrag({ ...drag, frame: { x: Math.min(p.x, drag.x), y: Math.min(p.y, drag.y), width: Math.abs(p.x - drag.x), height: Math.abs(p.y - drag.y) } }) }} onPointerUp={(event) => { if (!drag) return; const p = point(event); try { onChange(normalizeFrame({ x: drag.x, y: drag.y, width: p.x - drag.x, height: p.y - drag.y })) } catch { /* Keep previous selection after an accidental click. */ } setDrag(null) }} onPointerCancel={() => setDrag(null)}>
      <img draggable={false} src={dataUrl} alt={label} className="block max-h-80 max-w-full object-contain" /><div className="pointer-events-none absolute border-2 border-cyan-500 bg-cyan-400/15" style={{ left: `${selected.x * 100}%`, top: `${selected.y * 100}%`, width: `${selected.width * 100}%`, height: `${selected.height * 100}%` }} />
    </div><div className="mt-2 grid grid-cols-4 gap-1">{(['x', 'y', 'width', 'height'] as const).map((key, index) => <label key={key} className="text-[11px]">{['左', '上', '宽', '高'][index]} %<input type="number" aria-label={`${label} ${key} 百分比`} min={0} max={100} step={0.5} value={Math.round(value[key] * 10000) / 100} className="mt-1 w-full rounded border bg-white p-1 dark:bg-gray-950" onChange={(event) => { try { onChange(normalizeFrame({ ...value, [key]: Number(event.target.value) / 100 })) } catch { /* Reject invalid or empty rectangles. */ } }} /></label>)}</div></div>
}
export default function PatchTransferModal({ baseImageId, referenceImageIds, initial, onApply, onClose }: { baseImageId: string; referenceImageIds: string[]; initial?: PatchTransferSnapshot; onApply: (value: PatchTransferSnapshot) => void; onClose: () => void }) {
  const [spec, setSpec] = useState<PatchTransferSpec>(() => initial ?? { sourceImageId: referenceImageIds[0] ?? '', sourceFrame: FULL_FRAME, targetFrame: { x: 0.3, y: 0.3, width: 0.4, height: 0.4 }, fit: 'contain', edgePx: 24, coreInsetPx: 12 })
  const [extraIds, setExtraIds] = useState<string[]>([]), [preview, setPreview] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [rendering, setRendering] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null), inputRef = useRef<HTMLInputElement>(null), rendered = useRef<Awaited<ReturnType<typeof renderPatchTransfer>> | null>(null)
  const renderedKey = useRef('')
  const close = () => { if (!busy) onClose() }
  useCloseOnEscape(true, close); useModalFocus(true, panelRef); usePreventBackgroundScroll(true, panelRef)
  const ids = [...new Set([...referenceImageIds, ...extraIds, ...(spec.sourceImageId ? [spec.sourceImageId] : [])])].filter((id) => id !== baseImageId)
  const cached = useStoredImageUrls([baseImageId, spec.sourceImageId])
  useEffect(() => {
    let active = true; rendered.current = null; renderedKey.current = ''; setPreview(''); setError('')
    const base = cached[baseImageId], source = cached[spec.sourceImageId]
    if (!base || !source) { setRendering(false); return }
    setRendering(true)
    void renderPatchTransfer(base, source, spec).then(async (result) => { const guide = await createProtectedEditGuide(result.compositeDataUrl, result.maskDataUrl); if (active) { rendered.current = result; renderedKey.current = JSON.stringify(spec); setPreview(guide) } }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)) }).finally(() => { if (active) setRendering(false) })
    return () => { active = false }
  }, [baseImageId, cached[baseImageId], cached[spec.sourceImageId], spec])
  const apply = async () => {
    if (busy || rendering || !rendered.current || renderedKey.current !== JSON.stringify(spec)) return
    const result = rendered.current; setBusy(true); setError('')
    try {
      await validateProtectedEditInputs(result.compositeDataUrl, result.maskDataUrl)
      const composite = await createInputImageFromDataUrl(result.compositeDataUrl), mask = await createInputImageFromDataUrl(result.maskDataUrl)
      onApply({ ...spec, compositeImageId: composite.id, maskImageId: mask.id }); onClose()
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setBusy(false) }
  }
  return createPortal(<Sheet panelRef={panelRef} onClose={close} labelledBy="patch-transfer-title" rootClassName="z-[119]" className="flex max-h-[94dvh] max-w-6xl flex-col overflow-hidden pt-5"><div className="flex justify-between gap-3 border-b border-gray-100 p-4 dark:border-white/10"><div><h2 id="patch-transfer-title" className="font-semibold">来源图案精确贴入</h2><p className="mt-1 text-xs text-gray-500">先贴入来源原图内容，再让 AI 融合青色边缘。图案内部和远处背景使用贴入后的原始像素。</p></div><button type="button" disabled={busy} className={BUTTON} onClick={close}>关闭精确贴图</button></div>
    <div className="min-h-0 overflow-y-auto p-4"><fieldset disabled={busy} className="mb-4 flex flex-wrap items-center gap-3 text-xs"><label>来源素材<select aria-label="精确贴图来源素材" className="ml-2 rounded-lg border bg-white p-2 dark:bg-gray-950" value={spec.sourceImageId} onChange={(event) => setSpec({ ...spec, sourceImageId: event.target.value, sourceFrame: FULL_FRAME })}><option value="">请选择或上传来源图</option>{ids.map((id, index) => <option key={id} value={id}>素材 {index + 1}{referenceImageIds.includes(id) ? ' · 编辑参考图' : ' · 已上传'}</option>)}</select></label><button type="button" className={BUTTON} onClick={() => inputRef.current?.click()}>上传来源素材</button><input type="file" accept="image/*" hidden ref={inputRef} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; setBusy(true); void createInputImageFromFile(file).then((image) => { if (!image) throw new Error('来源图片读取失败'); setExtraIds((rows) => [...new Set([...rows, image.id])]); setSpec({ ...spec, sourceImageId: image.id, sourceFrame: FULL_FRAME }) }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason))).finally(() => setBusy(false)) }} />
    <label>适配<select aria-label="图案适配方式" className="ml-2 rounded border bg-white p-2 dark:bg-gray-950" value={spec.fit} onChange={(event) => setSpec({ ...spec, fit: event.target.value === 'stretch' ? 'stretch' : 'contain' })}><option value="contain">保持比例，居中放入</option><option value="stretch">拉伸至目标框</option></select></label>
    <label>外侧融合宽度 px<input aria-label="外侧融合宽度" type="number" min={1} max={128} value={spec.edgePx} className="ml-2 w-20 rounded border bg-white p-2 dark:bg-gray-950" onChange={(event) => setSpec({ ...spec, edgePx: Math.max(1, Math.min(128, Number(event.target.value))) })} /></label><label>图案边缘可调宽度 px<input aria-label="图案边缘可调宽度" type="number" min={0} max={128} value={spec.coreInsetPx} className="ml-2 w-20 rounded border bg-white p-2 dark:bg-gray-950" onChange={(event) => setSpec({ ...spec, coreInsetPx: Math.max(0, Math.min(128, Number(event.target.value))) })} /></label>
    </fieldset><div className="grid items-start gap-4 md:grid-cols-3">{cached[spec.sourceImageId] ? <FrameSelector label="来源图案区域" dataUrl={cached[spec.sourceImageId]} value={spec.sourceFrame} onChange={(sourceFrame) => setSpec({ ...spec, sourceFrame })} /> : <p className="text-xs text-gray-500">请选择清晰的来源素材。</p>}{cached[baseImageId] && <FrameSelector label="目标放置区域" dataUrl={cached[baseImageId]} value={spec.targetFrame} onChange={(targetFrame) => setSpec({ ...spec, targetFrame })} />}<div><p className="mb-2 text-xs font-semibold">贴入与保护区域预览</p>{preview && <img src={preview} alt="精确贴入预览，青色为允许融合的边缘" className="max-h-80 w-full object-contain" />}{rendering && <p role="status" className="text-xs">正在更新预览…</p>}</div></div>
    <p className="mt-4 text-xs text-gray-500">建议来源图只包含需要的文字或图案。保持比例不会铺满目标框；拉伸可能改变字形。这里不会自动校正曲面透视。应用后将替换原有的局部编辑遮罩与标注。</p>{error && <p role="alert" className="mt-3 text-xs text-red-600">{error}</p>}<button type="button" disabled={busy || rendering || !preview} onClick={() => void apply()} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-40">应用贴图与边缘保护</button></div>
  </Sheet>, document.body)
}
