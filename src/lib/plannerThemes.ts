import type { AmazonPlannerSession, PlannerThemePreset, PlannerThemeSettings } from '../types'
import { localId } from './localId'

const clean = (value: unknown, max = 2400) => typeof value === 'string' ? value.trim().slice(0, max) : ''
export function normalizePlannerTheme(value?: Partial<PlannerThemeSettings> | null): PlannerThemeSettings {
  return { theme: clean(value?.theme), composition: clean(value?.composition), lighting: clean(value?.lighting), constraints: clean(value?.constraints) }
}
export function hasPlannerTheme(value?: Partial<PlannerThemeSettings> | null) {
  return Object.values(normalizePlannerTheme(value)).some(Boolean)
}
export function plannerThemeContract(session: Pick<AmazonPlannerSession, 'themeSettings' | 'draft'>, slot?: string) {
  if (slot === 'MAIN') return ''
  const theme = normalizePlannerTheme(session.themeSettings), scene = session.draft.scene.trim()
  if (!hasPlannerTheme(theme) && !scene) return ''
  return ['USER THEME AND SCENE DIRECTION (context only; never product facts):', JSON.stringify({ ...theme, scene }),
    'Use these directions for detail images and A+ modules only. Preserve the selected visual palette and all confirmed product facts. Do not invent product features, included accessories or claims. MAIN stays on clean white without scene props.'].join('\n')
}
/** Whitelist reusable creative settings; never save product facts, images, Listing copy or API configuration. */
export function createPlannerThemePreset(input: Partial<PlannerThemePreset>, existing?: PlannerThemePreset): PlannerThemePreset {
  const title = clean(input.title, 100)
  if (!title) throw new Error('请填写预设名称')
  const at = Date.now()
  return { id: existing?.id ?? localId('theme'), title, description: clean(input.description, 600), scene: clean(input.scene), themeSettings: normalizePlannerTheme(input.themeSettings), density: input.density === 'minimal' ? 'minimal' : 'rich', createdAt: existing?.createdAt ?? at, updatedAt: at }
}
export function normalizePlannerThemePreset(input: unknown): PlannerThemePreset | null {
  if (!input || typeof input !== 'object') return null
  const row = input as Partial<PlannerThemePreset>
  if (typeof row.id !== 'string' || !row.id || typeof row.title !== 'string' || !row.title.trim()) return null
  const normalized = createPlannerThemePreset(row)
  return { ...normalized, id: row.id.slice(0, 160), createdAt: typeof row.createdAt === 'number' && Number.isFinite(row.createdAt) ? row.createdAt : normalized.createdAt, updatedAt: typeof row.updatedAt === 'number' && Number.isFinite(row.updatedAt) ? row.updatedAt : normalized.updatedAt }
}
const builtin = (id: string, title: string, description: string, scene: string, theme: string, composition: string, lighting: string): PlannerThemePreset => ({
  id: `builtin:${id}`, title, description, scene, themeSettings: { theme, composition, lighting, constraints: '只展示已确认的商品和配件，不新增虚构功能、认证、Logo 或包装。' }, density: 'rich', createdAt: 0, updatedAt: 0,
})
export const BUILTIN_PLANNER_THEMES: PlannerThemePreset[] = [
  builtin('home', '自然家居', '适合家居产品与日常使用场景', '与商品用途相符的干净居家空间，商品是视觉中心。', '真实生活感，安静舒适，减少无关装饰。', '为主体和卖点留白，保持真实比例。', '柔和自然侧光，保留产品真实材质与颜色。'),
  builtin('desk', '办公桌面', '适合办公、电子及桌面用品', '整洁的办公或阅读桌面，不展示未确认包含的电子设备或附件。', '专注、有序、清晰的使用情境。', '主体与用途相联系，留出清晰文案区。', '均匀柔和光线，细节清楚，避免强烈反光。'),
  builtin('outdoor', '户外自然', '适合明确可用于户外的商品', '与已确认用途相符的自然环境；未确认户外适用时，仅参考自然背景。', '轻松自然，避免暗示未经确认的防水或耐候能力。', '产品清晰突出，背景简洁，不夸大尺寸。', '自然日光和柔和阴影，商品颜色准确。'),
  builtin('details', '结构细节', '适合结构、材质及操作细节说明', '干净的展示背景，以实拍可见结构为依据。', '清楚展示真实细节和使用步骤。', '整体与局部细节形成层级，不生成未经证实的内部剖面。', '中性柔光，保持边缘与表面细节。'),
]
