import { useCallback, useRef, useState } from 'react'
import type { PlannerApiProgress } from '../lib/plannerProgress'
import { appendPlannerLog, createPlannerRunLog, finishPlannerRunLog, redactPlannerLogMessage, updatePlannerRunLog, type PlannerRunLogState } from '../lib/plannerRunLog'

export function usePlannerRunLog(kind: NonNullable<PlannerRunLogState['kind']> = 'planner') {
  const [state, setState] = useState(() => createPlannerRunLog(kind))
  const current = useRef(state)
  const apiKey = useRef('')
  const commit = useCallback((next: PlannerRunLogState) => {
    current.current = next
    setState(next)
  }, [])
  const start = useCallback((options: { model: string; apiMode: string; totalPlans: number; referenceCount: number; mode: string; apiKey: string }) => {
    apiKey.current = options.apiKey
    const at = Date.now()
    let next: PlannerRunLogState = { ...createPlannerRunLog(kind), status: 'running', phase: 'preparing', label: kind === 'analysis' ? '正在准备参考资料…' : '正在准备产品参考图…', startedAt: at, totalPlans: options.totalPlans }
    next = appendPlannerLog(next, kind === 'analysis' ? `开始${options.mode}；模型 ${options.model}；${options.apiMode}` : `开始 ${options.mode} 策划：${options.totalPlans} 份方案；模型 ${options.model}；${options.apiMode}`, at)
    commit(appendPlannerLog(next, `正在准备 ${options.referenceCount} 张${kind === 'analysis' ? '' : '产品'}参考图`, at))
  }, [commit, kind])
  const add = useCallback((message: string) => {
    if (current.current.status === 'running') commit(appendPlannerLog(current.current, redactPlannerLogMessage(message, apiKey.current), Date.now()))
  }, [commit])
  const progress = useCallback((value: PlannerApiProgress) => {
    commit(updatePlannerRunLog(current.current, value, Date.now(), apiKey.current))
  }, [commit])
  const finish = useCallback((status: 'success' | 'error' | 'stopped', message: string) => {
    commit(finishPlannerRunLog(current.current, status, message, Date.now(), apiKey.current))
    apiKey.current = ''
  }, [commit])
  const reset = useCallback(() => { apiKey.current = ''; commit(createPlannerRunLog(kind)) }, [commit, kind])
  return { state, start, add, progress, finish, reset }
}
