import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import type { MaterialCollection, MaterialCollectionItem } from '../types'
import { DEFAULT_PARAMS } from '../types'
import { buildMaterialDeliveryZip, safeDeliveryName } from './materialDelivery'
import { appendMaterialCollectionVersion } from './materialCollections'
import { confirmProductFacts, emptyProductFactsState } from './productFacts'

const item = (id: string, slot = 'MAIN'): MaterialCollectionItem => ({ id, imageId: id, label: 'Product', slot, params: { ...DEFAULT_PARAMS }, referenceImageIds: ['private-source'], prompt: 'A product photograph' })
const readImage = async (id: string) => ({ id, dataUrl: 'data:image/png;base64,YWJj', width: 1024, height: 1024 })
describe('single material version delivery ZIP', () => {
  it('exports only confirmed final outputs and explicitly records missing slots', async () => {
    const finalSet = { scope: 'planner:set:listing', expectedSlots: ['MAIN', 'PT01'], missingSlots: ['PT01'], confirmedAt: 10 }
    const collection = appendMaterialCollectionVersion({ title: 'Confirmed outputs', items: [item('selected')], finalSet })
    const result = await buildMaterialDeliveryZip(collection, collection.versions[0].id, readImage)
    const manifest = JSON.parse(strFromU8(unzipSync(result.bytes)['manifest.json']))
    expect(manifest.finalSet).toEqual(finalSet); expect(manifest.images.map((row: { imageId: string }) => row.imageId)).toEqual(['selected'])
  })
  it('packages only the selected version with product, slot and set version names; preserves bytes', async () => {
    let collection = appendMaterialCollectionVersion({ title: 'Desk Lamp', items: [item('old')] })
    collection = appendMaterialCollectionVersion({ title: 'Desk Lamp', items: [item('new', 'PT01')] }, collection)
    const result = await buildMaterialDeliveryZip(collection, collection.versions[0].id, readImage)
    expect(result.filename).toBe('Desk Lamp_v1.zip')
    const files = unzipSync(result.bytes)
    expect(Object.keys(files)).toEqual(['images/Desk Lamp_v1_MAIN.png', 'manifest.json', 'README.txt'])
    expect(strFromU8(files['images/Desk Lamp_v1_MAIN.png'])).toBe('abc')
    const manifest = JSON.parse(strFromU8(files['manifest.json']))
    expect(manifest.images[0].imageId).toBe('old'); expect(manifest.images[0].dimensions).toEqual({ width: 1024, height: 1024 })
    expect(manifest.images[0].references[0].imageId).toBe('private-source')
    expect(manifest.savedVersion.number).toBe(1)
    expect(JSON.stringify(manifest)).not.toContain('"imageId":"new"')
  })
  it('retains per-image fact snapshots but cannot copy unknown API settings into the manifest', async () => {
    const state = emptyProductFactsState(); state.draft.productName = 'Lamp'
    const version = confirmProductFacts(state, '', []).versions[0]
    const collection = appendMaterialCollectionVersion({ title: 'Safe set', items: [{ ...item('one'), productFactsSnapshot: version, apiKey: 'secret-never-export' } as MaterialCollectionItem] })
    ;(collection.versions[0] as unknown as Record<string, unknown>).settings = { apiKey: 'secret-never-export' }
    const result = await buildMaterialDeliveryZip(collection, collection.versions[0].id, readImage)
    const manifestText = strFromU8(unzipSync(result.bytes)['manifest.json'])
    expect(manifestText).toContain(version.id); expect(manifestText).toContain('Lamp')
    expect(manifestText).not.toContain('secret-never-export'); expect(manifestText).not.toContain('apiKey')
  })
  it('sanitizes traversal and Windows reserved names and disambiguates duplicate slots', async () => {
    expect(safeDeliveryName('../../CON')).not.toContain('/')
    expect(safeDeliveryName('CON')).toBe('_CON')
    expect(safeDeliveryName('..')).toBe('material')
    const collection = appendMaterialCollectionVersion({ title: '../Lamp:*', items: [item('a', '../MAIN'), item('b', '../MAIN')] })
    const result = await buildMaterialDeliveryZip(collection, collection.versions[0].id, readImage)
    const paths = Object.keys(unzipSync(result.bytes)).filter((name) => name.startsWith('images/'))
    expect(paths.length).toBe(2); expect(paths[1]).toContain('_2.png')
    expect(paths.every((path) => path.split('/').length === 2)).toBe(true)
  })
  it('aborts the entire delivery for missing originals, invalid versions or empty plan-only sets', async () => {
    const collection = appendMaterialCollectionVersion({ title: 'Incomplete', items: [item('a'), item('b')] })
    await expect(buildMaterialDeliveryZip(collection, collection.versions[0].id, async (id) => id === 'a' ? readImage(id) : undefined)).rejects.toThrow('未导出 ZIP')
    await expect(buildMaterialDeliveryZip(collection, 'missing', readImage)).rejects.toThrow('不存在')
    const empty = { ...collection, versions: [{ ...collection.versions[0], items: [] }] } as MaterialCollection
    await expect(buildMaterialDeliveryZip(empty, empty.versions[0].id, readImage)).rejects.toThrow('只有策划')
  })
  it('exports A+ external copy only for delivered slots in the selected saved version', async () => {
    const plannerSession = { mode: 'aplus', marketplaceId: 'de', aPlusPlans: [
      { slot: 'A+L01', label: '横幅', textTitle: 'Leselampe', textBody: 'Für Ihren Schreibtisch.' },
      { slot: 'A+L02', label: '其他模块', textTitle: 'Not delivered', textBody: 'Do not export this' },
    ] } as unknown as import('../types').AmazonPlannerSession
    const collection = appendMaterialCollectionVersion({ title: 'A+ set', items: [item('one', 'A+L01')], plannerSession })
    const result = await buildMaterialDeliveryZip(collection, collection.versions[0].id, readImage)
    const files = unzipSync(result.bytes), copy = strFromU8(files['APlus-copy.md'])
    expect(copy).toContain('A+L01'); expect(copy).toContain('Leselampe'); expect(copy).toContain('de')
    expect(copy).not.toContain('Not delivered'); expect(copy).not.toContain('A+L02')
    const manifest = JSON.parse(strFromU8(files['manifest.json']))
    expect(manifest.aPlusCopyFile).toBe('APlus-copy.md'); expect(manifest.images[0].originalDimensions).toEqual(manifest.images[0].dimensions)
  })
  it('uses the generated image’s linked module version instead of newer A+ copy', async () => {
    const oldPlan = { slot: 'A+L01', label: '旧版横幅', textTitle: 'Original title', textBody: 'Original body', uploadSize: '970x300' }
    const plannerSession = { mode: 'aplus', aPlusPlans: [{ ...oldPlan, textTitle: 'New unrelated title' }], moduleVersions: { 'aplus:A+L01': [{ id: 'old-plan', mode: 'aplus', plan: oldPlan }] } } as unknown as import('../types').AmazonPlannerSession
    const collection = appendMaterialCollectionVersion({ title: 'Versioned copy', items: [{ ...item('one', 'A+L01'), category: { plannerModuleVersionId: 'old-plan' } }], plannerSession })
    const copy = strFromU8(unzipSync((await buildMaterialDeliveryZip(collection, collection.versions[0].id, readImage)).bytes)['APlus-copy.md'])
    expect(copy).toContain('Original title'); expect(copy).toContain('old-plan'); expect(copy).not.toContain('New unrelated title')
  })
})
