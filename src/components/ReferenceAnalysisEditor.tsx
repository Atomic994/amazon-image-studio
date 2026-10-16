import { useEffect, useState } from 'react'
import type { ReferenceAnalysisSnapshot } from '../types'
import { ANALYSIS_LIST_FIELDS, effectiveReferenceAnalysis, normalizeReferenceAnalysis, reviseReferenceAnalysis } from '../lib/referenceAnalysis'

const BUTTON = 'rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium disabled:opacity-40 dark:border-white/10'
const FIELD = 'mt-1 w-full rounded-lg border border-gray-200 bg-white p-2 text-xs dark:border-white/10 dark:bg-gray-950'
export default function ReferenceAnalysisEditor({ snapshot, disabled, onSave }: { snapshot: ReferenceAnalysisSnapshot; disabled: boolean; onSave: (snapshot: ReferenceAnalysisSnapshot) => Promise<void> }) {
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(() => effectiveReferenceAnalysis(snapshot)), [note, setNote] = useState('')
  const [saving, setSaving] = useState(false), [error, setError] = useState('')
  useEffect(() => { setEditing(false); setDraft(effectiveReferenceAnalysis(snapshot)); setNote(''); setError('') }, [snapshot.id, snapshot.createdAt, snapshot.selectedRevisionId])
  const commit = async (value: ReferenceAnalysisSnapshot) => {
    setSaving(true); setError('')
    try { await onSave(value); setEditing(false) } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setSaving(false) }
  }
  const selected = snapshot.revisions?.find((revision) => revision.id === snapshot.selectedRevisionId)
  return <div className="mt-4 rounded-xl border border-gray-200 p-3 text-gray-700 dark:border-white/10 dark:text-gray-200">
    <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold">分析版本</span><select aria-label="参考图分析版本" disabled={disabled || saving} value={snapshot.selectedRevisionId ?? ''} className={`${FIELD} mt-0 min-w-0 flex-1`} onChange={(event) => void commit({ ...snapshot, selectedRevisionId: event.target.value || undefined })}><option value="">当前 AI 原始分析</option>{[...(snapshot.revisions ?? [])].reverse().map((revision) => <option value={revision.id} key={revision.id}>v{revision.versionNumber} · {revision.source === 'manual' ? '人工修订' : '历史 AI 分析'} · {revision.note || new Date(revision.createdAt).toLocaleString('zh-CN')}</option>)}</select><button type="button" disabled={disabled || saving} className={BUTTON} onClick={() => { setDraft(effectiveReferenceAnalysis(snapshot)); setEditing(!editing) }}>{editing ? '取消修订' : '修正分析'}</button></div>
    <p className="mt-2 text-[11px] text-gray-500">{selected ? `当前采用 v${selected.versionNumber} ${selected.source === 'manual' ? '人工修订' : '历史 AI 分析'}` : '当前采用 AI 原始分析'}。人工修订随策划和图库保存，不写入自动分析缓存。</p>
    {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
    {editing && <div className="mt-3 space-y-3"><label className="block text-xs">分析摘要<textarea aria-label="修订分析摘要" rows={3} value={draft.summary} maxLength={2000} disabled={saving} className={FIELD} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} /></label><div className="grid gap-3 sm:grid-cols-2">{ANALYSIS_LIST_FIELDS.map(([key, label]) => <label key={key} className="text-xs">{label}<textarea aria-label={`修订分析：${label}`} rows={3} value={draft[key].join('\n')} disabled={saving} className={FIELD} onChange={(event) => setDraft({ ...draft, [key]: event.target.value.split('\n') })} /></label>)}</div><label className="block text-xs">修订说明<input aria-label="分析修订说明" value={note} maxLength={1000} className={FIELD} onChange={(event) => setNote(event.target.value)} /></label><button type="button" disabled={saving || !draft.summary.trim()} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40" onClick={() => void commit(reviseReferenceAnalysis(snapshot, normalizeReferenceAnalysis(draft), note))}>{saving ? '正在保存…' : '保存分析修订版'}</button></div>}
  </div>
}
