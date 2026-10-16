import type { PlannerApiProgress } from './plannerProgress'

export interface PlannerLogEntry {
  id: number
  at: number
  message: string
  level: 'info' | 'warning' | 'success' | 'error'
}

export interface PlannerRunLogState {
  kind?: 'planner' | 'translation' | 'analysis'
  status: 'idle' | 'running' | 'success' | 'error' | 'stopped'
  phase: string
  label: string
  startedAt?: number
  finishedAt?: number
  lastActivityAt?: number
  lastContentAt?: number
  receivedChars: number
  completedPlans: number
  totalPlans: number
  attempt: number
  entries: PlannerLogEntry[]
  nextId: number
  lastReceivingLogAt?: number
  lastActivityLogAt?: number
}

export function createPlannerRunLog(kind: NonNullable<PlannerRunLogState['kind']> = 'planner'): PlannerRunLogState {
  return { kind, status: 'idle', phase: 'idle', label: kind === 'analysis' ? '等待开始分析' : kind === 'translation' ? '等待开始翻译' : '等待开始 AI 策划', receivedChars: 0, completedPlans: 0, totalPlans: 0, attempt: 0, entries: [], nextId: 1 }
}

export function redactPlannerLogMessage(message: string, apiKey = ''): string {
  const redacted = apiKey ? message.split(apiKey).join('[已隐藏密钥]') : message
  return redacted.replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [已隐藏密钥]').slice(0, 1200)
}

export function appendPlannerLog(state: PlannerRunLogState, message: string, at: number, level: PlannerLogEntry['level'] = 'info'): PlannerRunLogState {
  return { ...state, nextId: state.nextId + 1, entries: [...state.entries, { id: state.nextId, at, message, level }].slice(-160) }
}

export function describePlannerProgress(progress: PlannerApiProgress, kind: NonNullable<PlannerRunLogState['kind']> = 'planner'): string {
  if (kind === 'analysis') return describePlannerProgress(progress, 'translation').split('翻译').join('分析').split('译文').join('分析内容')
  if (kind === 'translation') {
    switch (progress.phase) {
      case 'connecting': return `发送第 ${progress.attempt} 次翻译请求，等待接口响应（最多 ${progress.maxAttempts} 次）`
      case 'connected': return `接口已响应（HTTP ${progress.httpStatus ?? 200}），等待译文；字符数会在接口返回文本时更新`
      case 'thinking': return '模型正在处理翻译请求，尚未返回新的译文'
      case 'receiving': return `正在接收译文：已接收 ${(progress.receivedChars ?? 0).toLocaleString('zh-CN')} 个字符`
      case 'activity': return '接口仍在返回数据，连接保持活跃'
      case 'validating': return `译文接收结束，正在检查完整性：${(progress.receivedChars ?? 0).toLocaleString('zh-CN')} 个字符`
      case 'retrying': return `${progress.message || '接口暂时未完成响应'}；${(progress.retryDelayMs ?? 0) / 1000} 秒后重试（${progress.attempt}/${progress.maxAttempts}）`
      case 'fallback': return `${progress.message || '接口不支持流式'}；切换兼容模式重试（${progress.attempt}/${progress.maxAttempts}）`
    }
  }
  const stats = `已接收 ${(progress.receivedChars ?? 0).toLocaleString('zh-CN')} 个字符、${progress.completedPlans ?? 0}/${progress.totalPlans ?? 0} 份方案`
  switch (progress.phase) {
    case 'connecting': return `发送第 ${progress.attempt} 次策划请求，等待接口响应（最多 ${progress.maxAttempts} 次）`
    case 'connected': return `接口已响应（HTTP ${progress.httpStatus ?? 200}），等待 AI 策划内容`
    case 'thinking': return 'AI 正在分析产品与策划方案'
    case 'receiving': return `正在接收 AI 策划内容：${stats}`
    case 'activity': return '接口仍在返回数据，连接保持活跃'
    case 'validating': return `内容接收结束，正在校验方案完整性：${stats}`
    case 'retrying': return `${progress.message || '接口暂时未完成响应'}；${(progress.retryDelayMs ?? 0) / 1000} 秒后重试（${progress.attempt}/${progress.maxAttempts}）`
    case 'fallback': return `${progress.message || '接口不支持流式'}；切换兼容模式重试（${progress.attempt}/${progress.maxAttempts}）`
  }
}

export function updatePlannerRunLog(state: PlannerRunLogState, progress: PlannerApiProgress, at: number, apiKey = ''): PlannerRunLogState {
  if (state.status !== 'running') return state
  const next = { ...state }
  if (progress.phase === 'connecting') {
    next.receivedChars = 0
    next.completedPlans = 0
    next.lastContentAt = undefined
    next.lastActivityAt = undefined
  }
  if (progress.receivedChars !== undefined) next.receivedChars = progress.receivedChars
  if (progress.completedPlans !== undefined) next.completedPlans = progress.completedPlans
  if (progress.totalPlans !== undefined) next.totalPlans = progress.totalPlans
  next.attempt = progress.attempt
  if (['connected', 'thinking', 'receiving', 'activity'].includes(progress.phase)) next.lastActivityAt = at
  if (progress.phase === 'receiving') next.lastContentAt = at

  if (progress.phase === 'activity') {
    if (at - (state.lastActivityLogAt ?? state.startedAt ?? at) < 15_000) return next
    next.lastActivityLogAt = at
    return appendPlannerLog(next, describePlannerProgress(progress, state.kind), at)
  }
  const labels: Record<Exclude<PlannerApiProgress['phase'], 'activity'>, string> = {
    connecting: '正在等待接口响应…', connected: '接口已连接，等待 AI 返回内容…', thinking: 'AI 正在分析产品与方案…',
    receiving: '正在接收 AI 策划内容…', validating: '正在校验策划结果…', retrying: '接口暂时未完成响应，等待重试…', fallback: '正在切换兼容模式…',
  }
  const translationLabels: typeof labels = {
    connecting: '正在等待翻译接口响应…', connected: '接口已连接，等待译文…', thinking: '模型正在处理翻译请求…',
    receiving: '正在接收译文…', validating: '正在检查译文…', retrying: '翻译接口暂时未完成响应，等待重试…', fallback: '正在切换翻译兼容模式…',
  }
  next.label = (state.kind === 'translation' || state.kind === 'analysis' ? translationLabels : labels)[progress.phase]
  if (state.kind === 'analysis') next.label = next.label.split('翻译').join('分析').split('译文').join('分析内容')
  next.phase = progress.phase
  const phaseChanged = state.phase !== progress.phase || state.attempt !== progress.attempt
  if (progress.phase === 'receiving' && !phaseChanged && state.completedPlans === next.completedPlans && at - (state.lastReceivingLogAt ?? 0) < 5000) return next
  if (progress.phase === 'thinking' && !phaseChanged) return next
  if (progress.phase === 'receiving') next.lastReceivingLogAt = at
  const level = progress.phase === 'retrying' || progress.phase === 'fallback' ? 'warning' : 'info'
  return appendPlannerLog(next, redactPlannerLogMessage(describePlannerProgress(progress, state.kind), apiKey), at, level)
}

export function finishPlannerRunLog(state: PlannerRunLogState, status: 'success' | 'error' | 'stopped', message: string, at: number, apiKey = ''): PlannerRunLogState {
  if (state.status !== 'running') return state
  const labels = state.kind === 'analysis' ? { success: '分析已完成', error: '分析失败', stopped: '分析已停止' } : state.kind === 'translation'
    ? { success: '翻译已完成', error: '翻译失败', stopped: '翻译已停止' }
    : { success: 'AI 策划已完成', error: 'AI 策划失败', stopped: 'AI 策划已停止' }
  const next = { ...state, status, phase: status, label: labels[status], finishedAt: at }
  return appendPlannerLog(next, redactPlannerLogMessage(message, apiKey), at, status === 'stopped' ? 'warning' : status)
}

export function formatPlannerElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  return seconds < 60 ? `${seconds}秒` : `${Math.floor(seconds / 60)}分${seconds % 60}秒`
}

export function formatPlannerLogTime(at: number): string {
  return new Date(at).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function formatPlannerLogForCopy(state: PlannerRunLogState): string {
  return [state.kind === 'analysis' ? 'AI 分析运行日志' : state.kind === 'translation' ? 'AI 翻译运行日志' : 'AI 策划运行日志', ...state.entries.map((entry) => `[${formatPlannerLogTime(entry.at)} +${formatPlannerElapsed(entry.at - (state.startedAt ?? entry.at))}] ${entry.message}`)].join('\n')
}
