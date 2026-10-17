import { useEffect, useState } from 'react'
import { ensureImageCached, getCachedImage } from '../store'

export function useStoredImageUrls(ids: string[]) {
  const key = JSON.stringify([...new Set(ids.filter(Boolean))])
  const [urls, setUrls] = useState<Record<string, string>>({})
  useEffect(() => {
    let active = true
    const unique = JSON.parse(key) as string[]
    setUrls(Object.fromEntries(unique.flatMap((id) => { const url = getCachedImage(id); return url ? [[id, url]] : [] })))
    void Promise.all(unique.map(async (id) => { try { return [id, await ensureImageCached(id)] as const } catch { return [id, null] as const } })).then((rows) => {
      if (active) setUrls(Object.fromEntries(rows.filter((row): row is readonly [string, string] => !!row[1])))
    })
    return () => { active = false }
  }, [key])
  return urls
}
