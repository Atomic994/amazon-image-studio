import {
  getAPlusModuleDisplayName,
  getAPlusModuleEnglishName,
  getAPlusModuleGenerationSize,
  getAPlusModuleUploadSize,
  type AmazonAPlusModuleSpec,
  type AmazonAPlusPlan,
} from './listingPlanner'
import type { SizeTier } from './size'

export interface PlannerModulePreview {
  slot: string
  title: string
  uploadSize: string
  generationSize: string
  content: string
}

export function buildPlannerModulePreviews(options: {
  specs: AmazonAPlusModuleSpec[]
  plans: AmazonAPlusPlan[]
  tier: SizeTier
  seriesStyleGuide: string
}): PlannerModulePreview[] {
  const { specs, plans, tier, seriesStyleGuide } = options
  const modules = plans.length ? plans : specs
  return modules.map((module) => {
    const plan = 'planMarkdown' in module ? module : null
    const spec = specs.find((item) => item.slot === module.slot)
    const uploadSize = plan?.uploadSize ?? getAPlusModuleUploadSize(module as AmazonAPlusModuleSpec)
    const generationSize = plan?.generationSize ?? getAPlusModuleGenerationSize(module as AmazonAPlusModuleSpec, tier)
    const sections = [
      `## ${module.slot} · ${getAPlusModuleDisplayName(module)}`,
      getAPlusModuleEnglishName(module),
      `上传尺寸：${uploadSize} px  \n生成尺寸：${generationSize} px`,
    ]
    if (plan) {
      const fields = [
        ['策划说明', plan.planMarkdown],
        ['A+ 标题', plan.textTitle],
        ['A+ 正文', plan.textBody],
        ['生图提示词', plan.prompt],
        ['负向提示词', plan.negativePrompt],
        ['系列一致性', seriesStyleGuide],
      ]
      for (const [label, value] of fields) {
        if (value?.trim()) sections.push(`### ${label}\n\n${value}`)
      }
    } else if (spec) {
      sections.push(`### 模块目标\n\n${spec.objective}`, '尚未生成策划内容。')
    }
    return {
      slot: module.slot,
      title: getAPlusModuleDisplayName(module),
      uploadSize,
      generationSize,
      content: sections.join('\n\n'),
    }
  })
}
