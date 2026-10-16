import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PlannerModuleVersion } from '../types'
import type { PlannerRunLogState } from '../lib/plannerRunLog'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { useModalFocus } from '../hooks/useModalFocus'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import PlannerRunLog from './PlannerRunLog'
import MarkdownRenderer from './MarkdownRenderer'
import { Sheet } from './Sheet'

const BUTTON = 'rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 disabled:opacity-40 dark:border-white/10 dark:text-gray-200'
export default function PlannerCreativeModal({ slot, versions, activeVersionId, busy, error, log, onGenerate, onUse, onStop, onCopyLog, onClose }: {
  slot: string; versions: PlannerModuleVersion[]; activeVersionId?: string; busy: boolean; error: string; log: PlannerRunLogState
  onGenerate: (count: 2 | 3, instruction: string) => void; onUse: (version: PlannerModuleVersion) => void; onStop: () => void; onCopyLog: () => void; onClose: () => void
}) {
  const [count, setCount] = useState<2 | 3>(3), [instruction, setInstruction] = useState(''), [groupId, setGroupId] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
  const close = () => { if (busy) onStop(); onClose() }
  useCloseOnEscape(true, close); useModalFocus(true, panelRef); usePreventBackgroundScroll(true, panelRef)
  const groups = [...new Map([...versions].reverse().filter((version) => version.creative).map((version) => [version.creative!.groupId, version])).values()]
  const selectedGroup = groupId || groups[0]?.creative?.groupId
  const shown = versions.filter((version) => version.creative && version.creative.groupId === selectedGroup)
  return createPortal(<Sheet onClose={close} panelRef={panelRef} labelledBy="planner-creative-title" rootClassName="z-[117]" className="flex max-h-[92dvh] max-w-5xl flex-col overflow-hidden pt-5">
    <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-white/10"><div><h2 id="planner-creative-title" className="text-base font-semibold text-gray-900 dark:text-gray-100">{slot} · 创意方向</h2><p className="mt-1 text-xs text-gray-500">先策划 2–3 个方向，再选择采用；此步骤只调用策划模型。色彩与光影沿用当前风格，商品事实保持不变。</p></div><button type="button" className={`${BUTTON} shrink-0`} onClick={close}>关闭创意方向</button></div>
    <div className="custom-scrollbar min-h-0 overflow-y-auto p-4"><label className="block text-xs text-gray-600 dark:text-gray-300">希望探索的方向<textarea aria-label="创意方向要求" disabled={busy} value={instruction} maxLength={6000} onChange={(event) => setInstruction(event.target.value)} rows={3} placeholder="例如：更换使用场景，分别探索桌面阅读、床头和局部细节，商品保持一致。" className="mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm dark:border-white/10 dark:bg-gray-950" /></label><div className="mt-3 flex flex-wrap items-center gap-2"><label className="text-xs text-gray-500">方向数量 <select aria-label="创意方向数量" className={BUTTON} value={count} disabled={busy} onChange={(event) => setCount(event.target.value === '2' ? 2 : 3)}><option value="2">2 个</option><option value="3">3 个</option></select></label><button type="button" disabled={busy} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40" onClick={() => { setGroupId(''); onGenerate(count, instruction) }}>{busy ? '正在策划创意…' : '策划多个方向'}</button>{busy && <button type="button" className={BUTTON} onClick={onStop}>停止创意策划</button>}</div>
      <PlannerRunLog state={log} onCopy={onCopyLog} />{error && <p role="alert" className="mt-3 whitespace-pre-wrap break-words text-xs text-red-600 dark:text-red-300">{error}</p>}
      {!!groups.length && <label className="mt-4 block text-xs text-gray-500">已保存的创意批次<select aria-label="创意策划批次" value={selectedGroup ?? ''} className={`${BUTTON} ml-2 max-w-full`} onChange={(event) => setGroupId(event.target.value)}>{groups.map((version) => <option key={version.creative!.groupId} value={version.creative!.groupId}>{new Date(version.createdAt).toLocaleString('zh-CN')}</option>)}</select></label>}
      <div className="mt-4 grid gap-3 md:grid-cols-2">{shown.map((version) => <article key={version.id} className="rounded-xl border border-gray-200 p-4 text-gray-700 dark:border-white/10 dark:text-gray-200"><h3 className="text-sm font-semibold">{version.creative!.title} · v{version.versionNumber}{activeVersionId === version.id ? ' · 当前采用' : ''}</h3><p className="mt-2 text-xs text-gray-500">{version.creative!.summary}</p><details className="mt-3 text-xs"><summary className="cursor-pointer">查看完整策划与提示词</summary><MarkdownRenderer content={version.plan.planMarkdown} className="mt-3 text-xs" /><pre className="mt-3 whitespace-pre-wrap break-words">{version.plan.prompt}</pre></details><button type="button" disabled={busy || activeVersionId === version.id} className={`${BUTTON} mt-3`} onClick={() => onUse(version)}>采用此方向</button></article>)}</div>
      {!shown.length && <p className="mt-5 text-xs text-gray-500">成功的方向会保存为此图片位的独立策划版本；选择采用后，再从首页生成或加入队列。</p>}
    </div>
  </Sheet>, document.body)
}
