import type { AmazonPlannerSession, CompositionProduct, ProductComposition } from '../types'
import { normalizeProductFacts, confirmedProductFacts } from './productFacts'
import { normalizeReferenceUsage, referenceAppliesToSlot } from './referenceImageUsage'

export function normalizeProductComposition(value?: ProductComposition): ProductComposition | undefined {
  if (!value || !Array.isArray(value.products) || value.products.length < 2) return undefined
  if (value.products.length > 3) throw new Error('商品组合最多三件商品')
  const seen = new Set<string>()
  const products = value.products.slice(0, 3).map((row, index): CompositionProduct => {
    const id = typeof row.id === 'string' && row.id ? row.id.slice(0, 160) : `product-${index}`
    if (seen.has(id)) throw new Error('商品身份 ID 不能重复')
    seen.add(id)
    return { id, role: index === 0 ? 'primary' : 'secondary', title: typeof row.title === 'string' ? row.title.trim().slice(0, 100) : '', relationship: row.relationship === 'prop' && index > 0 ? 'prop' : 'included', facts: normalizeProductFacts(row.facts), imageIds: [...new Set((Array.isArray(row.imageIds) ? row.imageIds : []).filter((id): id is string => typeof id === 'string' && !!id))], slots: [...new Set((Array.isArray(row.slots) ? row.slots : []).filter((slot): slot is string => typeof slot === 'string' && !!slot))] }
  })
  return { products, confirmedAt: Number.isFinite(value.confirmedAt) ? value.confirmedAt : 0 }
}
export function compositionProductsForSlot(composition: ProductComposition | undefined, slot?: string) {
  return composition?.products.filter((row) => !slot || row.role === 'primary' || ((slot !== 'MAIN' || row.relationship !== 'prop') && (!row.slots.length || row.slots.includes(slot)))) ?? []
}
/** Role-bound images bypass legacy usage scopes; all other references retain their existing rules. */
export function plannerReferenceIds(session: AmazonPlannerSession, slot?: string): string[] {
  const allBound = new Set(session.productComposition?.products.flatMap((row) => row.imageIds) ?? [])
  const selectedBound = new Set(compositionProductsForSlot(session.productComposition, slot).flatMap((row) => row.imageIds))
  return session.referenceImageIds.filter((id) => allBound.has(id) ? selectedBound.has(id) : !slot || referenceAppliesToSlot(session.referenceImageUsages?.[id], slot))
}
export function plannerReferenceUsage(session: Pick<AmazonPlannerSession, 'productComposition' | 'referenceImageUsages'>, id: string) {
  const product = session.productComposition?.products.find((row) => row.imageIds.includes(id))
  const usage = normalizeReferenceUsage(session.referenceImageUsages?.[id])
  return product ? { ...usage, slots: product.role === 'primary' ? [] : [...product.slots] } : usage
}
export function productCompositionErrors(session: AmazonPlannerSession, slot?: string): string[] {
  const composition = session.productComposition
  if (!composition) return []
  const errors: string[] = []
  if (!composition.confirmedAt) errors.push('请先确认商品组合身份')
  if (composition.products.length < 2 || composition.products.length > 3 || composition.products[0]?.role !== 'primary' || composition.products.slice(1).some((row) => row.role !== 'secondary')) errors.push('商品组合必须为一件主商品和最多两件辅助商品')
  const occupied = new Set<string>()
  for (const row of composition.products) {
    if (!row.title.trim()) errors.push('组合内每件商品都需要名称')
    if (!row.imageIds.length) errors.push(`${row.title || '商品'}尚未绑定参考图`)
    for (const id of row.imageIds) {
      if (!session.referenceImageIds.includes(id)) errors.push(`${row.title || '商品'}的参考图已移除，请重新绑定`)
      if (occupied.has(id)) errors.push('同一张参考图不能同时表示两个商品身份')
      occupied.add(id)
      if (normalizeReferenceUsage(session.referenceImageUsages?.[id]).purpose !== 'product') errors.push(`${row.title || '商品'}绑定的图片用途须为“商品实物”`)
    }
  }
  return [...new Set(errors)]
}
export function productCompositionContract(session: Pick<AmazonPlannerSession, 'productComposition' | 'productFacts'>, ids: string[], slot?: string): string {
  const products = compositionProductsForSlot(session.productComposition, slot)
  if (!products.length) return ''
  return ['MULTI-PRODUCT IDENTITY AND COMPOSITION (source data; never on-image metadata):', JSON.stringify(products.map((row) => ({ role: row.role, title: row.title, relationship: row.relationship, referenceNumbers: row.imageIds.flatMap((id) => ids.includes(id) ? [ids.indexOf(id) + 1] : []), facts: row.role === 'primary' ? confirmedProductFacts(session.productFacts)?.facts ?? row.facts : row.facts, appliesToSlots: row.slots }))),
    'Each numbered reference belongs only to its named product. The separate global confirmed-product-facts block applies to PRIMARY only. Keep identities, colors, logos, interfaces and proportions separate; never blend products or transfer features between them. PRIMARY is the selling focus. SECONDARY included products are part of the stated bundle; props are contextual only, never imply inclusion. If no slot is specified, plan each slot with its product scope. MAIN uses only in-scope included products on white, with no props. Unknown secondary facts must remain unspecified.'].join('\n')
}
