import { useCallback, useRef, useState } from 'react'
import type { PlannerApiProgress } from '../lib/plannerProgress'
import { appendPlannerLog, createPlannerRunLog, finishPlannerRunLog, redactPlannerLogMessage, updatePlannerRunLog, type PlannerLogEntry, type PlannerRunLogState } from '../lib/plannerRunLog'

export function useTranslationRunLog() {
  const [state, setState] = useState(() => createPlannerRunLog('translation'))
  const current = useRef(state)
  const apiKey = useRef('')
  const commit = useCallback((next: PlannerRunLogState) => { current.current = next; setState(next) }, [])
  const reset = useCallback(() => { apiKey.current = ''; commit(createPlannerRunLog('translation')) }, [commit])
  const start = useCallback((options: { model: string; apiMode: string; apiKey: string; refresh: boolean }) => {
    apiKey.current = options.apiKey
    const at = Date.now()
    const next = { ...createPlannerRunLog('translation'), status: 'running' as const, phase: 'cache', label: '正在检查本地译文缓存…', startedAt: at }
    commit(appendPlannerLog(next, redactPlannerLogMessage(`${options.refresh ? '重新翻译，跳过旧缓存' : '开始翻译，检查本地缓存'}；模型 ${options.model}；${options.apiMode}`, apiKey.current), at))
  }, [commit])
  const add = useCallback((message: string, level: PlannerLogEntry['level'] = 'info') => {
    if (current.current.status === 'running') commit(appendPlannerLog(current.current, redactPlannerLogMessage(message, apiKey.current), Date.now(), level))
  }, [commit])
  const progress = useCallback((value: PlannerApiProgress) => {
    commit(updatePlannerRunLog(current.current, value, Date.now(), apiKey.current))
  }, [commit])
  const finish = useCallback((status: 'success' | 'error' | 'stopped', message: string) => {
    commit(finishPlannerRunLog(current.current, status, message, Date.now(), apiKey.current))
    apiKey.current = ''
  }, [commit])
  return { state, reset, start, add, progress, finish }
}
