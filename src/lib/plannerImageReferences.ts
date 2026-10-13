import type { AmazonPlannerSession, AppSettings } from '../types'

export function collectPlannerImageReferences(sessions: AmazonPlannerSession[], settings: Pick<AppSettings, 'customStyleReferences' | 'amazonUploadedStyleReferences'>): Set<string> {
  const ids = new Set<string>()
  const add = (id: unknown) => { if (typeof id === 'string' && id.trim()) ids.add(id) }
  for (const session of sessions) {
    for (const id of session.referenceImageIds ?? []) add(id)
    add(session.selectedStyleReferenceImageId)
    add(session.selectedCustomStyleReferenceSnapshot?.imageId)
    add(session.selectedUploadedStyleReferenceSnapshot?.imageId)
    for (const image of session.styleImages ?? []) add(image.imageId)
  }
  for (const style of settings.customStyleReferences ?? []) add(style.imageId)
  for (const reference of settings.amazonUploadedStyleReferences ?? []) add(reference.imageId)
  return ids
}
