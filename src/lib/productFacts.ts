import type { AmazonPlannerSessionDraft, ProductFacts, ProductFactsState, ProductFactsVersion } from '../types'
import { localId } from './localId'

export const EMPTY_PRODUCT_FACTS: ProductFacts = { productName: '', brand: '', model: '', color: '', material: '', dimensions: '', packageContents: '', visibleFeatures: [], immutableFeatures: [], forbiddenChanges: [], needsConfirmation: [] }
export const FACT_FIELDS = [
  ['productName', '商品名称'], ['brand', '品牌 / Logo'], ['model', '型号'], ['color', '真实颜色'],
  ['material', '已核实材质'], ['dimensions', '已核实尺寸'], ['packageContents', '包装 / 配件清单'],
] as const
export const FACT_LIST_FIELDS = [['visibleFeatures', '可见结构与细节'], ['immutableFeatures', '必须保持的特征'], ['forbiddenChanges', '禁止改变 / 禁止添加'], ['needsConfirmation', '尚未核实，禁止推断']] as const

export function cleanText(value: unknown, limit = 2000): string { return typeof value === 'string' ? value.trim().slice(0, limit) : '' }
export function cleanList(value: unknown): string[] { return Array.isArray(value) ? [...new Set(value.map((item) => cleanText(item, 1000)).filter(Boolean))].slice(0, 30) : [] }
export function normalizeProductFacts(value: unknown): ProductFacts {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return Object.fromEntries([...FACT_FIELDS.map(([key]) => [key, cleanText(raw[key])]), ...FACT_LIST_FIELDS.map(([key]) => [key, cleanList(raw[key])])]) as unknown as ProductFacts
}
export function hasKnownProductFacts(facts: ProductFacts): boolean {
  return FACT_FIELDS.some(([key]) => known(facts[key])) || [facts.visibleFeatures, facts.immutableFeatures, facts.forbiddenChanges].some((values) => values.some(known))
}
function known(value: string): boolean { return !!value.trim() && !/^(unknown|未知|不确定|待确认|未核实|n\/a)$/i.test(value.trim()) }
export function emptyProductFactsState(): ProductFactsState { return { draft: normalizeProductFacts({}), draftSource: 'manual', versions: [] } }
export function normalizeProductFactsState(value?: ProductFactsState): ProductFactsState {
  const versions = (Array.isArray(value?.versions) ? value.versions : []).filter((version) => version && typeof version.id === 'string' && Number.isFinite(version.versionNumber) && Number.isFinite(version.confirmedAt))
    .map((version) => ({ ...version, sourceImageIds: Array.isArray(version.sourceImageIds) ? version.sourceImageIds.filter((id) => typeof id === 'string') : [], facts: normalizeProductFacts(version.facts) }))
  return { draft: normalizeProductFacts(value?.draft), draftSource: value?.draftSource === 'ai' ? 'ai' : 'manual', versions, selectedVersionId: versions.some((version) => version.id === value?.selectedVersionId) ? value?.selectedVersionId : undefined }
}
export function confirmedProductFacts(state?: ProductFactsState): ProductFactsVersion | undefined { return state?.versions.find((version) => version.id === state.selectedVersionId) }
export function confirmProductFacts(state: ProductFactsState, sourceFingerprint: string, sourceImageIds: string[]): ProductFactsState {
  const facts = normalizeProductFacts(state.draft)
  if (!hasKnownProductFacts(facts)) throw new Error('请先填写至少一项已核实的商品事实')
  const version: ProductFactsVersion = { id: localId('product-facts'), versionNumber: Math.max(0, ...state.versions.map((row) => row.versionNumber)) + 1, confirmedAt: Date.now(), source: state.draftSource, sourceFingerprint, sourceImageIds: [...sourceImageIds], facts }
  return { draft: normalizeProductFacts(facts), draftSource: state.draftSource, versions: [...state.versions, version], selectedVersionId: version.id }
}
export function factsFromProductDraft(draft: AmazonPlannerSessionDraft): ProductFacts {
  return normalizeProductFacts({ productName: draft.productTitle, brand: draft.brand, color: draft.color, material: draft.material, packageContents: draft.packageIncludes, forbiddenChanges: draft.forbidden.split(/\r?\n/).filter(Boolean) })
}
export function buildProductFactsContract(version?: ProductFactsVersion): string {
  if (!version) return ''
  const facts = normalizeProductFacts(version.facts)
  return [`CONFIRMED PRODUCT FACTS [${version.id}] v${version.versionNumber} (product identity constraints; never render this block as image text):`,
    ...FACT_FIELDS.filter(([key]) => known(facts[key])).map(([key]) => `${key}: ${facts[key]}`),
    ...(['visibleFeatures', 'immutableFeatures', 'forbiddenChanges'] as const).filter((key) => facts[key].length).map((key) => `${key}: ${facts[key].filter(known).join('; ')}`),
    ...(facts.needsConfirmation.length ? [`UNVERIFIED — leave unspecified and do not invent: ${facts.needsConfirmation.join('; ')}`] : []),
    'These user-confirmed facts override unverified listing inferences and visual-style references. Preserve exact product identity, logos, structure and accessory count. Do not invent dimensions, materials, performance or claims. Style, background and composition may change only without changing these facts.',
  ].join('\n')
}
export function appendProductFactsContract(prompt: string, version?: ProductFactsVersion): string {
  if (!version || prompt.includes(`CONFIRMED PRODUCT FACTS [${version.id}]`)) return prompt
  return [prompt, buildProductFactsContract(version)].filter(Boolean).join('\n\n')
}
/** Compact change detection, never used for authentication or cache content equality. */
export function contextFingerprint(value: unknown): string {
  const text = JSON.stringify(value)
  let a = 0x811c9dc5, b = 0x9e3779b9
  for (let index = 0; index < text.length; index++) { a = Math.imul(a ^ text.charCodeAt(index), 0x01000193); b = Math.imul(b ^ text.charCodeAt(index), 0x85ebca6b) }
  return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`
}
