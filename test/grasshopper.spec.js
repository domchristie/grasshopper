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

	test('external link falls back to full browser navigation', async ({ page }) => {
		await page.goto('/')
		const docId = await markDocument(page)
		await page.click('a[href="http://localhost:3001/"]')
		await page.waitForURL(/localhost:3001/)
		expect(await getDocumentId(page)).not.toBe(docId)
	})

	test('link to no-hop page triggers fallback', async ({ page }) => {
		await page.goto('/')
		const docId = await markDocument(page)
		await page.click('a[href="/fixtures/no-hop.html"]')
		await expect(page).toHaveTitle('No Hop')
		expect(await getDocumentId(page)).not.toBe(docId)
	})

	test('POST to no-hop page avoids fallback', async ({ page }) => {
		await page.goto('/fixtures/form-no-hop.html')
		const docId = await markDocument(page)
		await page.click('input[type="submit"]')
		await expect(page).toHaveTitle('No Hop')
		expect(await getDocumentId(page)).toBe(docId)
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
		await expect(page).toHaveTitle('Track Changed')
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

test.describe('Scroll Behavior', () => {
	test('push navigation scrolls to top', async ({ page }) => {
		await page.goto('/fixtures/scroll-default.html')
		// Scroll down first
		await page.evaluate(() => scrollTo(0, 100))
		await page.waitForFunction(() => scrollY > 90)

		await page.click('a[href="/fixtures/scroll-target.html"]')
		await expect(page).toHaveTitle('Scroll Target')
		expect(await page.evaluate(() => scrollY)).toBe(0)
	})

	test('replace navigation to different page scrolls to top', async ({ page }) => {
		await page.goto('/fixtures/scroll-preserve.html')
		// Scroll down first
		await page.evaluate(() => scrollTo(0, 100))
		await page.waitForFunction(() => scrollY > 90)

		await page.click('a[href="/fixtures/scroll-target.html"][data-hop-type="replace"]')
		await expect(page).toHaveTitle('Scroll Target')
		expect(await page.evaluate(() => scrollY)).toBe(0)
	})

	test('replace to self without preserve meta scrolls to top', async ({ page }) => {
		await page.goto('/fixtures/scroll-default.html')
		const docId = await markDocument(page)
		// Scroll down first
		await page.evaluate(() => scrollTo(0, 100))
		await page.waitForFunction(() => scrollY > 90)

		await page.click('a[href="/fixtures/scroll-default.html"][data-hop-type="replace"]')
		await page.waitForFunction(() => scrollY < 10)
		expect(await getDocumentId(page)).toBe(docId)
		expect(await page.evaluate(() => scrollY)).toBe(0)
	})

	test('replace to self with preserve meta refreshes the page in-place', async ({ page }) => {
		await page.goto('/fixtures/scroll-preserve.html')
		const docId = await markDocument(page)
		// Scroll down first
		await page.evaluate(() => scrollTo(0, 100))
		await page.waitForFunction(() => scrollY > 90)

		// Track whether navEvent.scroll() was called by listening to scroll events
		const scrollCallPromise = page.evaluate(() => new Promise(resolve => {
			let scrollCalled = false
			const handler = () => { scrollCalled = true }
			addEventListener('scroll', handler)
			document.addEventListener('hop:load', () => {
				removeEventListener('scroll', handler)
				resolve(scrollCalled)
			}, { once: true })
		}))
		const entriesBefore = await page.evaluate(() => navigation.entries().length)

		await page.click('a[href="/fixtures/scroll-preserve.html"][data-hop-type="replace"]')
		// When preserveScroll is true, no additional scroll events should be triggered
		// (navEvent.scroll() is not called)
		expect(await scrollCallPromise).toBe(false)
		expect(await page.evaluate(() => scrollY)).toBe(100)
		expect(await getDocumentId(page)).toBe(docId)
		expect(await page.evaluate(() => navigation.entries().length)).toBe(entriesBefore)
	})

	test('non-replace link to self does not preserve scroll even with preserve meta', async ({ page }) => {
		await page.goto('/fixtures/scroll-preserve.html')
		const docId = await markDocument(page)
		// Scroll down first
		await page.evaluate(() => scrollTo(0, 100))
		await page.waitForFunction(() => scrollY > 90)
		const entriesBefore = await page.evaluate(() => navigation.entries().length)

		await page.click('a[href="/fixtures/scroll-preserve.html"]:not([data-hop-type])')
		await page.waitForFunction(() => scrollY < 10)
		expect(await getDocumentId(page)).toBe(docId)
		expect(await page.evaluate(() => scrollY)).toBe(0)
		const entriesafter = await page.evaluate(() => navigation.entries().length)
		expect(entriesafter).toBe(entriesBefore)
	})
})

test.describe('Fetch Events', () => {
	test('successful navigation fires before-fetch, fetch-start, fetch-load, and fetch-end on the source element', async ({ page }) => {
		await page.goto('/')
		const events = page.evaluate(() => {
			const link = document.querySelector('a[href="/fixtures/two.html"]')
			const events = []
			link.addEventListener('hop:before-fetch', (e) => {
				events.push({ type: 'before-fetch', url: e.detail.options.to.href, target: e.target.tagName })
			})
			link.addEventListener('hop:fetch-start', (e) => {
				events.push({ type: 'fetch-start', url: e.detail.options.to.href, target: e.target.tagName })
			})
			link.addEventListener('hop:fetch-load', (e) => {
				events.push({ type: 'fetch-load', url: e.detail.options.to.href, target: e.target.tagName })
			})
			link.addEventListener('hop:fetch-end', (e) => {
				events.push({ type: 'fetch-end', url: e.detail.options.to.href, target: e.target.tagName })
			})
			link.addEventListener('hop:fetch-error', (e) => {
				events.push({ type: 'fetch-error' })
			})
			return new Promise(resolve => {
				document.addEventListener('hop:load', () => resolve(events), { once: true })
			})
		})

		await page.click('a[href="/fixtures/two.html"]')
		await expect(page).toHaveTitle('Two')

		const result = await events
		expect(result.map(e => e.type)).toEqual(['before-fetch', 'fetch-start', 'fetch-load', 'fetch-end'])
		expect(result[0].url).toContain('/fixtures/two.html')
		expect(result[0].target).toBe('A')
		expect(result[1].target).toBe('A')
		expect(result[2].target).toBe('A')
		expect(result[3].target).toBe('A')
	})

	test('before-fetch is interceptable and prevents navigation', async ({ page }) => {
		await page.goto('/')
		const docId = await markDocument(page)

		await page.evaluate(() => {
			document.addEventListener('hop:before-fetch', (e) => {
				e.preventDefault()
			})
		})

		await page.click('a[href="/fixtures/two.html"]')
		// Should stay on the same page since before-fetch was cancelled
		await page.waitForTimeout(500)
		await expect(page).toHaveTitle('Test Hub')
		expect(await getDocumentId(page)).toBe(docId)
	})

	test('fetch-error fires on source element on network error', async ({ page }) => {
		await page.goto('/')

		const events = page.evaluate(() => {
			const link = document.querySelector('a[href="/fixtures/two.html"]')
			const events = []
			link.addEventListener('hop:fetch-error', (e) => {
				events.push({ type: 'fetch-error', url: e.detail.options.to.href, hasError: !!e.detail.error, target: e.target.tagName })
			})
			link.addEventListener('hop:fetch-end', (e) => {
				events.push({ type: 'fetch-end', url: e.detail.options.to.href, target: e.target.tagName })
			})
			return new Promise(resolve => {
				document.addEventListener('hop:fetch-end', () => resolve(events), { once: true })
			})
		})

		// Block the request to simulate a network error
		await page.route('/fixtures/two.html', route => route.abort())
		await page.click('a[href="/fixtures/two.html"]').catch(() => {})
		await page.waitForTimeout(500)

		const result = await events
		expect(result.map(e => e.type)).toEqual(['fetch-error', 'fetch-end'])
		expect(result[0].hasError).toBe(true)
		expect(result[0].url).toContain('/fixtures/two.html')
		expect(result[0].target).toBe('A')
		expect(result[1].target).toBe('A')
	})
})

test.describe('Intercept Events', () => {
	test('before-intercept fires with options detail', async ({ page }) => {
		await page.goto('/')
		const detail = page.evaluate(() => {
			return new Promise(resolve => {
				document.addEventListener('hop:before-intercept', (e) => {
					resolve({
						hasOptions: !!e.detail.options,
						method: e.detail.options.method,
						url: e.detail.options.to.href,
						hasSourceElement: !!e.detail.options.sourceElement
					})
				}, { once: true })
			})
		})

		await page.click('a[href="/fixtures/two.html"]')
		await expect(page).toHaveTitle('Two')

		const result = await detail
		expect(result.hasOptions).toBe(true)
		expect(result.method).toBe('GET')
		expect(result.url).toContain('/fixtures/two.html')
		expect(result.hasSourceElement).toBe(true)
	})

	test('canceling before-intercept falls back to standard navigation', async ({ page }) => {
		await page.goto('/')
		const docId = await markDocument(page)

		await page.evaluate(() => {
			document.addEventListener('hop:before-intercept', (e) => {
				e.preventDefault()
			})
		})

		await page.click('a[href="/fixtures/two.html"]')
		await expect(page).toHaveTitle('Two')
		// Full page load - new document
		expect(await getDocumentId(page)).not.toBe(docId)
	})
})

test.describe('Swap Events', () => {
	test('before-swap fires before swap and is cancelable', async ({ page }) => {
		await page.goto('/')
		const docId = await markDocument(page)

		const events = page.evaluate(() => {
			const events = []
			document.addEventListener('hop:before-swap', (e) => {
				events.push({
					type: 'before-swap',
					hasOptions: !!e.detail.options,
					titleBeforeSwap: document.title
				})
			})
			document.addEventListener('hop:after-swap', (e) => {
				events.push({
					type: 'after-swap',
					hasOptions: !!e.detail.options,
					titleAfterSwap: document.title
				})
			})
			return new Promise(resolve => {
				document.addEventListener('hop:load', () => resolve(events), { once: true })
			})
		})

		await page.click('a[href="/fixtures/two.html"]')
		await expect(page).toHaveTitle('Two')

		const result = await events
		expect(result.map(e => e.type)).toEqual(['before-swap', 'after-swap'])
		expect(result[0].hasOptions).toBe(true)
		expect(result[0].titleBeforeSwap).toBe('Test Hub')
		expect(result[1].hasOptions).toBe(true)
		expect(result[1].titleAfterSwap).toBe('Two')
	})

	test('canceling before-swap prevents the swap', async ({ page }) => {
		await page.goto('/')
		const docId = await markDocument(page)

		await page.evaluate(() => {
			document.addEventListener('hop:before-swap', (e) => {
				e.preventDefault()
			})
		})

		await page.click('a[href="/fixtures/two.html"]')
		await page.waitForTimeout(500)
		// Swap was prevented so title stays
		await expect(page).toHaveTitle('Test Hub')
		expect(await getDocumentId(page)).toBe(docId)
	})

	test('calling preventDefault inside intercept callback prevents the swap', async ({ page }) => {
		await page.goto('/')
		const docId = await markDocument(page)

		await page.evaluate(() => {
			document.addEventListener('hop:before-swap', (e) => {
				e.intercept(async () => {
					// Return value is truthy, but preventDefault should still cancel
					e.preventDefault()
					return true
				})
			})
		})

		await page.click('a[href="/fixtures/two.html"]')
		await page.waitForTimeout(500)
		// Swap was prevented so title stays
		await expect(page).toHaveTitle('Test Hub')
		expect(await getDocumentId(page)).toBe(docId)
	})

	test('after-transition fires after view transition finishes', async ({ page }) => {
		await page.goto('/')

		const eventFired = page.evaluate(() => {
			return new Promise(resolve => {
				document.addEventListener('hop:after-transition', (e) => {
					resolve({ hasOptions: !!e.detail.options })
				}, { once: true })
			})
		})

		await page.click('a[href="/fixtures/two.html"]')
		await expect(page).toHaveTitle('Two')

		const result = await eventFired
		expect(result.hasOptions).toBe(true)
	})
})

test.describe('Scroll Events', () => {
	test('before-scroll fires with options detail', async ({ page }) => {
		await page.goto('/')

		const detail = page.evaluate(() => {
			return new Promise(resolve => {
				document.addEventListener('hop:before-scroll', (e) => {
					resolve({
						hasOptions: !!e.detail.options,
						method: e.detail.options.method,
						url: e.detail.options.to.href,
						hasFrom: !!e.detail.options.from,
						fromUrl: e.detail.options.from.href
					})
				}, { once: true })
			})
		})

		await page.click('a[href="/fixtures/two.html"]')
		await expect(page).toHaveTitle('Two')

		const result = await detail
		expect(result.hasOptions).toBe(true)
		expect(result.method).toBe('GET')
		expect(result.url).toContain('/fixtures/two.html')
		expect(result.hasFrom).toBe(true)
		expect(result.fromUrl).toContain('/')
	})

	test('after-scroll fires with options detail', async ({ page }) => {
		await page.goto('/')

		const detail = page.evaluate(() => {
			return new Promise(resolve => {
				document.addEventListener('hop:after-scroll', (e) => {
					resolve({
						hasOptions: !!e.detail.options,
						method: e.detail.options.method,
						url: e.detail.options.to.href,
						hasFrom: !!e.detail.options.from,
						fromUrl: e.detail.options.from.href
					})
				}, { once: true })
			})
		})

		await page.click('a[href="/fixtures/two.html"]')
		await expect(page).toHaveTitle('Two')

		const result = await detail
		expect(result.hasOptions).toBe(true)
		expect(result.method).toBe('GET')
		expect(result.url).toContain('/fixtures/two.html')
		expect(result.hasFrom).toBe(true)
		expect(result.fromUrl).toContain('/')
	})

	test('before-scroll is interceptable', async ({ page }) => {
		await page.goto('/')

		const result = page.evaluate(() => {
			return new Promise(resolve => {
				document.addEventListener('hop:before-scroll', (e) => {
					e.intercept(async () => {
						resolve({ intercepted: true, hasOptions: !!e.detail.options })
					})
				}, { once: true })
			})
		})

		await page.click('a[href="/fixtures/two.html"]')
		await expect(page).toHaveTitle('Two')

		const { intercepted, hasOptions } = await result
		expect(intercepted).toBe(true)
		expect(hasOptions).toBe(true)
	})

	test('canceling before-scroll prevents scrolling and after-scroll event', async ({ page }) => {
		await page.goto('/')

		const result = page.evaluate(() => {
			let scrolledFired = false
			document.addEventListener('hop:before-scroll', (e) => {
				e.preventDefault()
			})
			document.addEventListener('hop:after-scroll', () => {
				scrolledFired = true
			})
			return new Promise(resolve => {
				document.addEventListener('hop:load', () => resolve(scrolledFired), { once: true })
			})
		})

		await page.click('a[href="/fixtures/two.html"]')
		await expect(page).toHaveTitle('Two')
		expect(await result).toBe(false)
	})
})

test.describe('Lifecycle Event Order', () => {
	test('full navigation fires events in correct order', async ({ page }) => {
		await page.goto('/')

		const events = page.evaluate(() => {
			const events = []
			const link = document.querySelector('a[href="/fixtures/two.html"]')
			document.addEventListener('hop:before-intercept', () => events.push('before-intercept'))
			link.addEventListener('hop:before-fetch', () => events.push('before-fetch'))
			link.addEventListener('hop:fetch-start', () => events.push('fetch-start'))
			link.addEventListener('hop:fetch-load', () => events.push('fetch-load'))
			link.addEventListener('hop:fetch-end', () => events.push('fetch-end'))
			document.addEventListener('hop:before-swap', () => events.push('before-swap'))
			document.addEventListener('hop:after-swap', () => events.push('after-swap'))
			document.addEventListener('hop:before-scroll', () => events.push('before-scroll'))
			document.addEventListener('hop:after-scroll', () => events.push('after-scroll'))
			return new Promise(resolve => {
				document.addEventListener('hop:load', () => {
					events.push('load')
					resolve(events)
				}, { once: true })
			})
		})

		await page.click('a[href="/fixtures/two.html"]')
		await expect(page).toHaveTitle('Two')

		const result = await events
		expect(result).toEqual([
			'before-intercept',
			'before-fetch',
			'fetch-start',
			'fetch-load',
			'fetch-end',
			'before-swap',
			'after-swap',
			'before-scroll',
			'after-scroll',
			'load'
		])
	})

	test('hop:load fires with options detail', async ({ page }) => {
		await page.goto('/')

		const detail = page.evaluate(() => {
			return new Promise(resolve => {
				document.addEventListener('hop:load', (e) => {
					resolve({
						hasOptions: !!e.detail.options,
						method: e.detail.options.method,
						url: e.detail.options.to.href
					})
				}, { once: true })
			})
		})

		await page.click('a[href="/fixtures/two.html"]')
		await expect(page).toHaveTitle('Two')

		const result = await detail
		expect(result.hasOptions).toBe(true)
		expect(result.method).toBe('GET')
		expect(result.url).toContain('/fixtures/two.html')
	})
})

test.describe('Nonce Attributes', () => {
	test('scripts with nonce are not re-executed on navigation', async ({ page }) => {
		await page.goto('/fixtures/nonce.html')
		const docId = await markDocument(page)
		// Initial page load runs the inline nonce script once
		expect(await page.evaluate(() => document.__nonceScriptCount)).toBe(1)

		await page.click('a[href="/fixtures/nonce-two.html"]')
		await expect(page).toHaveTitle('Nonce Two')
		expect(await getDocumentId(page)).toBe(docId)

		// The shared inline nonce script should NOT have run again
		expect(await page.evaluate(() => document.__nonceScriptCount)).toBe(1)
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

test.describe('Direction', () => {
	test('push navigation has direction "forward"', async ({ page }) => {
		await page.goto('/')
		const direction = page.evaluate(() => {
			return new Promise(resolve => {
				document.addEventListener('hop:before-intercept', (e) => {
					resolve(e.detail.options.direction)
				}, { once: true })
			})
		})

		await page.click('a[href="/fixtures/two.html"]')
		await expect(page).toHaveTitle('Two')
		expect(await direction).toBe('forward')
	})

	test('back traversal has direction "back"', async ({ page }) => {
		await page.goto('/')
		await page.click('a[href="/fixtures/two.html"]')
		await expect(page).toHaveTitle('Two')

		const direction = page.evaluate(() => {
			return new Promise(resolve => {
				document.addEventListener('hop:load', (e) => {
					resolve(e.detail.options.direction)
				}, { once: true })
			})
		})

		await page.goBack()
		await expect(page).toHaveTitle('Test Hub')
		expect(await direction).toBe('back')
	})

	test('forward traversal has direction "forward"', async ({ page }) => {
		await page.goto('/')
		await page.click('a[href="/fixtures/two.html"]')
		await expect(page).toHaveTitle('Two')
		await page.goBack()
		await expect(page).toHaveTitle('Test Hub')

		const direction = page.evaluate(() => {
			return new Promise(resolve => {
				document.addEventListener('hop:load', (e) => {
					resolve(e.detail.options.direction)
				}, { once: true })
			})
		})

		await page.goForward()
		await expect(page).toHaveTitle('Two')
		expect(await direction).toBe('forward')
	})

	test('replace to self has direction "none"', async ({ page }) => {
		await page.goto('/')
		const direction = page.evaluate(() => {
			return new Promise(resolve => {
				document.addEventListener('hop:before-intercept', (e) => {
					resolve(e.detail.options.direction)
				}, { once: true })
			})
		})

		await page.click('a[href="/"][data-hop-type="replace"]')
		await expect(page).toHaveTitle('Test Hub')
		expect(await direction).toBe('none')
	})

	test('data-hop-direction attribute is set during swap', async ({ page }) => {
		await page.goto('/')
		const direction = page.evaluate(() => {
			return new Promise(resolve => {
				document.addEventListener('hop:before-swap', () => {
					resolve(document.documentElement.getAttribute('data-hop-direction'))
				}, { once: true })
			})
		})

		await page.click('a[href="/fixtures/two.html"]')
		await expect(page).toHaveTitle('Two')
		expect(await direction).toBe('forward')
	})

	test('data-hop-direction attribute is removed after transition finishes', async ({ page }) => {
		await page.goto('/')
		const done = page.evaluate(() => {
			return new Promise(resolve => {
				document.addEventListener('hop:after-transition', () => resolve(), { once: true })
			})
		})

		await page.click('a[href="/fixtures/two.html"]')
		await done
		const attr = await page.evaluate(() =>
			document.documentElement.getAttribute('data-hop-direction')
		)
		expect(attr).toBeNull()
	})

	test('data-hop-direction attribute is removed at start of next navigation', async ({ page }) => {
		await page.goto('/')
		// Abort the fetch so the direction attribute stays from the first nav
		await page.route('/fixtures/two.html', route => route.abort())
		await page.click('a[href="/fixtures/two.html"]').catch(() => {})
		await page.waitForTimeout(500)

		// Direction should still be set since the transition never completed
		const before = await page.evaluate(() =>
			document.documentElement.getAttribute('data-hop-direction')
		)
		expect(before).toBe('forward')

		// Next navigation should clear it
		await page.unroute('/fixtures/two.html')
		const cleared = page.evaluate(() => {
			return new Promise(resolve => {
				document.addEventListener('hop:before-intercept', () => {
					resolve(document.documentElement.getAttribute('data-hop-direction'))
				}, { once: true })
			})
		})
		await page.click('a[href="/fixtures/two.html"]')
		await expect(page).toHaveTitle('Two')
		expect(await cleared).toBeNull()
	})
})

test.describe('Navigation ID', () => {
	const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

	test('options.id is a valid UUID', async ({ page }) => {
		await page.goto('/')
		const id = page.evaluate(() => {
			return new Promise(resolve => {
				document.addEventListener('hop:before-intercept', (e) => {
					resolve(e.detail.options.id)
				}, { once: true })
			})
		})

		await page.click('a[href="/fixtures/two.html"]')
		await expect(page).toHaveTitle('Two')
		expect(await id).toMatch(UUID_RE)
	})

	test('data-hop-id is set on source element during navigation', async ({ page }) => {
		await page.goto('/')
		const result = page.evaluate(() => {
			return new Promise(resolve => {
				document.addEventListener('hop:before-intercept', (e) => {
					const el = e.detail.options.sourceElement
					resolve({
						attr: el.getAttribute('data-hop-id'),
						id: e.detail.options.id
					})
				}, { once: true })
			})
		})

		await page.click('a[href="/fixtures/two.html"]')
		await expect(page).toHaveTitle('Two')

		const { attr, id } = await result
		expect(attr).toBe(id)
		expect(attr).toMatch(UUID_RE)
	})

	test('data-hop-id is removed after navigation completes', async ({ page }) => {
		await page.goto('/')
		const done = page.evaluate(() => {
			return new Promise(resolve => {
				document.addEventListener('hop:after-transition', () => resolve(), { once: true })
			})
		})

		await page.click('a[href="/fixtures/two.html"]')
		await done
		const count = await page.locator('[data-hop-id]').count()
		expect(count).toBe(0)
	})

	test('x-hop-id header is sent with fetch request', async ({ page }) => {
		await page.goto('/')
		const id = page.evaluate(() => {
			return new Promise(resolve => {
				document.addEventListener('hop:before-intercept', (e) => {
					resolve(e.detail.options.id)
				}, { once: true })
			})
		})

		const request = page.waitForRequest(req =>
			req.url().includes('/fixtures/two.html') && req.headers()['x-hop-id']
		)

		await page.click('a[href="/fixtures/two.html"]')
		const req = await request
		expect(req.headers()['x-hop-id']).toBe(await id)
	})

	test('each navigation gets a unique ID', async ({ page }) => {
		await page.goto('/')
		const ids = page.evaluate(() => {
			const ids = []
			document.addEventListener('hop:before-intercept', (e) => {
				ids.push(e.detail.options.id)
			})
			return new Promise(resolve => {
				let count = 0
				document.addEventListener('hop:load', () => {
					if (++count === 2) resolve(ids)
				})
			})
		})

		await page.click('a[href="/fixtures/two.html"]')
		await expect(page).toHaveTitle('Two')
		await page.click('a[href="/"]')
		await expect(page).toHaveTitle('Test Hub')

		const result = await ids
		expect(result).toHaveLength(2)
		expect(result[0]).toMatch(UUID_RE)
		expect(result[1]).toMatch(UUID_RE)
		expect(result[0]).not.toBe(result[1])
	})

	test('ID is preserved across redirects', async ({ page }) => {
		await page.goto('/')
		const result = page.evaluate(() => {
			let interceptId
			document.addEventListener('hop:before-intercept', (e) => {
				interceptId = interceptId || e.detail.options.id
			})
			return new Promise(resolve => {
				document.addEventListener('hop:load', (e) => {
					resolve({ interceptId, loadId: e.detail.options.id })
				}, { once: true })
			})
		})

		await page.click('a[href="/redirect/301"]')
		await expect(page.locator('h1')).toHaveText('Redirect Target')

		const { interceptId, loadId } = await result
		expect(interceptId).toMatch(UUID_RE)
		expect(loadId).toBe(interceptId)
	})

	test('abort cleans up data-hop-id from previous source element', async ({ page }) => {
		await page.goto('/')
		// Start slow navigation
		page.click('a[href="/slow"]')
		await page.waitForTimeout(200)
		// Abort by navigating elsewhere
		await page.click('a[href="/fixtures/two.html"]')
		await expect(page).toHaveTitle('Two')

		// Only the current (or no) element should have data-hop-id
		const count = await page.locator('[data-hop-id]').count()
		expect(count).toBeLessThanOrEqual(1)
	})
})
