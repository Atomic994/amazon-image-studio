export const GENERATION_QUEUE_LOCK = 'amazon-image-studio-generation-queue'

/** Opening a second tab must not mark another tab's live queue requests interrupted. */
export async function withGenerationQueueRecovery<T>(recover: () => Promise<T>, observe: () => Promise<T>): Promise<T> {
  if (!globalThis.navigator?.locks) return recover()
  return navigator.locks.request(GENERATION_QUEUE_LOCK, { ifAvailable: true }, (lock) => lock ? recover() : observe())
}
