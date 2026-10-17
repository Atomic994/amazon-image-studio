import type { NormalizedFrame, PatchTransferSnapshot, PatchTransferSpec } from '../types'
import { loadImage } from './canvasImage'

export const FULL_FRAME: NormalizedFrame = { x: 0, y: 0, width: 1, height: 1 }
export function normalizeFrame(input: NormalizedFrame): NormalizedFrame {
  if (!input || ![input.x, input.y, input.width, input.height].every(Number.isFinite)) throw new Error('框选坐标无效，请重新框选')
  const clamp = (value: number) => Math.min(1, Math.max(0, value))
  const x = clamp(Math.min(input.x, input.x + input.width)), y = clamp(Math.min(input.y, input.y + input.height))
  const width = clamp(Math.max(input.x, input.x + input.width)) - x, height = clamp(Math.max(input.y, input.y + input.height)) - y
  if (width < 0.005 || height < 0.005) throw new Error('框选区域太小，请扩大后重试')
  return { x, y, width, height }
}
export function normalizePatchTransfer(value: unknown): PatchTransferSnapshot | undefined {
  if (!value || typeof value !== 'object') return undefined
  const row = value as PatchTransferSnapshot
  if (![row.sourceImageId, row.compositeImageId, row.maskImageId].every((id) => typeof id === 'string' && !!id)) return undefined
  try { return { sourceImageId: row.sourceImageId, compositeImageId: row.compositeImageId, maskImageId: row.maskImageId, sourceFrame: normalizeFrame(row.sourceFrame), targetFrame: normalizeFrame(row.targetFrame), fit: row.fit === 'stretch' ? 'stretch' : 'contain', edgePx: Math.max(1, Math.min(128, Math.round(Number.isFinite(row.edgePx) ? row.edgePx : 24))), coreInsetPx: Math.max(0, Math.min(128, Math.round(Number.isFinite(row.coreInsetPx) ? row.coreInsetPx : 12))) } } catch { return undefined }
}
export function framePixels(frame: NormalizedFrame, width: number, height: number) {
  const bounds = normalizeFrame(frame)
  const x = Math.floor(bounds.x * width + 1e-7), y = Math.floor(bounds.y * height + 1e-7)
  return { x, y, width: Math.max(1, Math.ceil((bounds.x + bounds.width) * width - 1e-7) - x), height: Math.max(1, Math.ceil((bounds.y + bounds.height) * height - 1e-7) - y) }
}
export function patchGeometry(spec: PatchTransferSpec, base: { width: number; height: number }, source: { width: number; height: number }) {
  const crop = framePixels(spec.sourceFrame, source.width, source.height), target = framePixels(spec.targetFrame, base.width, base.height)
  const scale = Math.min(target.width / crop.width, target.height / crop.height)
  const width = spec.fit === 'stretch' ? target.width : Math.max(1, Math.min(target.width, Math.round(crop.width * scale)))
  const height = spec.fit === 'stretch' ? target.height : Math.max(1, Math.min(target.height, Math.round(crop.height * scale)))
  const placed = { x: target.x + Math.floor((target.width - width) / 2), y: target.y + Math.floor((target.height - height) / 2), width, height }
  const edge = Math.max(1, Math.min(128, Math.round(spec.edgePx))), inset = Math.max(0, Math.min(Math.round(spec.coreInsetPx), Math.floor((Math.min(width, height) - 1) / 2)))
  const left = Math.max(0, placed.x - edge), top = Math.max(0, placed.y - edge)
  return { crop, placed, fusion: { x: left, y: top, width: Math.min(base.width, placed.x + width + edge) - left, height: Math.min(base.height, placed.y + height + edge) - top }, core: { x: placed.x + inset, y: placed.y + inset, width: width - inset * 2, height: height - inset * 2 } }
}
/** Only the ring around the precomposed original patch can be changed by the model. */
export async function renderPatchTransfer(baseDataUrl: string, sourceDataUrl: string, spec: PatchTransferSpec) {
  const [base, source] = await Promise.all([loadImage(baseDataUrl), loadImage(sourceDataUrl)])
  const width = base.naturalWidth, height = base.naturalHeight
  if (width <= 0 || height <= 0 || width > 16384 || height > 16384 || width * height > 32_000_000) throw new Error('请先将主图缩小到最长边 16384px、总计 3200 万像素以内')
  const geometry = patchGeometry(spec, { width, height }, { width: source.naturalWidth, height: source.naturalHeight })
  const make = () => { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const context = canvas.getContext('2d'); if (!context) throw new Error('当前浏览器不支持 Canvas'); return { canvas, context } }
  const composite = make(), mask = make()
  composite.context.drawImage(base, 0, 0)
  const { crop, placed, fusion, core } = geometry
  composite.context.drawImage(source, crop.x, crop.y, crop.width, crop.height, placed.x, placed.y, placed.width, placed.height)
  mask.context.fillStyle = '#fff'; mask.context.fillRect(0, 0, width, height)
  mask.context.clearRect(fusion.x, fusion.y, fusion.width, fusion.height)
  mask.context.fillRect(core.x, core.y, core.width, core.height)
  return { compositeDataUrl: composite.canvas.toDataURL('image/png'), maskDataUrl: mask.canvas.toDataURL('image/png'), geometry }
}
export function patchImageIds(patch?: PatchTransferSnapshot) { return patch ? [patch.sourceImageId, patch.compositeImageId, patch.maskImageId] : [] }
