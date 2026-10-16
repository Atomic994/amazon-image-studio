import { strToU8, zip } from 'fflate'
import type { MaterialCollection, MaterialCollectionVersion, StoredImage } from '../types'
import { confirmedProductFacts, normalizeProductFacts } from './productFacts'
import { normalizeReferenceAnalysis } from './referenceAnalysis'
import { normalizeReferenceUsage } from './referenceImageUsage'

export function safeDeliveryName(value: string, fallback = 'material'): string {
  let name = value.normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_').replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '').slice(0, 72).replace(/[. ]+$/g, '')
  if (!name) name = fallback
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `_${name}`
  return name
}
function factsSnapshot(value: MaterialCollectionVersion['items'][number]['productFactsSnapshot']) {
  return value ? { id: value.id, versionNumber: value.versionNumber, confirmedAt: value.confirmedAt, facts: normalizeProductFacts(value.facts) } : undefined
}
function analysesSnapshot(values: MaterialCollectionVersion['items'][number]['referenceAnalysisSnapshots']) {
  return values?.map((value) => ({ id: value.id, imageId: value.imageId, model: value.model, createdAt: value.createdAt, usage: normalizeReferenceUsage(value.usage), analysis: normalizeReferenceAnalysis(value.analysis) }))
}
/** A delivery ZIP contains one saved version's outputs and a credential-free manifest. */
export async function buildMaterialDeliveryZip(collection: MaterialCollection, versionId: string, readImage: (id: string) => Promise<StoredImage | undefined>, onProgress?: (message: string) => void) {
  const version = collection.versions.find((item) => item.id === versionId)
  if (!version) throw new Error('该套组版本不存在，请重新选择')
  if (!version.items.length) throw new Error('此版本只有策划，生成并收藏图片后才能导出交付 ZIP')
  const baseName = `${safeDeliveryName(collection.title)}_v${version.versionNumber}`
  const files: Record<string, Uint8Array> = {}, images = []
  const usedNames = new Set<string>()
  for (let index = 0; index < version.items.length; index++) {
    const item = version.items[index]
    onProgress?.(`读取图片 ${index + 1}/${version.items.length}：${item.slot || item.label}`)
    const image = await readImage(item.imageId)
    if (!image?.dataUrl.startsWith('data:image/')) throw new Error(`“${item.slot || item.label}”原图缺失，未导出 ZIP。请恢复本地数据备份后重试。`)
    const blob = await (await fetch(image.dataUrl)).blob()
    const extension = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' } as Record<string, string>)[blob.type.toLowerCase()]
    if (!extension || !blob.size) throw new Error(`“${item.slot || item.label}”图片格式无效，未导出 ZIP`)
    const slot = safeDeliveryName(item.slot || item.label, `image-${index + 1}`)
    const prefix = `${baseName}_${slot}`
    let filename = `${prefix}.${extension}`, suffix = 2
    while (usedNames.has(filename.toLowerCase())) filename = `${prefix}_${suffix++}.${extension}`
    usedNames.add(filename.toLowerCase())
    files[`images/${filename}`] = new Uint8Array(await blob.arrayBuffer())
    images.push({ file: `images/${filename}`, imageId: item.imageId, slot: item.slot, label: item.label, prompt: item.prompt,
      params: { size: item.params.size, quality: item.params.quality, output_format: item.params.output_format, output_compression: item.params.output_compression, n: item.params.n },
      dimensions: image.width && image.height ? { width: image.width, height: image.height } : undefined,
      reviewNote: item.reviewNote, productFacts: factsSnapshot(item.productFactsSnapshot), referenceAnalyses: analysesSnapshot(item.referenceAnalysisSnapshots),
      references: item.referenceImageIds.map((id) => ({ imageId: id, usage: normalizeReferenceUsage(item.referenceImageUsages?.[id]) })),
    })
  }
  const manifest = { format: 'amazon-image-studio-delivery', version: 1, title: collection.title, collectionId: collection.id,
    savedVersion: { id: version.id, number: version.versionNumber, createdAt: version.createdAt, note: version.note },
    exportedAt: Date.now(), imageProcessing: 'original bytes; no resize or upscaling',
    planner: version.plannerSession ? { mode: version.plannerSession.mode, marketplaceId: version.plannerSession.marketplaceId, productFacts: factsSnapshot(confirmedProductFacts(version.plannerSession.productFacts)) } : undefined,
    images,
  }
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2))
  files['README.txt'] = strToU8('Amazon Image Studio · 单套素材交付包\n\nimages/ 为此套组所选版本的生成原图，保持原始像素和格式；未放大、裁切或重新编码。\nmanifest.json 包含图片位、提示词、参数、审核备注、商品事实及参考图分析快照，不含 API 配置。\n参考原图、其他套组及其他版本不在此包中。此文件不是完整项目备份；迁移浏览器请使用“备份本地数据”。\n提示词和分析可能含商品资料，分享前可检查 manifest.json。\n')
  onProgress?.(`正在打包 ${images.length} 张图片…`)
  const bytes = await new Promise<Uint8Array>((resolve, reject) => { zip(files, { level: 0 }, (error, data) => error ? reject(error) : resolve(data)) })
  return { filename: `${baseName}.zip`, bytes }
}
export function downloadMaterialDeliveryZip(result: { filename: string; bytes: Uint8Array }) {
  const url = URL.createObjectURL(new Blob([result.bytes as BlobPart], { type: 'application/zip' }))
  const link = document.createElement('a'); link.href = url; link.download = result.filename
  document.body.appendChild(link); link.click(); link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
