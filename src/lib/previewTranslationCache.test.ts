import { describe, expect, it } from 'vitest'
import { createPreviewTranslationCache, TRANSLATION_CACHE_RETENTION_MS } from './previewTranslationCache'
import { createDefaultAmazonPlannerProfile } from './apiProfiles'

const profile = { ...createDefaultAmazonPlannerProfile(), baseUrl: 'https://planner.example/v1', model: 'planner-model', apiMode: 'chat' as const, apiKey: 'never-persist-this-key' }
const source = '## Prompt\nCreate a realistic product image.'
const text = '## 提示词\n创建写实的产品图片。'
const DAY = 24 * 60 * 60 * 1000
function fixture() {
  const data = new Map<string, string>()
  let time = DAY
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
    removeItem: (key: string) => { data.delete(key) },
  }
  const makeCache = () => createPreviewTranslationCache({ storage: () => storage, now: () => time })
  return { cache: makeCache(), makeCache, data, storage, advance: (duration: number) => { time += duration } }
}

describe('persistent preview translation cache', () => {
  it('reuses exact translations after a fresh cache instance and never persists the API key', () => {
    const f = fixture()
    expect(f.cache.put(source, profile, text)).toBe(true)
    expect(f.makeCache().get(source, profile)?.text).toBe(text)
    expect([...f.data.values()].join('')).not.toContain(profile.apiKey)
  })

  it('separates source, model, API endpoint, provider, protocol and target language', () => {
    const f = fixture()
    f.cache.put(source, profile, text)
    expect(f.cache.get(source + ' Changed.', profile)).toBeUndefined()
    expect(f.cache.get(source, { ...profile, model: 'another-model' })).toBeUndefined()
    expect(f.cache.get(source, { ...profile, baseUrl: 'https://other.example/v1' })).toBeUndefined()
    expect(f.cache.get(source, { ...profile, provider: 'fal' })).toBeUndefined()
    expect(f.cache.get(source, { ...profile, apiMode: 'responses' })).toBeUndefined()
    expect(f.cache.get(source, profile, { language: 'en' })).toBeUndefined()
    const updatedProfile = { ...profile, id: 'new-profile', apiKey: 'new-key', timeout: 300, baseUrl: profile.baseUrl + '/' }
    expect(f.cache.get(source, updatedProfile)?.text).toBe(text)
  })

  it('expires exactly 30 days after last use and touches the retention period on use', () => {
    const f = fixture()
    f.cache.put(source, profile, text)
    f.advance(29 * DAY)
    expect(f.cache.get(source, profile)?.text).toBe(text)
    f.advance(29 * DAY)
    expect(f.makeCache().get(source, profile, { touch: false })?.text).toBe(text)
    f.advance(DAY)
    expect(f.cache.get(source, profile)).toBeUndefined()
    expect(f.data.size).toBe(0)
  })

  it('does not extend retention for background lookups and cleans all expired entries on startup', () => {
    const f = fixture()
    f.cache.put(source, profile, text)
    f.cache.put('Other module', profile, '其他模块')
    f.advance(29 * DAY)
    f.cache.get(source, profile, { touch: false })
    f.advance(DAY)
    f.cache.cleanup()
    expect(f.data.size).toBe(0)
  })

  it('replaces only successful nonempty translations and leaves unrelated settings intact', () => {
    const f = fixture()
    f.data.set('application-settings', 'untouched')
    f.cache.put(source, profile, text)
    expect(f.cache.put(source, profile, ' ')).toBe(false)
    expect(f.cache.get(source, profile)?.text).toBe(text)
    f.cache.put(source, profile, '新的完整译文')
    expect(f.cache.get(source, profile)?.text).toBe('新的完整译文')
    f.cache.clear()
    expect([...f.data.entries()]).toEqual([['application-settings', 'untouched']])
  })

  it('tolerates disabled storage, malformed data and invalid or future timestamps', () => {
    const disabled = createPreviewTranslationCache({ storage: () => { throw new Error('disabled') } })
    expect(disabled.put(source, profile, text)).toBe(false)
    expect(disabled.get(source, profile)).toBeUndefined()
    expect(() => { disabled.cleanup(); disabled.clear() }).not.toThrow()
    const f = fixture()
    f.cache.put(source, profile, text)
    const key = [...f.data.keys()][0]!
    f.data.set(key, 'invalid JSON')
    f.cache.cleanup()
    expect(f.data.has(key)).toBe(false)
    f.data.set(key, JSON.stringify([{ identity: 'bad', text: '无效', createdAt: 1, lastUsedAt: 'yesterday' }]))
    expect(f.cache.get(source, profile)).toBeUndefined()
    expect(f.data.has(key)).toBe(false)
    f.cache.put(source, profile, text)
    f.advance(-DAY)
    expect(f.cache.get(source, profile)).toBeUndefined()
  })

  it('evicts the least recently used entries, including when browser quota is smaller', () => {
    const f = fixture()
    for (let i = 0; i < 100; i++) { f.cache.put(`Source ${i}`, profile, `译文 ${i}`); f.advance(1) }
    f.cache.get('Source 0', profile)
    f.advance(1)
    f.cache.put('New source', profile, '新译文')
    expect(f.cache.get('Source 1', profile)).toBeUndefined()
    expect(f.cache.get('Source 0', profile)?.text).toBe('译文 0')
    expect(f.cache.get('New source', profile)?.text).toBe('新译文')
    f.storage.setItem = (key, value) => {
      if (value.length > 700) throw new Error('quota exceeded')
      f.data.set(key, value)
    }
    f.advance(1)
    expect(f.cache.put(source, profile, text)).toBe(true)
    expect(f.cache.get(source, profile)?.text).toBe(text)
    expect(f.cache.get('Source 2', profile)).toBeUndefined()
  })

  it('keeps existing translations if an oversized or unavailable write fails', () => {
    const f = fixture()
    f.cache.put(source, profile, text)
    expect(f.cache.put('Large', profile, 'x'.repeat(2 * 1024 * 1024))).toBe(false)
    expect(f.cache.get(source, profile)?.text).toBe(text)
    f.storage.setItem = () => { throw new Error('quota exceeded') }
    expect(f.cache.put(source, profile, 'replacement')).toBe(false)
    expect(f.cache.get(source, profile)?.text).toBe(text)
  })
})
