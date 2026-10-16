import type { MaterialCollectionItem, MaterialCollectionVersion } from '../types'

export interface DeliveryDimensions { width: number; height: number }
export interface DeliveryOptions {
  mode: 'original' | 'fit' | 'crop' | 'pad'
  target: 'module' | 'custom'; width: number; height: number
  format: 'original' | 'png' | 'jpeg' | 'webp'; allowUpscale: boolean; background: string
  focus: Record<string, { x: number; y: number }>
}
export const DEFAULT_DELIVERY_OPTIONS: DeliveryOptions = { mode: 'original', target: 'module', width: 2000, height: 2000, format: 'original', allowUpscale: false, background: '#ffffff', focus: {} }
export function materialAPlusPlan(item: MaterialCollectionItem, version: MaterialCollectionVersion) {
  const versionId = item.category?.plannerModuleVersionId
  if (versionId) {
    const saved = version.plannerSession?.moduleVersions?.[`aplus:${item.slot}`]?.find((row) => row.id === versionId)
    return saved && 'uploadSize' in saved.plan ? saved.plan : undefined
  }
  // Legacy tasks do not have a module version link. Use their saved set snapshot.
  return version.plannerSession?.aPlusPlans.find((plan) => plan.slot === item.slot)
}
export function parseDeliverySize(value: string | undefined): DeliveryDimensions | undefined {
  const match = value?.match(/^(\d+)\s*[x×]\s*(\d+)$/i)
  if (!match) return
  const width = Number(match[1]), height = Number(match[2])
  return width > 0 && height > 0 ? { width, height } : undefined
}
export function deliveryTarget(item: MaterialCollectionItem, version: MaterialCollectionVersion, options: DeliveryOptions): DeliveryDimensions {
  const target = options.target === 'custom' ? { width: options.width, height: options.height }
    : parseDeliverySize(materialAPlusPlan(item, version)?.uploadSize) ?? parseDeliverySize(item.params.size)
  if (!target) throw new Error(`${item.slot || item.label} 没有明确的目标尺寸，请改用自定义尺寸`)
  if (![target.width, target.height].every((value) => Number.isInteger(value) && value > 0 && value <= 8192) || target.width * target.height > 32_000_000) throw new Error('交付尺寸须为 1–8192 的整数，且总像素不超过 3200 万')
  return target
}
export function deliveryLayout(source: DeliveryDimensions, target: DeliveryDimensions, mode: DeliveryOptions['mode'], allowUpscale: boolean, focus = { x: 0.5, y: 0.5 }) {
  if (![source.width, source.height, target.width, target.height].every((n) => Number.isFinite(n) && n > 0)) throw new Error('图片尺寸无效')
  let sx = 0, sy = 0, sw = source.width, sh = source.height
  let width = source.width, height = source.height, dx = 0, dy = 0, dw = width, dh = height
  if (mode === 'crop') {
    const ratio = target.width / target.height
    if (sw / sh > ratio) sw = sh * ratio
    else sh = sw / ratio
    sx = (source.width - sw) * Math.max(0, Math.min(1, focus.x))
    sy = (source.height - sh) * Math.max(0, Math.min(1, focus.y))
    const scale = Math.min(target.width / sw, target.height / sh, allowUpscale ? Infinity : 1)
    width = Math.max(1, Math.round(sw * scale)); height = Math.max(1, Math.round(sh * scale)); dw = width; dh = height
  } else if (mode === 'fit' || mode === 'pad') {
    const scale = Math.min(target.width / sw, target.height / sh, allowUpscale ? Infinity : 1)
    dw = Math.max(1, Math.round(sw * scale)); dh = Math.max(1, Math.round(sh * scale))
    width = mode === 'pad' ? target.width : dw; height = mode === 'pad' ? target.height : dh
    dx = (width - dw) / 2; dy = (height - dh) / 2
  }
  return { width, height, source: { x: sx, y: sy, width: sw, height: sh }, destination: { x: dx, y: dy, width: dw, height: dh } }
}
export async function loadDeliveryImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('图片解码失败，请检查原图')); img.src = dataUrl })
}
export async function renderDeliveryImage(dataUrl: string, target: DeliveryDimensions, options: DeliveryOptions, imageId: string, preview = false) {
  const img = await loadDeliveryImage(dataUrl)
  const originalDimensions = { width: img.naturalWidth, height: img.naturalHeight }
  const layout = deliveryLayout(originalDimensions, target, options.mode, options.allowUpscale, options.focus[imageId])
  if (layout.width > 8192 || layout.height > 8192 || layout.width * layout.height > 32_000_000) throw new Error('处理后的图片超过浏览器交付上限，请缩小目标尺寸或保留原始文件')
  const scale = preview ? Math.min(1, 800 / Math.max(layout.width, layout.height)) : 1
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(layout.width * scale)); canvas.height = Math.max(1, Math.round(layout.height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器无法创建交付图片')
  const sourceFormat = dataUrl.match(/^data:image\/(png|jpeg|webp)/)?.[1] ?? 'png'
  const format = options.format === 'original' ? sourceFormat : options.format
  context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'
  if (options.mode === 'pad' || format === 'jpeg') { context.fillStyle = /^#[0-9a-f]{6}$/i.test(options.background) ? options.background : '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height) }
  const s = layout.source, d = layout.destination
  context.drawImage(img, s.x, s.y, s.width, s.height, d.x * scale, d.y * scale, d.width * scale, d.height * scale)
  const rendered = canvas.toDataURL(`image/${format}`, 0.94)
  canvas.width = 1; canvas.height = 1
  return { dataUrl: rendered, originalDimensions, dimensions: { width: layout.width, height: layout.height }, targetDimensions: target, layout }
}
