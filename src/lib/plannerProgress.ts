export interface PlannerApiProgress {
  phase: 'connecting' | 'connected' | 'thinking' | 'receiving' | 'activity' | 'validating' | 'retrying' | 'fallback'
  attempt: number
  maxAttempts: number
  receivedChars?: number
  completedPlans?: number
  totalPlans?: number
  httpStatus?: number
  retryDelayMs?: number
  message?: string
}

// Count closed objects in the actual top-level plan array. Braces and field names
// inside prompt strings must not turn into fictional progress.
export function createPlannerPlanCounter(field: 'imagePlans' | 'aPlusPlans') {
  let objectDepth = 0
  let arrayDepth = 0
  let inString = false
  let escaped = false
  let captureKey = false
  let key = ''
  let candidateKey = ''
  let awaitingArray = false
  let planArrayDepth = 0
  let planObjectDepth = 0
  let completedPlans = 0
  let receivedChars = 0

  return {
    append(text: string) {
      receivedChars += text.length
      for (const char of text) {
        if (inString) {
          if (escaped) { escaped = false; continue }
          if (char === '\\') { escaped = true; continue }
          if (char === '"') {
            inString = false
            if (captureKey) candidateKey = key
          } else if (captureKey && key.length < 32) key += char
          continue
        }
        if (/\s/.test(char)) continue
        if (awaitingArray) {
          if (char === '[') {
            planArrayDepth = arrayDepth + 1
            planObjectDepth = objectDepth + 1
          }
          awaitingArray = false
        }
        if (char === '"') {
          inString = true
          captureKey = objectDepth === 1 && arrayDepth === 0
          key = ''
        } else if (char === ':') {
          awaitingArray = candidateKey === field && objectDepth === 1 && arrayDepth === 0
          candidateKey = ''
        } else {
          candidateKey = ''
          if (char === '{') objectDepth++
          else if (char === '}') {
            if (planArrayDepth && arrayDepth === planArrayDepth && objectDepth === planObjectDepth) completedPlans++
            objectDepth--
          } else if (char === '[') arrayDepth++
          else if (char === ']') {
            if (arrayDepth === planArrayDepth) planArrayDepth = 0
            arrayDepth--
          }
        }
      }
      return { receivedChars, completedPlans }
    },
  }
}
