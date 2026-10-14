const PADDING = 12
const GAP = 16

export function getStylePreviewPosition(options: {
  clientX: number
  clientY: number
  viewportWidth: number
  viewportHeight: number
  previewHeight?: number
}) {
  const { clientX, clientY, viewportWidth, viewportHeight, previewHeight = 500 } = options
  const spaceLeft = Math.max(0, clientX - GAP - PADDING)
  const spaceRight = Math.max(0, viewportWidth - clientX - GAP - PADDING)
  const useLeft = spaceLeft >= 420 || spaceLeft >= spaceRight
  const width = Math.max(1, Math.min(420, useLeft ? spaceLeft : spaceRight, viewportWidth - PADDING * 2))
  const maxHeight = Math.max(1, viewportHeight - PADDING * 2)
  const height = Math.min(previewHeight, maxHeight)
  const left = useLeft ? clientX - GAP - width : clientX + GAP
  const top = Math.max(PADDING, Math.min(clientY - height / 2, viewportHeight - height - PADDING))
  return { left, top, width, maxHeight }
}
