import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CategoryRulePreset, CategoryRuleSnapshot } from '../types'
import { BUILTIN_CATEGORY_RULES, categorySnapshot, createCategoryRule } from '../lib/categoryRules'
import { categoryRulePresetsDb } from '../lib/db'
import { localId } from '../lib/localId'
import { useStore } from '../store'
import { Sheet } from './Sheet'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { useModalFocus } from '../hooks/useModalFocus'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'

const BUTTON = 'rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs disabled:opacity-40 dark:border-white/10 dark:bg-gray-900'
const FIELD = 'mt-1 w-full rounded-lg border border-gray-200 bg-white p-2 text-sm dark:border-white/10 dark:bg-gray-950'
const STAGES = [['analysis', '商品事实分析'], ['listing', 'Listing 策划'], ['translation', '翻译术语与限制'], ['image', '附图生图'], ['aplus', 'A+ 策划与生图']] as const
export default function CategoryRuleModal({ current, onApply, onClose }: { current?: CategoryRuleSnapshot; onApply: (value?: CategoryRuleSnapshot) => Promise<void>; onClose: () => void }) {
  const saved = useStore((state) => state.categoryRulePresets)
  const [draft, setDraft] = useState(() => structuredClone(current?.preset ?? BUILTIN_CATEGORY_RULES[0]))
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...current?.values }))
  const [editingId, setEditingId] = useState(current?.preset.id.startsWith('builtin:') ? '' : current?.preset.id ?? '')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [deleting, setDeleting] = useState('')
  const panelRef = useRef<HTMLDivElement>(null), close = () => { if (!busy) onClose() }
  useCloseOnEscape(true, close); useModalFocus(true, panelRef); usePreventBackgroundScroll(true, panelRef)
  const attempt = async (work: () => Promise<void>) => { if (busy) return; setBusy(true); setError(''); try { await work() } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setBusy(false) } }
  const choose = (preset: CategoryRulePreset) => { setDraft(structuredClone(preset)); setValues(preset.id === current?.preset.id ? { ...current.values } : {}); setEditingId(preset.id.startsWith('builtin:') ? '' : preset.id); setError('') }
  const save = () => attempt(async () => {
    if (!editingId && saved.length >= 200) throw new Error('最多保存 200 个品类规则，请先整理')
    const existing = saved.find((row) => row.id === editingId)
    const preset = createCategoryRule(draft, existing)
    await categoryRulePresetsDb.put(preset)
    useStore.setState((state) => ({ categoryRulePresets: [preset, ...state.categoryRulePresets.filter((row) => row.id !== preset.id)] }))
    setDraft(preset); setEditingId(preset.id); useStore.getState().showToast('规则已保存；当前商品参数不会存入规则库', 'success')
  })
  return createPortal(<Sheet panelRef={panelRef} labelledBy="category-rule-title" onClose={close} rootClassName="z-[117]" className="flex max-h-[92dvh] max-w-5xl flex-col overflow-hidden pt-5">
    <div className="flex justify-between gap-3 border-b border-gray-100 p-4 dark:border-white/10"><div><h2 id="category-rule-title" className="font-semibold">商品品类规则</h2><p className="mt-1 text-xs text-gray-500">保存常用事实字段和内容要求。每个商品的参数独立填写，不会被模板预设成事实。</p></div><button type="button" className={BUTTON} disabled={busy} onClick={close}>关闭品类规则</button></div>
    <div className="min-h-0 overflow-y-auto p-4"><div className="grid gap-5 md:grid-cols-[240px_1fr]"><section className="space-y-2"><h3 className="text-sm font-semibold">内置规则</h3>{BUILTIN_CATEGORY_RULES.map((row) => <button key={row.id} type="button" disabled={busy} onClick={() => choose(row)} className={`${BUTTON} block w-full text-left`}>{row.title}</button>)}<h3 className="pt-4 text-sm font-semibold">我的规则 · {saved.length}</h3>{saved.map((row) => <article className="rounded-lg border border-gray-200 p-2 dark:border-white/10" key={row.id}><button type="button" disabled={busy} onClick={() => choose(row)} className="text-left text-sm">{row.title} · v{row.revision}</button><button type="button" className="ml-3 text-xs text-red-500" disabled={busy} onClick={() => setDeleting(row.id)}>删除</button>{deleting === row.id && <button type="button" className={`${BUTTON} mt-2`} disabled={busy} onClick={() => void attempt(async () => { await categoryRulePresetsDb.remove(row.id); useStore.setState((state) => ({ categoryRulePresets: state.categoryRulePresets.filter((item) => item.id !== row.id) })); setDeleting(''); if (editingId === row.id) setEditingId('') })}>确认删除此规则（历史策划不受影响）</button>}</article>)}</section>
      <fieldset disabled={busy} className="min-w-0 space-y-3 text-xs"><label className="block">规则名称<input aria-label="品类规则名称" maxLength={100} className={FIELD} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label><label className="block">用途说明<input aria-label="品类规则说明" maxLength={600} className={FIELD} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
      <h3 className="pt-2 text-sm font-semibold">事实字段与当前商品参数</h3><p className="text-gray-500">仅填写你核实过的内容；未知时留空或填“未确认”。必填只用于提醒填写，不代表已核实技术参数。</p>
      {draft.fields.map((field, index) => <div key={field.key} className="rounded-xl border border-gray-200 p-3 dark:border-white/10"><div className="flex items-center gap-2"><input aria-label={`事实字段名称 ${index + 1}`} className={FIELD} maxLength={100} value={field.label} onChange={(event) => setDraft({ ...draft, fields: draft.fields.map((row) => row.key === field.key ? { ...row, label: event.target.value } : row) })} /><label className="flex shrink-0 gap-1"><input type="checkbox" checked={field.required} onChange={(event) => setDraft({ ...draft, fields: draft.fields.map((row) => row.key === field.key ? { ...row, required: event.target.checked } : row) })} />必填</label><button type="button" className="text-red-500" aria-label={`删除字段 ${field.label}`} onClick={() => setDraft({ ...draft, fields: draft.fields.filter((row) => row.key !== field.key) })}>删除</button></div><textarea aria-label={`当前商品 ${field.label}`} rows={2} maxLength={1600} placeholder="当前商品的实际参数，不保存到规则模板" className={FIELD} value={values[field.key] ?? ''} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })} /></div>)}
      <button type="button" className={BUTTON} disabled={draft.fields.length >= 30} onClick={() => setDraft({ ...draft, fields: [...draft.fields, { key: localId('field'), label: '新事实字段', required: false }] })}>添加事实字段</button>
      {STAGES.map(([key, label]) => <label key={key} className="block">{label}<textarea aria-label={`品类规则 ${label}`} maxLength={2400} rows={3} className={FIELD} value={draft.instructions[key]} onChange={(event) => setDraft({ ...draft, instructions: { ...draft.instructions, [key]: event.target.value } })} /></label>)}
      </fieldset></div>{error && <p role="alert" className="mt-3 text-xs text-red-600">{error}</p>}
      <div className="sticky bottom-0 mt-4 flex flex-wrap gap-2 rounded-xl bg-white p-3 dark:bg-gray-900"><button type="button" disabled={busy} className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-40" onClick={() => void attempt(async () => { const normalized = createCategoryRule(draft); const preset = { ...normalized, id: draft.id, revision: draft.revision }; await onApply(categorySnapshot(preset, values)); onClose() })}>确认参数并应用到当前策划</button><button type="button" className={BUTTON} disabled={busy} onClick={() => void save()}>{editingId ? '更新规则库' : '保存为我的规则'}</button>{editingId && <button type="button" className={BUTTON} disabled={busy} onClick={() => setEditingId('')}>另存为新规则</button>}<button type="button" className={BUTTON} disabled={busy} onClick={() => void attempt(async () => { await onApply(undefined); onClose() })}>移除当前品类规则</button></div>
      <p className="mt-2 text-xs text-gray-500">应用会保存当前规则与参数快照。以后修改规则库不会改写旧策划；需要重新应用并更新受影响的方案。</p>
    </div>
  </Sheet>, document.body)
}
