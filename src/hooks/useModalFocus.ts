import { useEffect, type RefObject } from 'react'

/** Keep keyboard focus in the topmost sheet, then return it to its opener. */
export function useModalFocus(enabled: boolean, panelRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!enabled) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const controls = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? []).filter((element) => element.getClientRects().length > 0)
    controls()[0]?.focus()
    const trap = (event: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]')
      if (event.key !== 'Tab' || !dialogs[dialogs.length - 1]?.contains(panelRef.current)) return
      const elements = controls(), first = elements[0], last = elements[elements.length - 1]
      if (event.shiftKey && (document.activeElement === first || !panelRef.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !panelRef.current?.contains(document.activeElement))) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', trap)
    return () => { document.removeEventListener('keydown', trap); if (previous?.isConnected) previous.focus() }
  }, [enabled, panelRef])
}
