import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PlannerModuleVersion } from '../types'
import type { PlannerRunLogState } from '../lib/plannerRunLog'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { useModalFocus } from '../hooks/useModalFocus'
import { Sheet } from './Sheet'
import PlannerRunLog from './PlannerRunLog'
import MarkdownRenderer from './MarkdownRenderer'
import { CloseIcon } from './icons'

const BUTTON = 'rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-white/[0.1] dark:bg-gray-900 dark:text-gray-200'

export default function PlannerModuleRevisionModal({ slot, versions, currentVersionId, busy, error, log, initialInstruction, onGenerate, onRestore, onStop, onClose, onCopyLog }: {
  slot: string; versions: PlannerModuleVersion[]; currentVersionId?: string; busy: boolean; error: string; log: PlannerRunLogState; initialInstruction: string
  onGenerate: (instruction: string) => void; onRestore: (version: PlannerModuleVersion) => void; onStop: () => void; onClose: () => void; onCopyLog: () => void
}) {
  const [instruction, setInstruction] = useState(initialInstruction)
  const [selectedId, setSelectedId] = useState(currentVersionId ?? versions[versions.length - 1]?.id)
  const panelRef = useRef<HTMLDivElement>(null)
  const close = () => { if (busy) onStop(); onClose() }
  useCloseOnEscape(true, close)
  usePreventBackgroundScroll(true, panelRef)
  useModalFocus(true, panelRef)
  useEffect(() => { setSelectedId(currentVersionId ?? versions[versions.length - 1]?.id) }, [currentVersionId, versions.length])
  const selected = versions.find((version) => version.id === selectedId)
  return createPortal(<Sheet onClose={close} panelRef={panelRef} rootClassName="z-[116]" labelledBy="planner-module-revision-title" className="flex max-h-[92dvh] max-w-4xl flex-col overflow-hidden pt-5">
    <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-white/[0.08]"><div><h2 id="planner-module-revision-title" className="text-base font-semibold text-gray-900 dark:text-gray-100">{slot} · 单图策划与版本</h2><p className="mt-1 text-xs text-gray-500">每次只重新策划此图片位，其他方案保持不变；成功结果会保存为新版本。</p></div><button type="button" onClick={close} aria-label="关闭单图策划" className={BUTTON}><CloseIcon className="h-4 w-4" /></button></div>
    <div className="custom-scrollbar min-h-0 overflow-y-auto p-4">
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">修改要求<textarea aria-label="单图重新策划要求" value={instruction} disabled={busy} onChange={(event) => setInstruction(event.target.value)} maxLength={6000} rows={3} placeholder="例如：保留卖点，换成更清楚的细节构图，减少图片内文字。" className="mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm dark:border-white/[0.1] dark:bg-gray-950 dark:text-gray-100" /></label>
      <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => onGenerate(instruction)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy ? '正在重新策划…' : error ? '重试此模块' : '重新策划此模块'}</button>{busy && <button type="button" onClick={onStop} className={BUTTON}>停止单图策划</button>}</div>
      <PlannerRunLog state={log} onCopy={onCopyLog} />
      {error && <p role="alert" className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-red-50 p-3 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4 dark:border-white/[0.08]"><span className="text-xs font-semibold text-gray-700 dark:text-gray-200">策划版本</span><select aria-label="单图策划版本" value={selectedId ?? ''} onChange={(event) => setSelectedId(event.target.value)} className={BUTTON}>{[...versions].reverse().map((version) => <option key={version.id} value={version.id}>v{version.versionNumber}{version.id === currentVersionId ? ' · 当前生效' : ''} · {new Date(version.createdAt).toLocaleString('zh-CN')}</option>)}</select><button type="button" disabled={busy || !selected || selected.id === currentVersionId} onClick={() => selected && onRestore(selected)} className={BUTTON}>恢复此策划版本</button></div>
      {selected && <div className="mt-3 rounded-xl bg-gray-50 p-4 dark:bg-gray-950"><p className="mb-3 text-[11px] text-gray-500">{selected.instruction || '初始策划版本'}</p><MarkdownRenderer key={selected.id} content={selected.plan.planMarkdown} className="text-sm text-gray-700 dark:text-gray-200" /><details className="mt-3 text-xs text-gray-500"><summary className="cursor-pointer">查看提示词</summary><pre className="mt-2 whitespace-pre-wrap break-words">{selected.plan.prompt}{'\n\nNegative prompt:\n'}{selected.plan.negativePrompt}</pre></details></div>}
    </div>
  </Sheet>, document.body)
}
