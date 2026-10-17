import { useState } from 'react'
import type { PlannerThemePreset, PlannerThemeContent } from '../types'
import { createPlannerThemePreset, plannerThemeVersions } from '../lib/plannerThemes'
import { plannerThemePresetsDb } from '../lib/db'
import { useStore } from '../store'

const describe = (content: PlannerThemeContent) => [content.title, content.description, `场景：${content.scene}`, `主题：${content.themeSettings.theme}`, `布局：${content.themeSettings.composition}`, `光线：${content.themeSettings.lighting}`, `限制：${content.themeSettings.constraints}`, `密度：${content.density === 'rich' ? '信息丰富' : '简约'}`].join('\n')
export default function PlannerThemeHistory({ preset, disabled, onRestored, onBusy }: { preset?: PlannerThemePreset; disabled: boolean; onRestored: (preset: PlannerThemePreset) => void; onBusy: (busy: boolean) => void }) {
  const [selectedId, setSelectedId] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  if (!preset) return null
  const versions = plannerThemeVersions(preset), selected = versions.find((row) => row.id === selectedId) ?? versions[versions.length - 1]
  const same = describe(preset) === describe(selected.content)
  const restore = async () => {
    setBusy(true); onBusy(true); setError('')
    try {
      // Resolve latest storage record so another tab cannot silently drop newer revisions.
      const latest = (await plannerThemePresetsDb.getAll()).find((row) => row.id === preset.id)
      if (!latest || latest.updatedAt !== preset.updatedAt) throw new Error('此预设已在另一处变化，请重新载入后恢复')
      const restored = createPlannerThemePreset(selected.content, latest, `恢复自 v${selected.versionNumber}`)
      await plannerThemePresetsDb.put(restored)
      useStore.setState((state) => ({ plannerThemePresets: state.plannerThemePresets.map((row) => row.id === restored.id ? restored : row) }))
      onRestored(restored); setSelectedId('')
      useStore.getState().showToast('已恢复并保存为新版本；原有版本仍保留', 'success')
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setBusy(false); onBusy(false) }
  }
  return <details className="mt-4 rounded-xl border border-gray-200 p-3 dark:border-white/10"><summary className="cursor-pointer text-sm font-semibold">预设版本记录 · {versions.length} 版</summary>
    <select aria-label="选择主题历史版本" value={selected.id} disabled={disabled || busy} onChange={(event) => setSelectedId(event.target.value)} className="my-3 w-full rounded-lg border bg-white p-2 text-sm dark:bg-gray-950">{[...versions].reverse().map((row) => <option key={row.id} value={row.id}>v{row.versionNumber} · {new Date(row.createdAt).toLocaleString()} · {row.note}</option>)}</select>
    <div className="grid gap-3 md:grid-cols-2">{[['当前保存内容', describe(preset)], [`所选 v${selected.versionNumber}`, describe(selected.content)]].map(([title, text]) => <div key={title}><h4 className="text-xs font-semibold">{title}</h4><pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-xs dark:bg-gray-950">{text}</pre></div>)}</div>
    <button type="button" disabled={same || disabled || busy} onClick={() => void restore()} className="mt-3 rounded-lg bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-40">{same ? '当前内容与此版本一致' : '恢复此版并保存新版本'}</button>
    <p className="mt-2 text-xs text-gray-500">恢复只更新预设库。需要点击“应用到当前策划”，已有策划才会采用恢复后的内容。</p>{error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
  </details>
}
