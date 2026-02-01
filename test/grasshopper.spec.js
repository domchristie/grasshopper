import { test, expect } from '@playwright/test'

// Helper to mark the document and check if it survived navigation
async function markDocument(page) {
	return await page.evaluate(() => document.__testId = Math.random())
}
async function getDocumentId(page) {
	return await page.evaluate(() => document.__testId)
}

test.describe('Basic Navigation', () => {
	test('push navigation keeps same document', async ({ page }) => {
		await page.goto('/')
		const docId = await markDocument(page)
		await page.click('a[href="/fixtures/two.html"]')
		await expect(page).toHaveTitle('Two')
		expect(await getDocumentId(page)).toBe(docId)
	})

	test('replace navigation keeps same document', async ({ page }) => {
		await page.goto('/')
		const docId = await markDocument(page)
		const entriesBefore = await page.evaluate(() => navigation.entries().length)
		await page.click('a[href="/fixtures/two.html"][data-hop-type="replace"]')
		await expect(page).toHaveTitle('Two')
		expect(await getDocumentId(page)).toBe(docId)
		const entriesAfter = await page.evaluate(() => navigation.entries().length)
		expect(entriesAfter).toBe(entriesBefore)
	})

	test('replace to self keeps same document', async ({ page }) => {
		await page.goto('/')
		const docId = await markDocument(page)
		const entriesBefore = await page.evaluate(() => navigation.entries().length)
		await page.click('a[href="/"][data-hop-type="replace"]')
		await expect(page).toHaveTitle('Test Hub')
		expect(await getDocumentId(page)).toBe(docId)
		const entriesAfter = await page.evaluate(() => navigation.entries().length)
		expect(entriesAfter).toBe(entriesBefore)
	})

	test('back button traverses history', async ({ page }) => {
		await page.goto('/')
		const docId = await markDocument(page)
		await page.click('a[href="/fixtures/two.html"]')
		await expect(page).toHaveTitle('Two')
		await page.goBack()
		await expect(page).toHaveTitle('Test Hub')
		expect(await getDocumentId(page)).toBe(docId)
	})

	test('forward button traverses history', async ({ page }) => {
		await page.goto('/')
		const docId = await markDocument(page)
		await page.click('a[href="/fixtures/two.html"]')
		await expect(page).toHaveTitle('Two')
		await page.goBack()
		await expect(page).toHaveTitle('Test Hub')
		await page.goForward()
		await expect(page).toHaveTitle('Two')
		expect(await getDocumentId(page)).toBe(docId)
	})
})

test.describe('Persistence', () => {
	test('data-hop-persist element survives navigation', async ({ page }) => {
		await page.goto('/')
		const docId = await markDocument(page)
		await page.click('a[href="/fixtures/two.html"]')
		await expect(page).toHaveTitle('Two')
		expect(await getDocumentId(page)).toBe(docId)
		await expect(page.locator('#p')).toHaveText('Hub persistent element')
	})
})

test.describe('Fragments', () => {
	test('local fragment scrolls without page swap', async ({ page }) => {
		await page.goto('/')
		const docId = await markDocument(page)
		const scrollBefore = await page.evaluate(() => window.scrollY)
		await page.click('a[href="#local-fragment"]')
		await expect(page).toHaveURL(/#local-fragment/)
		expect(await getDocumentId(page)).toBe(docId)
		const scrollAfter = await page.evaluate(() => window.scrollY)
		expect(scrollAfter).toBeGreaterThan(scrollBefore)
	})

	test('fragment on another page keeps same document', async ({ page }) => {
		await page.goto('/')
		const docId = await markDocument(page)
		await page.click('a[href="/fixtures/fragment.html#target"]')
		await expect(page).toHaveURL(/fragment\.html#target/)
		await expect(page).toHaveTitle('Fragments')
		expect(await getDocumentId(page)).toBe(docId)
	})
})

test.describe('Forms', () => {
	test('form GET keeps same document', async ({ page }) => {
		await page.goto('/fixtures/form-get.html')
		const docId = await markDocument(page)
		await page.click('input[type="submit"]')
		await expect(page.locator('h1')).toHaveText('Form GET Result')
		expect(await getDocumentId(page)).toBe(docId)
	})

	test('form POST keeps same document', async ({ page }) => {
		await page.goto('/fixtures/form-post.html')
		const docId = await markDocument(page)
		await page.click('input[type="submit"]')
		await expect(page.locator('h1')).toHaveText('Form POST Result')
		expect(await getDocumentId(page)).toBe(docId)
	})
})

test.describe('Fallback', () => {
	test('data-hop="false" link loads new document', async ({ page }) => {
		await page.goto('/')
		const docId = await markDocument(page)
		await page.click('a[data-hop="false"]')
		await expect(page).toHaveTitle('Two')
		expect(await getDocumentId(page)).not.toBe(docId)
	})

	test('unsupported content type triggers fallback', async ({ page }) => {
		await page.goto('/')
		const docId = await markDocument(page)
		await page.click('a[href="/unsupported"]')
		// JSON response triggers fallback - browser shows raw JSON
		await page.waitForURL('/unsupported')
		expect(await getDocumentId(page)).not.toBe(docId)
	})
})

test.describe('Redirects', () => {
	test('301 same-origin redirect keeps same document', async ({ page }) => {
		await page.goto('/')
		const docId = await markDocument(page)
		await page.click('a[href="/redirect/301"]')
		await expect(page.locator('h1')).toHaveText('Redirect Target')
		await expect(page).toHaveURL(/redirect-target\.html/)
		expect(await getDocumentId(page)).toBe(docId)
	})

	test('302 same-origin redirect keeps same document', async ({ page }) => {
		await page.goto('/')
		const docId = await markDocument(page)
		await page.click('a[href="/redirect/302"]')
		await expect(page.locator('h1')).toHaveText('Redirect Target')
		expect(await getDocumentId(page)).toBe(docId)
	})
})

test.describe('Trackable Elements', () => {
	test('same tracked element keeps same document', async ({ page }) => {
		await page.goto('/fixtures/track.html')
		const docId = await markDocument(page)
		await page.click('a[href="/fixtures/track-same.html"]')
		await expect(page).toHaveTitle('Track Same')
		expect(await getDocumentId(page)).toBe(docId)
	})

	test('changed tracked element reloads document', async ({ page }) => {
		await page.goto('/fixtures/track.html')
		const docId = await markDocument(page)
		await page.click('a[href="/fixtures/track-changed.html"]')
		await expect(page).toHaveTitle('Track Changed')
		expect(await getDocumentId(page)).not.toBe(docId)
	})

	test('changed tracked element on POST avoids reloading', async ({ page }) => {
		await page.goto('/fixtures/track-form.html')
		const docId = await markDocument(page)
		await page.click('input[type="submit"]')
		await page.waitForURL('/track-form')
		await expect(page).toHaveTitle('Track Form Result')
		expect(await getDocumentId(page)).toBe(docId)
	})

	test('changed tracked element on redirected POST reloads document', async ({ page }) => {
		await page.goto('/fixtures/track-form-redirect.html')
		const docId = await markDocument(page)
		await page.click('input[type="submit"]')
		await expect(page).toHaveTitle('Track Changed')
		expect(await getDocumentId(page)).not.toBe(docId)
	})
})

test.describe('Slow responses', () => {
	test('slow response keeps same document', async ({ page }) => {
		await page.goto('/')
		const docId = await markDocument(page)
		await page.click('a[href="/slow?delay=500"]')
		await expect(page.locator('h1')).toHaveText('Slow Page')
		expect(await getDocumentId(page)).toBe(docId)
	})

	test('navigation abort cancels slow request', async ({ page }) => {
		await page.goto('/')
		const docId = await markDocument(page)
		// Start slow navigation (don't await)
		page.click('a[href="/slow"]')
		// Wait a moment for the navigation to start
		await page.waitForTimeout(200)
		page.click('a[href="/slow?delay=500"]')
		await page.waitForTimeout(4000)
		await expect(page.locator('p')).toHaveText('Response was delayed by 500ms.')
		expect(await getDocumentId(page)).toBe(docId)
	})
})
