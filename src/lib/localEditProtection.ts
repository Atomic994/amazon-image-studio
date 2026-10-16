import { loadImage } from './canvasImage'
import { assertUsableMaskCoverage, classifyMaskAlpha } from './mask'

function checkSize(width: number, height: number) {
  if (width <= 0 || height <= 0 || width > 16384 || height > 16384 || width * height > 32_000_000) throw new Error('原图超出局部保护处理上限，请先缩小到最长边 16384px、总计 3200 万像素以内')
}
function canvasFor(width: number, height: number) {
  checkSize(width, height)
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('浏览器无法创建局部保护图片')
  return { canvas, context }
}
export function compositeProtectedPixels(base: Uint8ClampedArray, edited: Uint8ClampedArray, mask: Uint8ClampedArray) {
  if (!base.length || base.length % 4 || edited.length !== base.length || mask.length !== base.length) throw new Error('局部保护的像素尺寸不一致')
  const output = new Uint8ClampedArray(base)
  for (let i = 0; i < base.length; i += 4) {
    if (mask[i + 3] === 255) continue
    if (mask[i + 3] === 0) { output.set(edited.subarray(i, i + 4), i); continue }
    const amount = (255 - mask[i + 3]) / 255
    const originalAlpha = base[i + 3] * (1 - amount), editedAlpha = edited[i + 3] * amount
    const alpha = originalAlpha + editedAlpha
    for (let channel = 0; channel < 3; channel++) output[i + channel] = alpha ? Math.round((base[i + channel] * originalAlpha + edited[i + channel] * editedAlpha) / alpha) : 0
    output[i + 3] = Math.round(alpha)
  }
  return output
}
export async function validateProtectedEditInputs(baseDataUrl: string, maskDataUrl: string) {
  const [base, mask] = await Promise.all([loadImage(baseDataUrl), loadImage(maskDataUrl)])
  const width = base.naturalWidth, height = base.naturalHeight
  if (mask.naturalWidth !== width || mask.naturalHeight !== height) throw new Error('修改区域与原图尺寸不一致，请重新选择修改区域')
  const { canvas, context } = canvasFor(width, height)
  try {
    context.drawImage(mask, 0, 0)
    assertUsableMaskCoverage(classifyMaskAlpha(context.getImageData(0, 0, width, height)))
    return { width, height }
  } finally { canvas.width = 1; canvas.height = 1 }
}
/** Transparent mask = editable. Opaque mask = exact original pixels. Export losslessly. */
export async function compositeProtectedEdit(baseDataUrl: string, maskDataUrl: string, editedDataUrl: string) {
  const [base, mask, edited] = await Promise.all([loadImage(baseDataUrl), loadImage(maskDataUrl), loadImage(editedDataUrl)])
  const width = base.naturalWidth, height = base.naturalHeight
  if (mask.naturalWidth !== width || mask.naturalHeight !== height) throw new Error('修改区域与原图尺寸不一致，未保存未受保护的结果')
  const { canvas, context } = canvasFor(width, height)
  try {
    context.drawImage(base, 0, 0); const basePixels = context.getImageData(0, 0, width, height)
    context.clearRect(0, 0, width, height); context.drawImage(edited, 0, 0, width, height)
    const editedPixels = context.getImageData(0, 0, width, height)
    context.clearRect(0, 0, width, height); context.drawImage(mask, 0, 0)
    const maskPixels = context.getImageData(0, 0, width, height)
    assertUsableMaskCoverage(classifyMaskAlpha(maskPixels))
    basePixels.data.set(compositeProtectedPixels(basePixels.data, editedPixels.data, maskPixels.data))
    context.putImageData(basePixels, 0, 0)
    return { dataUrl: canvas.toDataURL('image/png'), width, height }
  } finally { canvas.width = 1; canvas.height = 1 }
}
export async function localMaskPreview(dataUrl: string) {
  const source = await loadImage(dataUrl), originalWidth = source.naturalWidth, originalHeight = source.naturalHeight
  checkSize(originalWidth, originalHeight)
  const scale = Math.min(1, 1920 / Math.max(originalWidth, originalHeight))
  const width = Math.max(1, Math.round(originalWidth * scale)), height = Math.max(1, Math.round(originalHeight * scale))
  const { canvas, context } = canvasFor(width, height)
  try { context.drawImage(source, 0, 0, width, height); return { dataUrl: canvas.toDataURL('image/png'), width, height, originalWidth, originalHeight, wasResized: scale < 1 } }
  finally { canvas.width = 1; canvas.height = 1 }
}
export async function createProtectedEditGuide(guideDataUrl: string, maskDataUrl: string) {
  const [guide, mask] = await Promise.all([loadImage(guideDataUrl), loadImage(maskDataUrl)])
  const { canvas, context } = canvasFor(guide.naturalWidth, guide.naturalHeight)
  try {
    context.drawImage(mask, 0, 0, canvas.width, canvas.height)
    const tint = context.getImageData(0, 0, canvas.width, canvas.height)
    for (let i = 0; i < tint.data.length; i += 4) { tint.data[i] = 0; tint.data[i + 1] = 190; tint.data[i + 2] = 255; tint.data[i + 3] = Math.round((255 - tint.data[i + 3]) * 0.35) }
    context.putImageData(tint, 0, 0); context.globalCompositeOperation = 'destination-over'; context.drawImage(guide, 0, 0)
    return canvas.toDataURL('image/png')
  } finally { canvas.width = 1; canvas.height = 1 }
}
