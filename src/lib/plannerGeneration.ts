import type { AmazonPlannerSession, ApiProfile, GenerationQueueRequest, ReferenceAnalysisSnapshot } from '../types'
import { DEFAULT_PARAMS } from '../types'
import { appendProductFactsContract, confirmedProductFacts, contextFingerprint } from './productFacts'
import { analysisMatchesInputs, plannerContextChangeReasons } from './referenceAnalysis'
import { REFERENCE_PURPOSE_LABELS, normalizeReferenceUsage, referenceAppliesToSlot } from './referenceImageUsage'
import { buildAmazonAPlusPlanPrompt, buildAmazonPlanPrompt, isAmazonListingMainSlot } from './listingPlanner'
import { plannerModuleKey } from './plannerModuleVersions'
import { plannerContextForSlot, plannerVisualStyle } from './plannerContext'
export { plannerVisualStyle } from './plannerContext'
import { canApiProfileGenerateImages, validateApiProfile } from './apiProfiles'
import { plannerThemeContract } from './plannerThemes'

export interface PlannerGenerationSpec {
  slot: string; label: string; versionLabel: string; prompt: string; size: string; stale: boolean
  factsVersion?: number; errors: string[]; excludedIds: string[]; staleReasons: string[]
  references: Array<{ id: string; role: string; hidden: boolean; analysis?: ReferenceAnalysisSnapshot }>
  request: GenerationQueueRequest
}
export function generationProfileIdentity(profile: ApiProfile): string {
  return contextFingerprint([profile.provider, profile.baseUrl.trim().replace(/\/+$/, ''), profile.model, profile.apiMode, profile.codexCli])
}
/** Used both by preflight and dispatch, with the exact ordered input IDs captured here. */
export function buildPlannerGenerationSpec(session: AmazonPlannerSession, slot: string, profile: ApiProfile, inputLimit: number): PlannerGenerationSpec {
  const plan = (session.mode === 'aplus' ? session.aPlusPlans : session.imagePlans).find((item) => item.slot === slot)
  if (!plan) throw new Error(`图片位 ${slot} 已不存在，请重新选择`)
  const main = session.mode === 'listing' && isAmazonListingMainSlot(slot)
  const styleId = !main ? session.selectedStyleReferenceImageId : undefined
  const ids = session.referenceImageIds.filter((id) => referenceAppliesToSlot(session.referenceImageUsages?.[id], slot))
  const excludedIds = session.referenceImageIds.filter((id) => !ids.includes(id))
  if (styleId && !ids.includes(styleId)) ids.push(styleId)
  const usages = Object.fromEntries(ids.filter((id) => id !== styleId).map((id) => [id, normalizeReferenceUsage(session.referenceImageUsages?.[id])]))
  const analyses = Object.fromEntries(Object.entries(session.referenceAnalyses ?? {}).filter(([id, value]) => ids.includes(id) && id !== styleId && analysisMatchesInputs(value, id, usages[id])))
  const facts = confirmedProductFacts(session.productFacts)
  const key = plannerModuleKey(session.mode, slot)
  const version = session.moduleVersions?.[key]?.find((item) => item.id === session.selectedModuleVersions?.[key])
  const options = { ...plan, seriesStyleGuide: main ? null : session.seriesStyleGuides[session.mode], styleReferenceAttached: !!styleId, styleDensityMode: session.styleDensityMode, marketplaceId: session.marketplaceId, selectedVisualStyle: styleId ? plannerVisualStyle(session) : null }
  const prompt = appendProductFactsContract([session.mode === 'aplus' ? buildAmazonAPlusPlanPrompt(options) : buildAmazonPlanPrompt(options), plannerThemeContract(session, slot)].filter(Boolean).join('\n\n'), facts)
  const size = session.mode === 'aplus' ? (plan as AmazonPlannerSession['aPlusPlans'][number]).generationSize : session.resolution === '4k' ? '4096x4096' : '2048x2048'
  const errors: string[] = []
  const profileError = validateApiProfile(profile)
  if (profileError) errors.push(`生图配置不完整：${profileError}`)
  if (!canApiProfileGenerateImages(profile)) errors.push('当前配置不支持生成图片')
  if (!main && !styleId) errors.push('请先选择并加载一套风格参考')
  if (ids.length > inputLimit) errors.push(`实际参考图 ${ids.length} 张，超过当前接口上限 ${inputLimit} 张`)
  if (!prompt.trim()) errors.push('生图提示词为空')
  const staleReasons = plannerContextChangeReasons(version?.context, plannerContextForSlot(session, slot, analyses))
  const request: GenerationQueueRequest = { apiProfileId: profile.id, profileIdentity: generationProfileIdentity(profile), prompt, inputImageIds: ids,
    params: { ...DEFAULT_PARAMS, size, n: 1 }, referenceImageUsages: usages, productFactsSnapshot: facts, referenceAnalysisSnapshots: Object.values(analyses),
    category: { productTitle: session.draft.productTitle.trim(), workflow: session.mode === 'aplus' ? 'amazon-aplus' : 'amazon-listing', amazonSlot: slot, plannerSessionId: session.id,
      plannerModuleVersionId: version?.id, productFactsVersionId: facts?.id, marketplaceId: session.marketplaceId, ...(session.mode === 'aplus' ? { aPlusType: session.aPlusType } : {}), ...(styleId ? { styleReferenceImageId: styleId } : {}) },
  }
  return { slot, label: plan.label, prompt, size, excludedIds, request, errors, factsVersion: facts?.versionNumber,
    versionLabel: version ? `v${version.versionNumber}${version.creative ? ` · ${version.creative.title}` : ''}` : '原始策划',
    stale: staleReasons.length > 0, staleReasons,
    references: ids.map((id) => ({ id, hidden: id === styleId, role: id === styleId ? '隐藏风格参考：仅用于视觉风格' : `${REFERENCE_PURPOSE_LABELS[usages[id].purpose]} · ${usages[id].slots.length ? `仅 ${usages[id].slots.join('、')}` : '全部图片位'}${usages[id].note ? ` · ${usages[id].note}` : ''}`, analysis: analyses[id] })),
  }
}
