import type { AmazonPlannerSession, PlannerSettingsSnapshot, ReferenceAnalysisSnapshot } from '../types'
import { confirmedProductFacts, contextFingerprint } from './productFacts'
import { plannerSourceContext } from './referenceAnalysis'
import { referenceAppliesToSlot } from './referenceImageUsage'
import { getStylePresetById } from './stylePresets'
import { getCustomStyleReferenceVisualMeta } from './styleReferences'
import { normalizeListingImageCount, normalizeAPlusModuleSpecs, type AmazonAPlusModuleSpec } from './listingPlanner'
import { hasPlannerTheme, normalizePlannerTheme, plannerThemeContract } from './plannerThemes'

export function plannerVisualStyle(session: AmazonPlannerSession) {
  if (session.selectedCustomStyleReferenceSnapshot) return getCustomStyleReferenceVisualMeta(session.selectedCustomStyleReferenceSnapshot)
  if (session.selectedUploadedStyleReferenceSnapshot) return { label: session.selectedUploadedStyleReferenceSnapshot.title, description: '参考上传图片的配色、光影、对比度、材质和整体视觉质感，不复制原图文字、布局、产品或场景。', palette: [] }
  return getStylePresetById(session.selectedStylePresetId) ?? null
}
export function plannerSettingsSnapshot(session: AmazonPlannerSession, slot: string): PlannerSettingsSnapshot {
  const aplus = slot.startsWith('A+'), main = !aplus && slot === 'MAIN'
  const plan = (aplus ? session.aPlusPlans : session.imagePlans).find((row) => row.slot === slot)
  const { kind: _, scene, ...product } = session.draft
  const visual = main ? null : {
    metadata: plannerVisualStyle(session),
    // Built-in assets can load after planning; their stable preset content defines the visual system.
    imageId: session.selectedCustomStyleReferenceSnapshot?.imageId ?? session.selectedUploadedStyleReferenceSnapshot?.imageId ?? (session.selectedStylePresetId ? null : session.selectedStyleReferenceImageId),
  }
  return {
    listing: contextFingerprint(session.listingText.trim()),
    product: contextFingerprint({ ...product, ...(main ? {} : { scene }) }),
    visual: contextFingerprint(visual), density: contextFingerprint(main ? null : session.styleDensityMode ?? 'rich'),
    guide: contextFingerprint(main ? null : session.seriesStyleGuides[aplus ? 'aplus' : 'listing'].trim()),
    layout: contextFingerprint(aplus ? { type: session.aPlusType, specs: normalizeAPlusModuleSpecs(session.aPlusType, session.aPlusModuleSpecs?.[session.aPlusType] as Array<Partial<AmazonAPlusModuleSpec>> | undefined), module: plan && 'uploadSize' in plan ? [plan.slot, plan.moduleType, plan.uploadSize] : null } : { count: normalizeListingImageCount(session.listingImageCount), kind: plan && 'kind' in plan ? plan.kind : undefined }),
    marketplace: contextFingerprint(session.marketplaceId ?? 'us'),
    theme: contextFingerprint(main || !hasPlannerTheme(session.themeSettings) ? null : normalizePlannerTheme(session.themeSettings)),
  }
}
export function plannerContextForSlot(session: AmazonPlannerSession, slot: string, analyses: Record<string, ReferenceAnalysisSnapshot> = session.referenceAnalyses ?? {}) {
  const ids = session.referenceImageIds.filter((id) => referenceAppliesToSlot(session.referenceImageUsages?.[id], slot))
  return { ...plannerSourceContext(ids, session.referenceImageUsages ?? {}, analyses, confirmedProductFacts(session.productFacts)), planningSettings: plannerSettingsSnapshot(session, slot) }
}
/** Establish comparison settings from the saved history itself, before the user changes them. */
export function upgradePlannerContextBaseline(session: AmazonPlannerSession): AmazonPlannerSession {
  if (!Object.values(session.moduleVersions ?? {}).flat().some((version) => !version.context?.planningSettings)) return session
  const next = structuredClone(session)
  for (const versions of Object.values(next.moduleVersions ?? {})) for (const version of versions) {
    if (version.context?.planningSettings) continue
    const historical = version.mode === 'aplus'
      ? { ...session, aPlusPlans: session.aPlusPlans.map((plan) => plan.slot === version.plan.slot ? version.plan as AmazonPlannerSession['aPlusPlans'][number] : plan) }
      : { ...session, imagePlans: session.imagePlans.map((plan) => plan.slot === version.plan.slot ? version.plan as AmazonPlannerSession['imagePlans'][number] : plan) }
    version.context = {
      ...(version.context ?? plannerContextForSlot(session, version.plan.slot)),
      planningSettings: plannerSettingsSnapshot(historical, version.plan.slot),
      legacySettingsBaseline: true,
    }
  }
  return next
}
export function plannerStyleInstructions(session: AmazonPlannerSession, slot?: string) {
  return [`User-selected visual context (source data): ${JSON.stringify(slot === 'MAIN' ? null : plannerVisualStyle(session))}\nInformation density: ${slot === 'MAIN' ? 'product-only; no on-image text' : session.styleDensityMode ?? 'rich'}. Follow this visual system while preserving confirmed product facts. MAIN must remain a clean white product image without decorative props or on-image copy.`, plannerThemeContract(session, slot)].filter(Boolean).join('\n\n')
}
