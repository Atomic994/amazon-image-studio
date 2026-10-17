import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AmazonPlannerSession, PlannerThemePreset } from '../types'
import { BUILTIN_PLANNER_THEMES, createPlannerThemePreset, normalizePlannerTheme } from '../lib/plannerThemes'
import { plannerThemePresetsDb } from '../lib/db'
import { useStore } from '../store'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { useModalFocus } from '../hooks/useModalFocus'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { Sheet } from './Sheet'
import PlannerThemeHistory from './PlannerThemeHistory'

const BUTTON = 'rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 disabled:opacity-40 dark:border-white/10 dark:bg-gray-900 dark:text-gray-200'
const FIELD = 'mt-1 w-full rounded-lg border border-gray-200 bg-white p-2 text-sm dark:border-white/10 dark:bg-gray-950 dark:text-gray-100'
export type AppliedPlannerTheme = Pick<PlannerThemePreset, 'scene' | 'themeSettings' | 'density'>
export default function PlannerThemeModal({ session, onApply, onClose }: { session: AmazonPlannerSession; onApply: (preset: AppliedPlannerTheme) => Promise<void>; onClose: () => void }) {
  const saved = useStore((state) => state.plannerThemePresets)
  const [draft, setDraft] = useState(() => createPlannerThemePreset({ title: '我的主题', scene: session.draft.scene, themeSettings: session.themeSettings, density: session.styleDensityMode }))
  const [editingId, setEditingId] = useState(''), [query, setQuery] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [deleting, setDeleting] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
  const close = () => { if (!busy) onClose() }
  useCloseOnEscape(true, close); useModalFocus(true, panelRef); usePreventBackgroundScroll(true, panelRef)
  const attempt = async (work: () => Promise<void>) => { if (busy) return; setBusy(true); setError(''); try { await work() } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setBusy(false) } }
  const choose = (preset: PlannerThemePreset) => { setDraft(structuredClone(preset)); setEditingId(preset.id.startsWith('builtin:') ? '' : preset.id); setError(''); setDeleting('') }
  const save = () => attempt(async () => {
    if (!editingId && saved.length >= 200) throw new Error('已保存 200 套预设，请先整理不再使用的预设')
    const previous = saved.find((item) => item.id === editingId)
    const latest = editingId ? (await plannerThemePresetsDb.getAll()).find((item) => item.id === editingId) : undefined
    if (editingId && (!latest || latest.updatedAt !== previous?.updatedAt)) throw new Error('此预设已在另一处变化，请重新载入后保存')
    const preset = createPlannerThemePreset(draft, latest)
    await plannerThemePresetsDb.put(preset)
    useStore.setState((state) => ({ plannerThemePresets: [preset, ...state.plannerThemePresets.filter((item) => item.id !== preset.id)] }))
    setEditingId(preset.id); setDraft(preset); useStore.getState().showToast('主题预设已保存到本地', 'success')
  })
  const shown = [...saved].sort((a, b) => b.updatedAt - a.updatedAt).filter((item) => !query.trim() || [item.title, item.description, item.scene].join(' ').toLowerCase().includes(query.trim().toLowerCase()))
  return createPortal(<Sheet panelRef={panelRef} onClose={close} labelledBy="planner-theme-title" rootClassName="z-[117]" className="flex max-h-[92dvh] max-w-5xl flex-col overflow-hidden pt-5">
    <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-white/10"><div><h2 id="planner-theme-title" className="font-semibold text-gray-900 dark:text-gray-100">主题和场景预设</h2><p className="mt-1 text-xs text-gray-500">用于附图与 A+ 的创意要求。配色由视觉风格控制；MAIN 继续使用白底商品图。</p></div><button className={BUTTON} type="button" disabled={busy} onClick={close}>关闭主题预设</button></div>
    <div className="custom-scrollbar min-h-0 overflow-y-auto p-4"><div className="grid gap-5 md:grid-cols-2"><section><h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">内置预设</h3><div className="mt-2 grid grid-cols-2 gap-2">{BUILTIN_PLANNER_THEMES.map((preset) => <button type="button" disabled={busy} key={preset.id} aria-label={`载入主题 ${preset.title}`} onClick={() => choose(preset)} className={`${BUTTON} text-left`}><span className="block font-semibold">{preset.title}</span><span className="mt-1 block text-[11px] text-gray-500">{preset.description}</span></button>)}</div>
      <h3 className="mt-5 text-sm font-semibold text-gray-700 dark:text-gray-200">我的预设 · {saved.length}</h3><input aria-label="搜索主题预设" placeholder="搜索名称、说明或场景" value={query} onChange={(event) => setQuery(event.target.value)} className={FIELD} />
      <div className="mt-2 space-y-2">{shown.map((preset) => <article key={preset.id} className="rounded-xl border border-gray-200 p-3 dark:border-white/10"><button type="button" disabled={busy} aria-label={`载入主题 ${preset.title}`} className="w-full text-left text-sm font-semibold text-gray-800 dark:text-gray-200" onClick={() => choose(preset)}>{preset.title}</button><p className="mt-1 text-xs text-gray-500">{preset.description || preset.scene || '自定义主题要求'}</p><button type="button" disabled={busy} className="mt-2 text-xs text-red-500" onClick={() => setDeleting(preset.id)}>删除预设</button>{deleting === preset.id && <div className="mt-2 text-xs text-gray-500">只移除此预设，已保存的策划不受影响。<button type="button" className={`${BUTTON} ml-2`} disabled={busy} onClick={() => void attempt(async () => { await plannerThemePresetsDb.remove(preset.id); useStore.setState((state) => ({ plannerThemePresets: state.plannerThemePresets.filter((item) => item.id !== preset.id) })); if (editingId === preset.id) setEditingId(''); setDeleting('') })}>确认删除预设</button></div>}</article>)}{!shown.length && <p className="py-4 text-xs text-gray-500">{saved.length ? '没有匹配的预设' : '可从右侧保存当前设置，供其他商品复用。'}</p>}</div>
    </section><fieldset disabled={busy} className="space-y-3 text-xs text-gray-600 dark:text-gray-300"><label className="block">预设名称<input aria-label="主题预设名称" maxLength={100} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} className={FIELD} /></label><label className="block">用途说明<input aria-label="主题预设说明" maxLength={600} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} className={FIELD} /></label>
      <label className="block">场景 / 构图<textarea aria-label="预设场景" rows={3} maxLength={2400} value={draft.scene} onChange={(event) => setDraft({ ...draft, scene: event.target.value })} className={FIELD} /></label>
      {([['theme', '主题方向'], ['composition', '画面布局'], ['lighting', '光线要求'], ['constraints', '额外限制']] as const).map(([key, label]) => <label key={key} className="block">{label}<textarea aria-label={label} rows={2} maxLength={2400} value={draft.themeSettings[key]} onChange={(event) => setDraft({ ...draft, themeSettings: { ...draft.themeSettings, [key]: event.target.value } })} className={FIELD} /></label>)}
      <label className="block">信息密度<select aria-label="预设信息密度" value={draft.density} onChange={(event) => setDraft({ ...draft, density: event.target.value === 'minimal' ? 'minimal' : 'rich' })} className={FIELD}><option value="rich">信息丰富</option><option value="minimal">简约</option></select></label>
    </fieldset></div>
      <PlannerThemeHistory key={editingId} preset={saved.find((item) => item.id === editingId)} disabled={busy} onRestored={choose} onBusy={setBusy} />
      <p className="mt-4 text-xs text-gray-500">保存内容仅包含主题、场景、光线、布局及密度，不包含商品事实、Listing、参考图片或 API 配置。每次修改保存为新版本，历史版本可以比较和恢复。应用后会提示哪些已有方案需要复核，并将新要求用于后续策划和生图。</p>
      {error && <p role="alert" className="mt-3 text-xs text-red-600">{error}</p>}
      <div className="sticky bottom-0 mt-4 flex flex-wrap gap-2 rounded-xl bg-white/95 p-3 dark:bg-gray-900/95"><button type="button" disabled={busy} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40" onClick={() => void attempt(async () => { await onApply(draft); onClose() })}>{busy ? '正在处理…' : '应用到当前策划'}</button><button type="button" disabled={busy || !draft.title.trim()} className={BUTTON} onClick={() => void save()}>{editingId ? '更新此预设' : '保存为我的预设'}</button>{editingId && <button type="button" disabled={busy} className={BUTTON} onClick={() => setEditingId('')}>另存为新预设</button>}<button type="button" disabled={busy} className={BUTTON} onClick={() => void attempt(async () => { await onApply({ scene: '', themeSettings: normalizePlannerTheme(), density: session.styleDensityMode ?? 'rich' }); onClose() })}>清除当前主题和场景</button></div>
    </div>
  </Sheet>, document.body)
}
