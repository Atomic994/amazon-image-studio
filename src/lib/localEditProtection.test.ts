import { describe, expect, it } from 'vitest'
import { compositeProtectedPixels } from './localEditProtection'

const bytes = (...values: number[]) => new Uint8ClampedArray(values)
describe('local edit pixel protection', () => {
  it('preserves every protected channel and only replaces transparent-mask pixels', () => {
    const original = bytes(10, 20, 30, 255, 40, 50, 60, 128, 70, 80, 90, 0)
    const edited = bytes(200, 210, 220, 255, 230, 240, 250, 255, 0, 0, 0, 255)
    const mask = bytes(255, 255, 255, 255, 0, 0, 0, 0, 255, 255, 255, 255)
    expect([...compositeProtectedPixels(original, edited, mask)]).toEqual([10, 20, 30, 255, 230, 240, 250, 255, 70, 80, 90, 0])
    expect([...original]).toEqual([10, 20, 30, 255, 40, 50, 60, 128, 70, 80, 90, 0])
  })
  it('blends soft edges using alpha so transparent original pixels do not cause dark halos', () => {
    expect([...compositeProtectedPixels(bytes(0, 0, 0, 0), bytes(255, 0, 0, 255), bytes(0, 0, 0, 128))]).toEqual([255, 0, 0, 127])
    expect([...compositeProtectedPixels(bytes(0, 0, 255, 255), bytes(255, 0, 0, 255), bytes(0, 0, 0, 128))]).toEqual([127, 0, 128, 255])
  })
  it('ignores mask RGB and uses only mask alpha', () => {
    expect(compositeProtectedPixels(bytes(1, 2, 3, 255), bytes(9, 8, 7, 255), bytes(1, 33, 89, 0))).toEqual(bytes(9, 8, 7, 255))
  })
  it.each([0, 3, 5])('rejects invalid buffers of length %s', (length) => {
    expect(() => compositeProtectedPixels(new Uint8ClampedArray(length), bytes(0, 0, 0, 0), bytes(0, 0, 0, 0))).toThrow('像素尺寸不一致')
  })
})
