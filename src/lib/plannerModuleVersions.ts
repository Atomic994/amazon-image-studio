import type { AmazonPlannerSession, PlannerModuleVersion } from '../types'
import { localId } from './localId'

export function plannerModuleKey(mode: 'listing' | 'aplus', slot: string): string { return `${mode}:${slot}` }
export function createPlannerModuleVersion(mode: PlannerModuleVersion['mode'], plan: PlannerModuleVersion['plan'], versionNumber: number, instruction = ''): PlannerModuleVersion {
  return { id: localId('plan-version'), mode, plan: JSON.parse(JSON.stringify(plan)), versionNumber, createdAt: Date.now(), instruction }
}
export function initialPlannerModuleVersions(imagePlans: AmazonPlannerSession['imagePlans'], aPlusPlans: AmazonPlannerSession['aPlusPlans']) {
  const versions: Record<string, PlannerModuleVersion[]> = {}
  const selected: Record<string, string> = {}
  for (const [mode, plans] of [['listing', imagePlans], ['aplus', aPlusPlans]] as const) {
    for (const plan of plans) {
      const version = createPlannerModuleVersion(mode, plan, 1)
      const key = plannerModuleKey(mode, plan.slot)
      versions[key] = [version]; selected[key] = version.id
    }
  }
  return { versions, selected }
}

export function applyPlannerModuleVersion(session: AmazonPlannerSession, version: PlannerModuleVersion): AmazonPlannerSession {
  const field = version.mode === 'listing' ? 'imagePlans' : 'aPlusPlans'
  if (!session[field].some((plan) => plan.slot === version.plan.slot)) throw new Error('当前策划中已不存在这个图片位，请重新选择')
  const key = plannerModuleKey(version.mode, version.plan.slot)
  const next = JSON.parse(JSON.stringify(session)) as AmazonPlannerSession
  if (version.mode === 'listing') next.imagePlans = next.imagePlans.map((plan) => plan.slot === version.plan.slot ? version.plan as AmazonPlannerSession['imagePlans'][number] : plan)
  else next.aPlusPlans = next.aPlusPlans.map((plan) => plan.slot === version.plan.slot ? version.plan as AmazonPlannerSession['aPlusPlans'][number] : plan)
  const history = next.moduleVersions?.[key] ?? []
  next.moduleVersions = { ...next.moduleVersions, [key]: history.some((entry) => entry.id === version.id) ? history : [...history, version] }
  next.selectedModuleVersions = { ...next.selectedModuleVersions, [key]: version.id }
  return next
}
