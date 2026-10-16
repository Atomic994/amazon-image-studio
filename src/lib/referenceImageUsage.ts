import type { ReferenceImageUsage } from '../types'

export const REFERENCE_PURPOSE_LABELS = { product: '商品实物', style: '风格氛围', composition: '构图排版' } as const
export function normalizeReferenceUsage(value?: Partial<ReferenceImageUsage>): ReferenceImageUsage {
  return {
    purpose: value?.purpose === 'style' || value?.purpose === 'composition' ? value.purpose : 'product',
    slots: Array.isArray(value?.slots) ? [...new Set(value.slots.filter((slot) => typeof slot === 'string' && /^(MAIN|PT\d{2}|A\+[LSPM]\d{2})$/.test(slot)))] : [],
    note: typeof value?.note === 'string' ? value.note.slice(0, 1000) : '',
  }
}
export function normalizeReferenceUsages(value: unknown): Record<string, ReferenceImageUsage> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([id, usage]) => id && usage && typeof usage === 'object').map(([id, usage]) => [id, normalizeReferenceUsage(usage)]))
}
export function referenceAppliesToSlot(usage: ReferenceImageUsage | undefined, slot?: string): boolean {
  return !slot || !usage?.slots.length || usage.slots.includes(slot)
}
export function describeReferenceUsage(usage?: ReferenceImageUsage): string {
  const normalized = normalizeReferenceUsage(usage)
  const guidance = normalized.purpose === 'product'
    ? 'Product reference: use only for real product appearance and verified details.'
    : normalized.purpose === 'style'
      ? 'Style reference: borrow visual mood, colors and lighting only. Never copy its product, logos or claims.'
      : 'Composition reference: borrow layout and spatial arrangement only. Never copy its product, text or logos.'
  return `${guidance} Scope: ${normalized.slots.length ? normalized.slots.join(', ') : 'all image slots'}.${normalized.note ? ` User reference note (context only): ${normalized.note}` : ''}`
}
export function referenceUsageContract(ids: string[], usages: Record<string, ReferenceImageUsage>, hiddenStyleId?: string): string {
  if (!ids.some((id) => id !== hiddenStyleId && (usages[id]?.purpose !== undefined && (usages[id].purpose !== 'product' || usages[id].slots.length || usages[id].note)))) return ''
  return ['REFERENCE IMAGE ROLES (in actual attachment order):', ...ids.map((id, index) =>
    `Reference ${index + 1}: ${id === hiddenStyleId ? 'User-selected visual style board. Follow its visual system; do not copy products or text.' : describeReferenceUsage(usages[id])}`,
  ), 'Only product references establish product facts. Style and composition references must not change the real product identity.'].join('\n')
}
