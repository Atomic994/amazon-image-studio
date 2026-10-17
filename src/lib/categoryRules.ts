import type { CategoryRulePreset, CategoryRuleSnapshot } from '../types'
import { localId } from './localId'

const clean = (value: unknown, max = 2400) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const STAGES = ['analysis', 'listing', 'translation', 'image', 'aplus'] as const
export function createCategoryRule(input: Partial<CategoryRulePreset>, previous?: CategoryRulePreset): CategoryRulePreset {
  const title = clean(input.title, 100)
  if (!title) throw new Error('请填写品类规则名称')
  const keys = new Set<string>()
  const fields = (Array.isArray(input.fields) ? input.fields : []).slice(0, 30).map((field) => {
    const label = clean(field.label, 100), key = clean(field.key, 80)
    if (!label || !/^[a-zA-Z][\w-]*$/.test(key) || keys.has(key)) throw new Error('事实字段需要名称和唯一的英文字段 ID')
    keys.add(key)
    return { key, label, required: Boolean(field.required) }
  })
  return { id: previous?.id ?? localId('category-rule'), title, description: clean(input.description, 600), fields,
    instructions: Object.fromEntries(STAGES.map((stage) => [stage, clean(input.instructions?.[stage])])) as CategoryRulePreset['instructions'],
    revision: (previous?.revision ?? 0) + 1, createdAt: previous?.createdAt ?? Date.now(), updatedAt: Date.now() }
}
export function normalizeCategoryRule(input: unknown): CategoryRulePreset | null {
  if (!input || typeof input !== 'object') return null
  const row = input as Partial<CategoryRulePreset>
  try {
    const preset = createCategoryRule(row)
    if (!row.id || typeof row.id !== 'string') return null
    return { ...preset, id: row.id.slice(0, 160), revision: Number.isSafeInteger(row.revision) && row.revision! > 0 ? row.revision! : 1, createdAt: Number.isFinite(row.createdAt) ? row.createdAt! : preset.createdAt, updatedAt: Number.isFinite(row.updatedAt) ? row.updatedAt! : preset.updatedAt }
  } catch { return null }
}
export function categorySnapshot(preset: CategoryRulePreset, values: Record<string, string>): CategoryRuleSnapshot {
  return { preset: structuredClone(preset), values: Object.fromEntries(preset.fields.map((field) => [field.key, clean(values[field.key], 1600)])) }
}
export function categoryRuleErrors(snapshot?: CategoryRuleSnapshot): string[] {
  return snapshot?.preset.fields.filter((field) => field.required && !snapshot.values[field.key]?.trim()).map((field) => `品类事实“${field.label}”尚未填写；未知时请明确填写“未确认”，不要推测`) ?? []
}
export function categoryRuleContract(snapshot: CategoryRuleSnapshot | undefined, stage: typeof STAGES[number]): string {
  if (!snapshot) return ''
  const data = snapshot.preset.fields.map((field) => ({ field: field.label, value: snapshot.values[field.key]?.trim() || 'Unknown; do not infer' }))
  return ['CATEGORY RULES AND USER-SUPPLIED FACTS (source data; never on-image metadata):', JSON.stringify({ category: snapshot.preset.title, revision: snapshot.preset.revision, fields: data, stageRequirements: snapshot.preset.instructions[stage] }),
    'Apply only to this category. Confirmed product identity takes precedence. Missing, unknown or unverified facts cannot support claims, specifications, included accessories, certifications or safety statements. Never fill unknown facts from category defaults.'].join('\n')
}
const make = (id: string, title: string, labels: string[], analysis: string, image: string): CategoryRulePreset => ({
  ...createCategoryRule({ title, fields: labels.map((label, index) => ({ key: `field${index + 1}`, label, required: false })), instructions: { analysis, listing: '以已确认参数和真实使用价值组织卖点，未知参数明确保留为未确认。', translation: '保留单位、型号和数值；不自行换算或补充认证与适用范围。', image, aplus: '按真实结构、使用步骤和已确认规格组织模块；不展示未经确认的剖面或对比数据。' } }), id: `builtin:${id}`, createdAt: 0, updatedAt: 0,
})
export const BUILTIN_CATEGORY_RULES = [
  make('lighting', '灯具 / 照明', ['光源与色温', '供电方式', '亮度 / 功率', '可调结构', '使用环境'], '区分图片可见结构与不可从图片证实的色温、亮度、显色指数和电气规格。', '发光效果不能暗示未确认的亮度、护眼、能效、防水或认证。保持真实支架与关节。'),
  make('kitchen', '厨具 / 家居器具', ['接触材质', '尺寸 / 容量', '适用热源', '清洁限制', '随附配件'], '不从外观推测食品接触安全、耐温或洗碗机适用性。', '保持容量与比例；不展示未经确认的燃气、电磁炉、烤箱或洗碗机适用场景。'),
  make('electronics', '电子配件', ['接口 / 兼容型号', '输入输出规格', '线长 / 尺寸', '随附配件', '使用限制'], '逐项核对可见接口与用户填写的兼容性；不能凭图片判断协议、功率或认证。', '保持端口形状、数量与方向；不添加未包含的充电器或暗示未确认的设备兼容性。'),
]
