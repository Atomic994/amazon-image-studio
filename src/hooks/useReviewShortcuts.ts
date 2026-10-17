import { useEffect, useRef, type RefObject } from 'react'
import { reviewShortcut, type ReviewShortcut } from '../lib/reviewNavigation'

export function useReviewShortcuts(enabled: boolean, panel: RefObject<HTMLElement | null>, onAction: (action: ReviewShortcut) => void) {
  const handler = useRef(onAction); handler.current = onAction
  useEffect(() => {
    if (!enabled) return
    const listener = (event: KeyboardEvent) => {
      // A nested modal owns its keyboard while it is open.
      const target = event.target instanceof Element ? event.target : null
      const dialog = target?.closest('[role="dialog"]')
      if (dialog && panel.current && !dialog.contains(panel.current)) return
      const action = reviewShortcut(event)
      if (!action) return
      event.preventDefault(); handler.current(action)
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [enabled, panel])
}
