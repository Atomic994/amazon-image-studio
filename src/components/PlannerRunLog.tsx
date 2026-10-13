import { useEffect, useId, useRef, useState } from 'react'
import { formatPlannerElapsed, formatPlannerLogTime, type PlannerRunLogState } from '../lib/plannerRunLog'

export default function PlannerRunLog({ state, onCopy }: { state: PlannerRunLogState; onCopy: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [now, setNow] = useState(Date.now)
  const panelId = useId()
  const scrollRef = useRef<HTMLDivElement>(null)
  const followRef = useRef(true)
  useEffect(() => {
    if (state.status !== 'running') return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [state.status, state.startedAt])
  useEffect(() => {
    const panel = scrollRef.current
    if (expanded && panel && followRef.current) panel.scrollTop = panel.scrollHeight
  }, [expanded, state.entries])
  const elapsed = state.startedAt === undefined ? null : formatPlannerElapsed((state.finishedAt ?? now) - state.startedAt)
  const recentData = state.lastActivityAt === undefined ? null : formatPlannerElapsed(now - state.lastActivityAt)
  return (
    <div className="mt-3 text-xs leading-relaxed text-[hsl(var(--primary))]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div role="status" aria-live="polite" className="font-medium">{state.label}</div>
          {elapsed && (
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-500 dark:text-gray-400">
              <span>已用时 {elapsed}</span>
              <span>已接收 {state.receivedChars.toLocaleString('zh-CN')} 个字符</span>
              <span>已接收方案 {state.completedPlans}/{state.totalPlans}</span>
              {state.status === 'running' && <span>{recentData ? `最近数据：${recentData}前` : '等待接口返回数据'}</span>}
            </div>
          )}
        </div>
        <button type="button" aria-expanded={expanded} aria-controls={panelId}
          onClick={() => { followRef.current = true; setExpanded(!expanded) }}
          className="ios-button ios-button-plain shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold">
          {expanded ? '收起日志' : '查看日志'}
        </button>
      </div>
      <div id={panelId} hidden={!expanded} className="mt-2 rounded-xl border border-gray-200 bg-white/80 p-3 text-gray-700 dark:border-white/[0.10] dark:bg-gray-900/70 dark:text-gray-200">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="font-semibold">策划运行日志</span>
          <button type="button" onClick={onCopy} disabled={!state.entries.length} className="rounded-md px-2 py-1 text-[11px] font-medium text-[hsl(var(--primary))] hover:bg-[hsl(var(--ios-blue-tint))] disabled:opacity-40">复制日志</button>
        </div>
        <div ref={scrollRef} role="log" aria-label="AI 策划运行日志" aria-live="off"
          onScroll={(event) => { const panel = event.currentTarget; followRef.current = panel.scrollHeight - panel.scrollTop - panel.clientHeight < 32 }}
          className="max-h-60 space-y-2 overflow-y-auto overscroll-contain custom-scrollbar">
          {state.entries.length ? state.entries.map((entry) => (
            <div key={entry.id} className="flex items-start gap-2 text-[11px]">
              <time dateTime={new Date(entry.at).toISOString()} title={`已用时 ${formatPlannerElapsed(entry.at - (state.startedAt ?? entry.at))}`} className="shrink-0 pt-px font-mono text-gray-400">{formatPlannerLogTime(entry.at)}</time>
              <span className={`min-w-0 whitespace-pre-wrap break-words ${entry.level === 'error' ? 'text-red-600 dark:text-red-300' : entry.level === 'warning' ? 'text-amber-700 dark:text-amber-300' : entry.level === 'success' ? 'text-emerald-700 dark:text-emerald-300' : ''}`}>{entry.message}</span>
            </div>
          )) : <p className="text-gray-500">开始 AI 策划后，这里会显示准备、等待、接收、重试和完成记录。</p>}
        </div>
        {state.status === 'running' && state.lastContentAt !== undefined && <p className="mt-2 text-[10px] text-gray-400">最近一次策划内容更新：{formatPlannerElapsed(now - state.lastContentAt)}前</p>}
      </div>
    </div>
  )
}
