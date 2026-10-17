export default function ReferenceScopePicker({ value, slots, onChange, label, disabled = false }: {
  value: string[]; slots: Array<{ slot: string; label: string }>; onChange: (slots: string[]) => void; label: string; disabled?: boolean
}) {
  const options = [...slots, ...value.filter((slot) => !slots.some((row) => row.slot === slot)).map((slot) => ({ slot, label: '其他编排' }))]
  return <details className="mt-2 rounded-lg border border-gray-200 bg-white p-2 text-xs text-gray-600 dark:border-white/10 dark:bg-gray-950 dark:text-gray-300">
    <summary className="cursor-pointer" aria-label={label}>{value.length ? `适用于 ${value.join('、')}` : '适用于全部图片位'} · 可多选</summary>
    <fieldset disabled={disabled} aria-label={label} className="mt-2 grid gap-2"><label className="flex items-center gap-2"><input type="checkbox" aria-label={`${label}：全部图片位`} checked={!value.length} onChange={(event) => { if (event.target.checked) onChange([]) }} />全部图片位</label>
      {options.map((row) => <label key={row.slot} className="flex items-start gap-2"><input type="checkbox" aria-label={`${label}：${row.slot}`} checked={value.includes(row.slot)} onChange={(event) => onChange(event.target.checked ? [...value, row.slot] : value.filter((slot) => slot !== row.slot))} /><span>{row.slot} · {row.label}</span></label>)}
      {!value.length && <p className="text-[11px] text-gray-400">勾选具体图片位后，只在这些图片位使用。</p>}
    </fieldset>
  </details>
}
