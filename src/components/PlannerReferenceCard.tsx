import type { InputImage, ReferenceImageUsage } from '../types'
import { normalizeReferenceUsage, REFERENCE_PURPOSE_LABELS } from '../lib/referenceImageUsage'

export default function PlannerReferenceCard({ image, index, usage: rawUsage, slots, onChange, onRemove, onPreview, onAnalyze, hasAnalysis }: {
  image: InputImage; index: number; usage?: ReferenceImageUsage; slots: Array<{ slot: string; label: string }>
  onAnalyze?: () => void; hasAnalysis?: boolean
  onChange: (usage: Partial<ReferenceImageUsage>) => void; onRemove: () => void; onPreview: () => void
}) {
  const usage = normalizeReferenceUsage(rawUsage)
  return <div className="min-w-0 overflow-hidden rounded-xl border border-gray-200 bg-white p-2 dark:border-white/[0.1] dark:bg-gray-900">
    <div className="flex gap-2"><button type="button" onClick={onPreview} className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-gray-100" aria-label={`查看参考图 ${index + 1}`}><img src={image.dataUrl} alt={`参考图 ${index + 1}`} className="h-full w-full object-cover" /></button><div className="min-w-0 flex-1"><div className="mb-1 flex items-center justify-between text-[11px] text-gray-500"><span>参考图 {index + 1}</span><button type="button" onClick={onRemove} aria-label={`删除参考图 ${index + 1}`} className="rounded px-1.5 text-red-500 hover:bg-red-50">删除</button></div><select aria-label={`参考图 ${index + 1} 用途`} value={usage.purpose} onChange={(event) => onChange({ purpose: event.target.value as ReferenceImageUsage['purpose'] })} className="w-full rounded-lg border border-gray-200 bg-white p-1.5 text-xs text-gray-700 dark:border-white/[0.1] dark:bg-gray-950 dark:text-gray-200">{Object.entries(REFERENCE_PURPOSE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div></div>
    <select aria-label={`参考图 ${index + 1} 适用图片位`} value={usage.slots[0] ?? ''} onChange={(event) => onChange({ slots: event.target.value ? [event.target.value] : [] })} className="mt-2 w-full rounded-lg border border-gray-200 bg-white p-1.5 text-xs text-gray-600 dark:border-white/[0.1] dark:bg-gray-950 dark:text-gray-300"><option value="">适用于全部图片</option>{usage.slots[0] && !slots.some((item) => item.slot === usage.slots[0]) && <option value={usage.slots[0]}>{usage.slots[0]}（其他编排）</option>}{slots.map((item) => <option key={item.slot} value={item.slot}>仅 {item.slot} · {item.label}</option>)}</select>
    <input aria-label={`参考图 ${index + 1} 使用说明`} maxLength={1000} value={usage.note} onChange={(event) => onChange({ note: event.target.value })} placeholder="可选：说明需要参考的细节" className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs dark:border-white/[0.1] dark:bg-gray-950 dark:text-gray-200" />
    {onAnalyze && <button type="button" aria-label={`分析参考图 ${index + 1}`} onClick={onAnalyze} className="mt-2 w-full rounded-lg bg-blue-50 px-2 py-1.5 text-xs font-semibold text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">{hasAnalysis ? '查看分析 / 缓存' : '分析参考图'}</button>}
  </div>
}
