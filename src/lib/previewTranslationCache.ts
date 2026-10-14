import type { ApiProfile } from '../types'

const STORAGE_KEY = 'amazon-image-studio-preview-translations:v1'
export const TRANSLATION_CACHE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const MAX_ENTRIES = 100
const MAX_BYTES = 2 * 1024 * 1024

type CacheProfile = Pick<ApiProfile, 'provider' | 'baseUrl' | 'apiMode' | 'model'>
type CacheStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export interface PreviewTranslation {
  identity: string
  text: string
  createdAt: number
  lastUsedAt: number
}

// Keep the exact source for collision-free matching. Credentials, timeouts and
// profile IDs are intentionally excluded: they do not change the translation.
function identity(source: string, profile: CacheProfile, language: string): string {
  return JSON.stringify([source, language, profile.provider, profile.baseUrl.trim().replace(/\/+$/, ''), profile.apiMode, profile.model.trim()])
}

function browserStorage(): CacheStorage | undefined {
  try { return window.localStorage } catch { return undefined }
}

export function createPreviewTranslationCache(options: { storage?: () => CacheStorage | undefined; now?: () => number } = {}) {
  const getStorage = options.storage ?? browserStorage
  const now = options.now ?? Date.now

  function read(): PreviewTranslation[] {
    try {
      const raw = getStorage()?.getItem(STORAGE_KEY)
      if (!raw) return []
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) { getStorage()?.removeItem(STORAGE_KEY); return [] }
      const at = now()
      const valid = parsed.filter((entry): entry is PreviewTranslation =>
        !!entry && typeof entry === 'object' && typeof entry.identity === 'string'
        && typeof entry.text === 'string' && !!entry.text.trim()
        && Number.isFinite(entry.createdAt) && entry.createdAt >= 0
        && Number.isFinite(entry.lastUsedAt) && entry.lastUsedAt >= entry.createdAt && entry.lastUsedAt <= at
        && at - entry.lastUsedAt < TRANSLATION_CACHE_RETENTION_MS,
      )
      if (valid.length !== parsed.length) write(valid)
      return valid
    } catch {
      try { getStorage()?.removeItem(STORAGE_KEY) } catch { /* Storage may be disabled. */ }
      return []
    }
  }

  function write(entries: PreviewTranslation[]): boolean {
    try {
      const storage = getStorage()
      if (!storage) return false
      const retained = [...entries].sort((a, b) => b.lastUsedAt - a.lastUsedAt).slice(0, MAX_ENTRIES)
      let serialized = JSON.stringify(retained)
      while (retained.length && serialized.length * 2 > MAX_BYTES) {
        retained.pop()
        serialized = JSON.stringify(retained)
      }
      // The browser may share its quota with other application settings. Evict
      // the least recently used translations, without touching those settings.
      while (retained.length) {
        try { storage.setItem(STORAGE_KEY, serialized); return true }
        catch { retained.pop(); serialized = JSON.stringify(retained) }
      }
      if (!entries.length) { storage.removeItem(STORAGE_KEY); return true }
      return false
    } catch { return false }
  }

  return {
    get(source: string, profile: CacheProfile, { touch = true, language = 'zh-CN' } = {}): PreviewTranslation | undefined {
      const entries = read()
      const entry = entries.find((entry) => entry.identity === identity(source, profile, language))
      if (!entry) return undefined
      if (touch) { entry.lastUsedAt = Math.max(now(), entry.lastUsedAt); write(entries) }
      return { ...entry }
    },
    put(source: string, profile: CacheProfile, text: string, language = 'zh-CN'): boolean {
      if (!source.trim() || !text.trim()) return false
      const key = identity(source, profile, language)
      const at = now()
      const entry = { identity: key, text, createdAt: at, lastUsedAt: at }
      // A single very large translation must not evict every existing entry.
      if (JSON.stringify([entry]).length * 2 > MAX_BYTES) return false
      return write([entry, ...read().filter((entry) => entry.identity !== key)])
    },
    cleanup() { read() },
    clear() { try { getStorage()?.removeItem(STORAGE_KEY) } catch { /* Storage may be disabled. */ } },
  }
}

export const previewTranslationCache = createPreviewTranslationCache()
