import { describe, expect, it } from 'vitest'
import { getStylePreviewPosition } from './stylePreviewPosition'

describe('cursor-following style previews', () => {
  it('prefers the left of the mouse when there is room', () => {
    const result = getStylePreviewPosition({ clientX: 1200, clientY: 400, viewportWidth: 1600, viewportHeight: 900 })
    expect(result.left + result.width).toBe(1184)
    expect(result.width).toBe(420)
  })

  it('flips right when the left is too narrow', () => {
    const result = getStylePreviewPosition({ clientX: 100, clientY: 400, viewportWidth: 1280, viewportHeight: 900 })
    expect(result.left).toBe(116)
    expect(result.width).toBe(420)
  })

  it('follows mouse movement on the same side', () => {
    const first = getStylePreviewPosition({ clientX: 1100, clientY: 400, viewportWidth: 1600, viewportHeight: 900 })
    const second = getStylePreviewPosition({ clientX: 1130, clientY: 430, viewportWidth: 1600, viewportHeight: 900 })
    expect(second.left - first.left).toBe(30)
    expect(second.top - first.top).toBe(30)
  })

  it.each([320, 640, 800, 1366, 1920])('keeps the preview within a %i px viewport without covering the pointer', (viewportWidth) => {
    for (const clientX of [5, viewportWidth / 2, viewportWidth - 5]) {
      for (const clientY of [5, 350, 695]) {
        const result = getStylePreviewPosition({ clientX, clientY, viewportWidth, viewportHeight: 700, previewHeight: 900 })
        expect(result.left).toBeGreaterThanOrEqual(12)
        expect(result.left + result.width).toBeLessThanOrEqual(viewportWidth - 12)
        expect(result.top).toBeGreaterThanOrEqual(12)
        expect(result.top + Math.min(900, result.maxHeight)).toBeLessThanOrEqual(688)
        expect(result.left > clientX || result.left + result.width < clientX).toBe(true)
      }
    }
  })

  it('uses the actual preview height instead of a fixed square', () => {
    const result = getStylePreviewPosition({ clientX: 1100, clientY: 800, viewportWidth: 1600, viewportHeight: 900, previewHeight: 200 })
    expect(result.top).toBe(688)
  })
})
