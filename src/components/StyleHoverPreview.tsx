import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getStylePreviewPosition } from '../lib/stylePreviewPosition'

export interface StylePreviewState {
  dataUrl: string
  label: string
  description: string
  clientX: number
  clientY: number
}

export default function StyleHoverPreview({ preview }: { preview: StylePreviewState }) {
  const ref = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(500)
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))
  const position = getStylePreviewPosition({
    ...preview,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    previewHeight: height,
  })

  useLayoutEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => setHeight(element.getBoundingClientRect().height)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [preview.dataUrl, position.width])

  // Fixed coordinates must not inherit a containing block from backdrop-filter panels.
  return createPortal(
    <div
      ref={ref}
      data-style-hover-preview
      className="ios-menu pointer-events-none fixed z-[95] hidden overflow-hidden sm:block"
      style={position}
      aria-hidden="true"
    >
      <img
        src={preview.dataUrl}
        alt=""
        className="w-full bg-gray-100 object-contain dark:bg-white/[0.04]"
        style={{ maxHeight: Math.max(40, position.maxHeight - 100) }}
      />
      <div className="border-t border-gray-100 p-3 dark:border-white/[0.08]">
        <div className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{preview.label}</div>
        <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{preview.description}</div>
      </div>
    </div>,
    document.body,
  )
}
