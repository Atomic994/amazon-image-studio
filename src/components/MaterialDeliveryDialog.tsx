import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { MaterialCollection } from '../types'
import { getImage } from '../lib/db'
import { DEFAULT_DELIVERY_OPTIONS, deliveryTarget, renderDeliveryImage, type DeliveryOptions } from '../lib/imageDelivery'
import { buildMaterialDeliveryZip, downloadMaterialDeliveryZip } from '../lib/materialDelivery'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { useModalFocus } from '../hooks/useModalFocus'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { Sheet } from './Sheet'

const FIELD = 'rounded-lg border border-gray-200 bg-white p-2 text-xs dark:border-white/10 dark:bg-gray-950 dark:text-gray-100'
export default function MaterialDeliveryDialog({ collection, versionId, onClose }: { collection: MaterialCollection; versionId: string; onClose: () => void }) {
  const version = collection.versions.find((version) => version.id === versionId)!
  const [options, setOptions] = useState<DeliveryOptions>(() => ({ ...DEFAULT_DELIVERY_OPTIONS, focus: {} }))
  const [imageId, setImageId] = useState(version.items[0]?.id ?? ''), [preview, setPreview] = useState(''), [description, setDescription] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [progress, setProgress] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
  const close = () => { if (!busy) onClose() }
  useCloseOnEscape(true, close); useModalFocus(true, panelRef); usePreventBackgroundScroll(true, panelRef)
  const item = version.items.find((row) => row.id === imageId) ?? version.items[0]
  const patch = (value: Partial<DeliveryOptions>) => setOptions((current) => ({ ...current, ...value }))
  useEffect(() => {
    let stale = false; setError(''); setPreview(''); setDescription('正在生成预览…')
    const timer = setTimeout(() => { void (async () => {
      const image = item && await getImage(item.imageId)
      if (!image) throw new Error('原图缺失，请恢复本地数据备份')
      if (options.mode === 'original' && options.format === 'original') {
        if (!stale) { setPreview(image.dataUrl); setDescription(`保留原始像素和格式${image.width && image.height ? ` · ${image.width}×${image.height}` : ''}`) }
      } else {
        const result = await renderDeliveryImage(image.dataUrl, options.mode === 'original' ? { width: 1, height: 1 } : deliveryTarget(item, version, options), options, item.id, true)
        if (!stale) { setPreview(result.dataUrl); setDescription(`原图 ${result.originalDimensions.width}×${result.originalDimensions.height} → 交付 ${result.dimensions.width}×${result.dimensions.height}${options.mode !== 'original' ? ` · 目标 ${result.targetDimensions.width}×${result.targetDimensions.height}` : ''}`) }
      }
    })().catch((reason) => { if (!stale) { setError(reason instanceof Error ? reason.message : String(reason)); setDescription('预览不可用') } }) }, 180)
    return () => { stale = true; clearTimeout(timer) }
  }, [item, version, options])
  const focus = options.focus[item.id] ?? { x: 0.5, y: 0.5 }
  async function exportZip() {
    if (busy) return
    setBusy(true); setError('')
    try { downloadMaterialDeliveryZip(await buildMaterialDeliveryZip(collection, versionId, getImage, setProgress, options)); setProgress('ZIP 已导出') }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  return createPortal(<Sheet onClose={close} panelRef={panelRef} labelledBy="material-delivery-title" rootClassName="z-[120]" className="flex max-h-[92dvh] max-w-4xl flex-col overflow-hidden pt-5">
    <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-white/10"><div><h2 id="material-delivery-title" className="text-base font-semibold text-gray-900 dark:text-gray-100">交付预览与 ZIP 导出 · v{version.versionNumber}</h2><p className="mt-1 text-xs text-gray-500">本次导出 {version.items.length} 张所选版本图片。A+ 外置文案按图片位另存为文件。</p></div><button type="button" disabled={busy} onClick={close} className={FIELD}>关闭交付预览</button></div>
    <div className="custom-scrollbar min-h-0 overflow-y-auto p-4"><fieldset disabled={busy} className="grid gap-3 text-xs text-gray-600 sm:grid-cols-2 dark:text-gray-300">
      <label>交付方式<select aria-label="交付方式" value={options.mode} onChange={(e) => patch({ mode: e.target.value as DeliveryOptions['mode'] })} className={`${FIELD} mt-1 w-full`}><option value="original">保留原始尺寸</option><option value="fit">等比缩放 · 放入目标范围</option><option value="crop">裁切到目标比例</option><option value="pad">补边到目标尺寸</option></select></label>
      <label>图片格式<select aria-label="交付图片格式" value={options.format} onChange={(e) => patch({ format: e.target.value as DeliveryOptions['format'] })} className={`${FIELD} mt-1 w-full`}><option value="original">沿用原格式</option><option value="png">PNG</option><option value="jpeg">JPEG</option><option value="webp">WebP</option></select></label>
      {options.mode !== 'original' && <><label>目标尺寸<select aria-label="交付目标尺寸" value={options.target} onChange={(e) => patch({ target: e.target.value as DeliveryOptions['target'] })} className={`${FIELD} mt-1 w-full`}><option value="module">按各图片位 · A+ 使用上传尺寸</option><option value="custom">全部使用自定义尺寸</option></select></label>{options.target === 'custom' && <label>宽 × 高（像素）<div className="mt-1 flex items-center gap-2"><input aria-label="交付宽度" type="number" min={1} max={8192} value={options.width} onChange={(e) => patch({ width: Number(e.target.value) })} className={`${FIELD} w-1/2`} /><span>×</span><input aria-label="交付高度" type="number" min={1} max={8192} value={options.height} onChange={(e) => patch({ height: Number(e.target.value) })} className={`${FIELD} w-1/2`} /></div></label>}<label className="flex items-center gap-2"><input type="checkbox" aria-label="允许放大小图" checked={options.allowUpscale} onChange={(e) => patch({ allowUpscale: e.target.checked })} />允许放大小图（放大不会增加真实细节）</label></>}
      {(options.mode === 'pad' || options.format === 'jpeg') && <label className="flex items-center gap-2">背景颜色<input aria-label="交付背景颜色" type="color" value={options.background} onChange={(e) => patch({ background: e.target.value })} /></label>}
    </fieldset>
      <div className="mt-4 rounded-xl border border-gray-200 p-3 dark:border-white/10"><label className="text-xs text-gray-500">预览图片<select aria-label="交付预览图片" disabled={busy} value={item.id} onChange={(e) => setImageId(e.target.value)} className={`${FIELD} ml-2 max-w-full`}>{version.items.map((row) => <option key={row.id} value={row.id}>{row.slot || row.label}</option>)}</select></label><p className="mt-2 text-xs text-gray-500">{description}</p>
        <div className="mt-3 flex min-h-44 items-center justify-center rounded-lg bg-gray-100 p-2 dark:bg-gray-950">{preview ? <img src={preview} alt="交付图片预览" className="max-h-80 max-w-full object-contain" /> : <span className="text-xs text-gray-500">正在读取图片…</span>}</div>
        {options.mode === 'crop' && <div className="mt-3 grid gap-2 text-xs text-gray-500 sm:grid-cols-2">{(['x', 'y'] as const).map((axis) => <label key={axis}>{axis === 'x' ? '裁切水平位置（左 → 右）' : '裁切垂直位置（上 → 下）'}<input aria-label={axis === 'x' ? '裁切水平位置' : '裁切垂直位置'} type="range" min={0} max={1} step={0.01} value={focus[axis]} disabled={busy} onChange={(e) => patch({ focus: { ...options.focus, [item.id]: { ...focus, [axis]: Number(e.target.value) } } })} className="mt-1 w-full" /></label>)}</div>}
      </div>
      <p className="mt-3 text-xs text-gray-500">缩放和裁切默认不放大，原图较小时交付尺寸可能低于目标；补边可保持目标画布尺寸。原图和收藏版本保持不变。</p>
      {error && <p role="alert" className="mt-3 text-xs text-red-600 dark:text-red-300">{error}</p>}{progress && <p role="status" className="mt-3 text-xs text-blue-600 dark:text-blue-300">{progress}</p>}
      <button type="button" disabled={busy || !!error || !preview} onClick={() => void exportZip()} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy ? '正在导出…' : '导出本套 ZIP'}</button>
    </div>
  </Sheet>, document.body)
}
