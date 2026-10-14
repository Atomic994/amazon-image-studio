import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const baseUrl = process.env.PREVIEW_TEST_URL || 'http://127.0.0.1:5174'
const output = new URL('../output/planner-preview/', import.meta.url)
const screenshotPath = (name) => fileURLToPath(new URL(name, output))
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
let translations = 0
let failTranslation = false
let holdTranslation = false
let pendingRoute = null
let originalPlans
await page.route('https://planner-preview-test.invalid/**', async (route) => {
  const body = route.request().postDataJSON()
  assert.equal(body.model, 'test-planner-model')
  assert.equal(route.request().headers().authorization, 'Bearer planner-test-only')
  if (body.messages[0].content.includes('Translate the following')) {
    translations++
    assert.equal(body.tools, undefined)
    assert.equal(body.response_format, undefined)
    if (holdTranslation) { pendingRoute = route; return }
    if (failTranslation) { await route.fulfill({ status: 401, body: '{"error":{"message":"invalid test key"}}' }); return }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: '## 中文模块预览\n\n完整中文译文，保留 970x300 和 Example Brand。\n\n### 生图提示词\n\n产品大图与清晰卖点。' }, finish_reason: 'stop' }] }) })
    return
  }
  const specs = await page.evaluate(async () => (await import('/src/lib/listingPlanner.ts')).getAPlusModuleSpecs('standard-large'))
  originalPlans = specs.map((spec) => ({
    slot: spec.slot, label: spec.label, moduleType: spec.moduleType,
    uploadSize: `${spec.uploadWidth}x${spec.uploadHeight}`, generationSize: '2048x634',
    planMarkdown: `## ${spec.slot} module composition\n\n${'Full composition, verified product evidence and copy hierarchy. '.repeat(30)}`,
    textTitle: 'Example Brand: Daily Comfort', textBody: 'Made for everyday use. Keep all verified facts.',
    prompt: 'Create an Amazon product module. Preserve Example Brand. ' + 'Full English image prompt. '.repeat(90),
    negativePrompt: 'false claims, extra products, wrong brand',
  }))
  await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ product: { title: 'Test Product' }, sellingPoints: ['Verified benefit'], seriesStyleGuide: 'Keep consistent product identity.', aPlusPlans: originalPlans }) }, finish_reason: 'stop' }] }) })
})

try {
  await page.goto(baseUrl)
  await page.getByRole('button', { name: 'A+ 图', exact: true }).waitFor()
  await page.evaluate(async () => {
    const { useStore } = await import('/src/store.ts')
    const { createDefaultAmazonPlannerProfile, createDefaultOpenAIProfile } = await import('/src/lib/apiProfiles.ts')
    const { STYLE_PRESETS } = await import('/src/lib/stylePresets.ts')
    const { createStyleReferenceEditStateFromPreset } = await import('/src/lib/styleReferences.ts')
    const { storeImage } = await import('/src/lib/db.ts')
    const canvas = document.createElement('canvas')
    canvas.width = 300; canvas.height = 600
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#14947d'; ctx.fillRect(0, 0, 300, 600)
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(40, 60, 220, 140)
    const imageId = await storeImage(canvas.toDataURL('image/png'), 'upload')
    const planner = { ...createDefaultAmazonPlannerProfile(), baseUrl: 'https://planner-preview-test.invalid/v1', apiKey: 'planner-test-only', model: 'test-planner-model', apiMode: 'chat', apiProxy: false }
    const image = { ...createDefaultOpenAIProfile(), apiKey: 'image-test-only' }
    useStore.getState().setSettings({
      profiles: [image, planner], activeProfileId: image.id, amazonPlannerProfileId: planner.id,
      customStyleReferences: [{ id: 'preview-custom', title: 'Test Custom Style', editState: { ...createStyleReferenceEditStateFromPreset(STYLE_PRESETS[0]), title: 'Test Custom Style' }, imageId: '', createdAt: 1, updatedAt: 1 }],
      amazonUploadedStyleReferences: [{ id: 'preview-upload', title: 'Test Uploaded Template', imageId, createdAt: 1, updatedAt: 1 }],
    })
  })
  await page.getByRole('button', { name: 'A+ 图', exact: true }).click()

  await page.getByRole('button', { name: '预览 A+L01 模块内容', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: /A\+L01/ })
  await dialog.waitFor()
  assert.match(await dialog.innerText(), /尚未生成策划内容/)
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  await page.getByPlaceholder('Title: ...', { exact: false }).fill('Title: Test Product\nAbout this item\n- Verified product benefit. Example Brand.')
  await page.getByRole('button', { name: 'AI策划A+', exact: true }).click()
  await page.getByText('Example Brand: Daily Comfort', { exact: true }).first().waitFor()

  const hover = page.locator('[data-style-hover-preview]')
  for (const name of ['清爽科技', 'Test Custom Style', 'Test Uploaded Template']) {
    const image = page.getByRole('img', { name, exact: true })
    await image.scrollIntoViewIfNeeded()
    await image.waitFor()
    await page.waitForFunction((alt) => {
      const img = Array.from(document.images).find((item) => item.alt === alt)
      return img?.complete && img.naturalWidth > 0
    }, name)
    const rect = await image.boundingBox()
    assert.ok(rect)
    const point = { x: rect.x + rect.width / 2, y: rect.y + Math.min(rect.height / 2, 100) }
    await page.mouse.move(point.x, point.y)
    await hover.waitFor({ state: 'visible' })
    await page.waitForFunction(() => document.querySelector('[data-style-hover-preview] img')?.naturalWidth > 0)
    const first = await hover.boundingBox()
    assert.ok(first.x >= 12 && first.y >= 12)
    assert.ok(first.x + first.width <= 1588 && first.y + first.height <= 988)
    assert.ok(first.x + first.width < point.x, `${name}: preview should be left of pointer`)
    assert.equal(await hover.evaluate((el) => el.parentElement === document.body), true)
    await page.mouse.move(point.x + 10, point.y + 10)
    const second = await hover.boundingBox()
    assert.ok(Math.abs(second.x - first.x - 10) < 1, `${name}: must follow horizontal mouse movement`)
    await page.screenshot({ path: screenshotPath(`${name === '清爽科技' ? 'preset' : name === 'Test Custom Style' ? 'custom' : 'uploaded'}-hover.png`) })
    await page.mouse.move(1, 1)
    await hover.waitFor({ state: 'hidden' })
  }

  await page.getByRole('button', { name: '预览 A+L01 模块内容', exact: true }).click()
  dialog = page.getByRole('dialog', { name: /A\+L01/ })
  await dialog.waitFor()
  assert.ok((await dialog.innerText()).includes(originalPlans[0].prompt.trim()))
  await dialog.getByRole('button', { name: '翻译为中文', exact: true }).click()
  await dialog.getByRole('tab', { name: '中文', exact: true }).waitFor()
  await page.getByText('完整中文译文，保留 970x300 和 Example Brand。', { exact: true }).waitFor()
  assert.equal(translations, 1)
  await dialog.getByRole('tab', { name: '原文', exact: true }).click()
  assert.ok((await dialog.innerText()).includes(originalPlans[0].prompt.trim()))
  await dialog.getByRole('button', { name: '翻译为中文', exact: true }).click()
  assert.equal(translations, 1, 'cached translations should not call API again')
  await page.screenshot({ path: screenshotPath('module-chinese-desktop.png') })

  await dialog.getByRole('button', { name: '下一个模块', exact: true }).click()
  dialog = page.getByRole('dialog', { name: /A\+L02/ })
  failTranslation = true
  await dialog.getByRole('button', { name: '翻译为中文', exact: true }).click()
  await dialog.getByRole('alert').waitFor()
  assert.match(await dialog.getByRole('alert').innerText(), /401/)
  assert.ok((await dialog.innerText()).includes(originalPlans[1].prompt.trim()), 'translation failure must preserve original')
  failTranslation = false
  holdTranslation = true
  await dialog.getByRole('button', { name: '翻译为中文', exact: true }).click()
  await dialog.getByRole('button', { name: '停止翻译', exact: true }).waitFor()
  await dialog.getByRole('button', { name: '停止翻译', exact: true }).click()
  await dialog.getByRole('button', { name: '翻译为中文', exact: true }).waitFor()
  if (pendingRoute) { await pendingRoute.abort().catch(() => {}); pendingRoute = null }
  holdTranslation = false
  await dialog.getByRole('button', { name: '翻译为中文', exact: true }).click()
  await page.getByText('完整中文译文，保留 970x300 和 Example Brand。', { exact: true }).waitFor()

  for (const viewport of [{ width: 1024, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    const rect = await dialog.boundingBox()
    assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= viewport.width && rect.y + rect.height <= viewport.height)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    for (const button of await dialog.getByRole('button').all()) {
      const bounds = await button.boundingBox()
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= viewport.width)
    }
    await page.screenshot({ path: screenshotPath(`module-${viewport.width}.png`) })
  }
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '预览 A+L03 模块内容', exact: true }).click()
  dialog = page.getByRole('dialog', { name: /A\+L03/ })
  holdTranslation = true
  await dialog.getByRole('button', { name: '翻译为中文', exact: true }).click()
  await dialog.getByRole('button', { name: '停止翻译', exact: true }).waitFor()
  await dialog.getByRole('button', { name: '关闭模块预览', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  if (pendingRoute) { await pendingRoute.abort().catch(() => {}); pendingRoute = null }
  holdTranslation = false
  await page.getByRole('button', { name: '预览 A+L03 模块内容', exact: true }).click()
  dialog = page.getByRole('dialog', { name: /A\+L03/ })
  assert.ok((await dialog.innerText()).includes(originalPlans[2].prompt.trim()))
  assert.equal(await dialog.getByRole('button', { name: '停止翻译', exact: true }).count(), 0)
  await page.keyboard.press('Escape')
  assert.deepEqual(errors, [])
  console.log('PASS: preset/custom/uploaded mouse-following portals; complete module content; planner LLM translation; source/cache/error/cancel; desktop/tablet/mobile; no page errors.')
} catch (error) {
  await page.screenshot({ path: screenshotPath('failure.png') }).catch(() => {})
  throw error
} finally {
  if (pendingRoute) await pendingRoute.abort().catch(() => {})
  await context.close()
  await browser.close()
}
