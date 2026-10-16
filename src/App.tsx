import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { initStore } from './store'
import { useStore } from './store'
import { buildSettingsFromUrlParams, clearUrlSettingParams, hasUrlSettingParams } from './lib/urlSettings'
import { useDockerApiUrlMigrationNotice } from './hooks/useDockerApiUrlMigrationNotice'
import Header from './components/Header'
import AmazonPlanner from './components/AmazonPlanner'
import ImageEditorPage from './components/ImageEditorPage'
import SyntheticPerformerTaggerPage from './components/SyntheticPerformerTaggerPage'
import SearchBar from './components/SearchBar'
import TaskGrid from './components/TaskGrid'
import InputBar from './components/InputBar'
import DetailModal from './components/DetailModal'
import Lightbox from './components/Lightbox'
import SettingsModal from './components/SettingsModal'
import ConfirmDialog from './components/ConfirmDialog'
import Toast from './components/Toast'
import MaskEditorModal from './components/MaskEditorModal'
import ImageContextMenu from './components/ImageContextMenu'
import { useGlobalClickSuppression } from './lib/clickSuppression'
import { previewTranslationCache } from './lib/previewTranslationCache'
import ImageVersionReviewModal from './components/ImageVersionReviewModal'
import MaterialLibraryModal from './components/MaterialLibraryModal'
import GenerationQueueModal from './components/GenerationQueueModal'
import { startGenerationQueueRunner } from './lib/generationQueueRunner'

export type AppView = 'home' | 'editor' | 'tagger'

function getAppViewFromHash(): AppView {
  const route = window.location.hash.replace(/^#\/?/, '')
  if (route === 'editor' || route === 'seedream-pro') return 'editor'
  if (route === 'tagger') return 'tagger'
  return 'home'
}

export default function App() {
  useEffect(() => startGenerationQueueRunner(), [])
  const setSettings = useStore((s) => s.setSettings)
  const plannerRestoreRequest = useStore((s) => s.plannerRestoreRequest)
  const [view, setView] = useState<AppView>(getAppViewFromHash)
  const currentView = useRef(view)
  const scrollPositions = useRef<Record<AppView, number>>({ home: 0, editor: 0, tagger: 0 })
  const mounted = useRef(false)
  const changeView = useCallback((next: AppView) => {
    if (currentView.current === next) return
    scrollPositions.current[currentView.current] = window.scrollY
    currentView.current = next
    setView(next)
  }, [])
  useEffect(() => {
    if (!plannerRestoreRequest) return
    changeView('home')
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
  }, [plannerRestoreRequest, changeView])
  useLayoutEffect(() => {
    if (!mounted.current) { mounted.current = true; return }
    window.scrollTo({ top: scrollPositions.current[view], behavior: 'instant' })
  }, [view])
  useDockerApiUrlMigrationNotice()
  useGlobalClickSuppression()

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)
    const nextSettings = buildSettingsFromUrlParams(useStore.getState().settings, searchParams)

    setSettings(nextSettings)

    if (hasUrlSettingParams(searchParams)) {
      clearUrlSettingParams(searchParams)

      const nextSearch = searchParams.toString()
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
      window.history.replaceState(null, '', nextUrl)
    }

    previewTranslationCache.cleanup()
    initStore()
    useStore.getState().setAppMode('gallery')
  }, [setSettings])

  useEffect(() => {
    const syncViewFromLocation = () => {
      if (window.location.hash.replace(/^#\/?/, '') === 'seedream-pro') {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/editor`)
      }
      changeView(getAppViewFromHash())
    }
    syncViewFromLocation()
    window.addEventListener('hashchange', syncViewFromLocation)
    window.addEventListener('popstate', syncViewFromLocation)
    return () => {
      window.removeEventListener('hashchange', syncViewFromLocation)
      window.removeEventListener('popstate', syncViewFromLocation)
    }
  }, [changeView])

  useEffect(() => {
    const preventPageImageDrag = (e: DragEvent) => {
      if ((e.target as HTMLElement | null)?.closest('img')) {
        e.preventDefault()
      }
    }

    document.addEventListener('dragstart', preventPageImageDrag)
    return () => document.removeEventListener('dragstart', preventPageImageDrag)
  }, [])

  const navigate = (nextView: AppView) => {
    changeView(nextView)
    if (nextView === 'editor' || nextView === 'tagger') {
      const hash = `#/${nextView}`
      if (window.location.hash !== hash) window.location.hash = `/${nextView}`
      return
    }

    const nextUrl = `${window.location.pathname}${window.location.search}`
    window.history.pushState(null, '', nextUrl)
  }

  return (
    <>
      <Header activeView={view} onNavigate={navigate} />
      <main data-home-main data-drag-select-surface className={view === 'home' ? 'home-main-with-dock pb-48 lg:pb-10' : 'pb-10'}>
        <div className={`safe-area-x mx-auto lg:!px-6 ${view === 'editor' ? 'max-w-[96rem]' : 'max-w-7xl'}`}>
          {/* Keep the planner mounted so navigation preserves its in-progress work and selection. */}
          <div hidden={view !== 'home'}>
            <AmazonPlanner isActive={view === 'home'} />
            {view === 'home' && <><SearchBar /><TaskGrid /></>}
          </div>
          {view === 'editor' && <ImageEditorPage />}
          {view === 'tagger' && <SyntheticPerformerTaggerPage />}
        </div>
      </main>
      {view === 'home' && <InputBar />}
      <DetailModal />
      <ImageVersionReviewModal />
      <MaterialLibraryModal />
      <GenerationQueueModal />
      <Lightbox />
      <SettingsModal scope={view === 'editor' ? 'editor' : 'home'} />
      <ConfirmDialog />
      <Toast />
      <MaskEditorModal />
      <ImageContextMenu />
    </>
  )
}
