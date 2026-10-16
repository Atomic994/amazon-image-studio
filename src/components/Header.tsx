import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { useTooltip } from '../hooks/useTooltip'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { dismissAllTooltips } from '../lib/tooltipDismiss'
import ViewportTooltip from './ViewportTooltip'
import HelpModal from './HelpModal'
import { HelpCircleIcon, InstallIcon, SettingsIcon } from './icons'
import { Button } from './Button'
import { isLocalAppHostname } from '../lib/pwa'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

type AppView = 'home' | 'editor' | 'tagger'

type HeaderProps = {
  activeView: AppView
  onNavigate: (view: AppView) => void
}

const LOCAL_INSTALL_REMINDER = '这是本地版。安装后，下次启动应用前仍需要先打开项目目录中的 start-amazon-image-studio.bat，保持本地服务运行；否则应用无法使用。'

function isInstalledPwa() {
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true
}

export default function Header({ activeView, onNavigate }: HeaderProps) {
  const setShowSettings = useStore((s) => s.setShowSettings)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const [showHelp, setShowHelp] = useState(false)
  const [showMore, setShowMore] = useState(false)
  useCloseOnEscape(showMore, () => setShowMore(false))
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isPwaInstalled, setIsPwaInstalled] = useState(isInstalledPwa)
  const isLocalApp = isLocalAppHostname(window.location.hostname)

  const installTooltip = useTooltip()
  const helpTooltip = useTooltip()
  const settingsTooltip = useTooltip()

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
      setIsPwaInstalled(false)
    }

    const handleAppInstalled = () => {
      setInstallPrompt(null)
      setIsPwaInstalled(true)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  const promptInstall = async (promptEvent: BeforeInstallPromptEvent) => {
    setInstallPrompt(null)

    try {
      await promptEvent.prompt()
      const choice = await promptEvent.userChoice
      setIsPwaInstalled(choice.outcome === 'accepted')
    } catch {
      setIsPwaInstalled(isInstalledPwa())
    }
  }

  const handleInstallClick = () => {
    if (installPrompt) {
      const promptEvent = installPrompt

      if (isLocalApp) {
        setConfirmDialog({
          title: '安装为应用',
          message: LOCAL_INSTALL_REMINDER,
          showCancel: true,
          confirmText: '继续安装',
          cancelText: '取消',
          icon: 'info',
          action: () => {
            void promptInstall(promptEvent)
          },
        })
      } else {
        void promptInstall(promptEvent)
      }
      return
    }

    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    const installInstructions = isIos
      ? '在 Safari 浏览器中，点击底部「分享」按钮，选择「添加到主屏幕」即可安装此应用。'
      : '请在浏览器的菜单中选择「添加到主屏幕」或「安装应用」。\n\n（如果在微信等内置浏览器中，请先在外部浏览器打开）'

    setConfirmDialog({
      title: isLocalApp ? '安装本地应用' : '安装为应用',
      message: isLocalApp ? `${LOCAL_INSTALL_REMINDER}\n\n${installInstructions}` : installInstructions,
      showCancel: false,
      confirmText: '我知道了',
      icon: 'info',
      action: () => {},
    })
  }

  return (
    <>
      <header data-no-drag-select className="safe-area-top fixed left-0 right-0 top-0 z-40 border-b border-black/[0.06] bg-white/75 shadow-[0_1px_0_rgba(255,255,255,0.5)] backdrop-blur-2xl dark:border-white/[0.08] dark:bg-gray-950/80 dark:shadow-none">
        <div className="safe-area-x safe-header-inner mx-auto flex max-w-7xl items-center justify-between gap-2 sm:gap-3">
          <div className="flex min-w-0 items-center sm:gap-3">
            <h1 className="hidden min-w-0 min-[520px]:block">
              <button
                type="button"
                onClick={() => onNavigate('home')}
                className="truncate text-[17px] font-semibold tracking-[-0.025em] text-gray-900 transition-colors hover:text-gray-600 dark:text-gray-100 dark:hover:text-gray-300 sm:text-lg"
              >
                亚马逊图片工作台
              </button>
            </h1>
            <nav className="flex shrink-0 items-center sm:gap-1">
              <button
                type="button"
                onClick={() => onNavigate('home')}
                className={`h-8 rounded-[10px] px-1.5 text-[11px] font-semibold transition sm:px-3 sm:text-xs ${activeView === 'home' ? 'bg-gray-900 text-white shadow-sm dark:bg-white dark:text-gray-900' : 'text-gray-500 hover:bg-black/[0.05] hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/[0.08] dark:hover:text-gray-100'}`}
              >
                首页
              </button>
              <button
                type="button"
                onClick={() => onNavigate('editor')}
                className={`h-8 rounded-[10px] px-1.5 text-[11px] font-semibold transition sm:px-3 sm:text-xs ${activeView === 'editor' ? 'bg-[hsl(var(--primary))] text-white shadow-sm' : 'text-gray-500 hover:bg-black/[0.05] hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/[0.08] dark:hover:text-gray-100'}`}
              >
                图片编辑
              </button>
              <button
                type="button"
                onClick={() => onNavigate('tagger')}
                aria-label="AI 人物打标"
                className={`h-8 rounded-[10px] px-1.5 text-[11px] font-semibold transition sm:px-3 sm:text-xs ${activeView === 'tagger' ? 'bg-[hsl(var(--primary))] text-white shadow-sm' : 'text-gray-500 hover:bg-black/[0.05] hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/[0.08] dark:hover:text-gray-100'}`}
              >
                <span className="hidden sm:inline">AI </span>人物打标
              </button>
            </nav>
            <button type="button" onClick={() => useStore.getState().openMaterialLibrary()} className="h-8 shrink-0 rounded-[10px] px-1.5 text-[11px] font-semibold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--ios-blue-tint))] sm:px-3 sm:text-xs">素材库</button>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <div className="relative sm:hidden">
              <button type="button" aria-label="更多操作" aria-expanded={showMore} onClick={() => setShowMore((value) => !value)} className="h-9 rounded-lg px-1.5 text-[11px] font-semibold text-gray-600 dark:text-gray-300">更多</button>
              {showMore && <>
                <button type="button" aria-label="关闭更多操作" onClick={() => setShowMore(false)} className="fixed inset-0 z-40 cursor-default" />
                <div role="menu" aria-label="更多操作" className="absolute right-0 top-full z-50 mt-2 w-36 rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl dark:border-white/[0.1] dark:bg-gray-900">
                  <button type="button" role="menuitem" onClick={() => { setShowMore(false); setShowSettings(true, 'about') }} className="w-full rounded-lg px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/[0.08]">开源声明</button>
                  {!isPwaInstalled && <button type="button" role="menuitem" onClick={() => { setShowMore(false); handleInstallClick() }} className="w-full rounded-lg px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/[0.08]">安装为应用</button>}
                  <button type="button" role="menuitem" onClick={() => { setShowMore(false); setShowHelp(true) }} className="w-full rounded-lg px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/[0.08]">操作指南</button>
                </div>
              </>}
            </div>
            <button
              type="button"
              onClick={() => setShowSettings(true, 'about')}
              className="hidden h-8 whitespace-nowrap rounded-[10px] px-2 text-[11px] font-semibold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--ios-blue-tint))] active:translate-y-px sm:block sm:px-2.5 sm:text-xs"
            >
              开源声明
            </button>
            {!isPwaInstalled && (
              <div
                {...installTooltip.handlers}
                className="relative hidden sm:block"
              >
                <Button
                  onClick={() => {
                    dismissAllTooltips()
                    handleInstallClick()
                  }}
                  variant="plain"
                  size="icon"
                  className="text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                  aria-label="安装为应用"
                >
                  <InstallIcon className="h-5 w-5" />
                </Button>
                <ViewportTooltip visible={installTooltip.visible} className="whitespace-nowrap">
                  安装为应用
                </ViewportTooltip>
              </div>
            )}
            <div
              className="relative hidden sm:block"
              {...helpTooltip.handlers}
            >
              <Button
                onClick={() => {
                  dismissAllTooltips()
                  setShowHelp(true)
                }}
                variant="plain"
                size="icon"
                className="text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                aria-label="操作指南"
              >
                <HelpCircleIcon className="h-5 w-5" />
              </Button>
              <ViewportTooltip visible={helpTooltip.visible} className="whitespace-nowrap">
                操作指南
              </ViewportTooltip>
            </div>
            <div
              className="relative"
              {...settingsTooltip.handlers}
            >
              <Button
                onClick={() => setShowSettings(true)}
                variant="plain"
                size="icon"
                className="text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 max-sm:!h-9 max-sm:!w-9 max-sm:!min-h-9 max-sm:!min-w-9"
                aria-label="设置"
              >
                <SettingsIcon className="h-5 w-5" />
              </Button>
              <ViewportTooltip visible={settingsTooltip.visible} className="whitespace-nowrap">
                设置
              </ViewportTooltip>
            </div>
          </div>
        </div>
      </header>

      <div className="safe-area-top invisible pointer-events-none" aria-hidden="true">
        <div className="safe-header-inner" />
      </div>
      {showHelp && <HelpModal appMode="gallery" onClose={() => setShowHelp(false)} />}
    </>
  )
}
