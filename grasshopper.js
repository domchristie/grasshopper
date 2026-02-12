const MEDIA_TYPES = ['text/html', 'application/xhtml+xml']
const DIRECTION_ATTR = 'data-hop-direction'
const PERSIST_ATTR = 'data-hop-persist'
const DISABLED_ATTR = 'data-hop'
const TRACK_ATTR = 'data-hop-track'
const ID_ATTR = 'data-hop-id'
const nativePrecommit = !!self.NavigationPrecommitController

let started = false
let parser
let abortController
let viewTransition

function start() {
	if (started || !enabled() || !('navigation' in window)) return
	resetViewTransition()

	navigation.addEventListener('navigate', async function (ev) {
		abortController?.abort()
		document.querySelector(`[${ID_ATTR}]`)?.removeAttribute(ID_ATTR)

		const to = new URL(ev.destination.url)
		let { doc, response, sourceElement, id } = ev.info?.hop || {}
		sourceElement = sourceElement ?? ev.sourceElement
		id = id || crypto.randomUUID()

		const options = {
			id,
			sourceElement,
			to,
			method: ev.formData ? 'POST' : 'GET',
			body: ev.formData,
			headers: { 'x-hop-id': id },
			navEvent: ev
		}

		sourceElement?.setAttribute(ID_ATTR, id)

		if (
			!ev.canIntercept ||
			to.origin !== location.origin || // WebKit fix
			ev.info?.hop === false ||
			ev.downloadRequest ||
			isHashChange(ev) ||
			!enabled(sourceElement) ||
			!send(sourceElement, 'before-intercept', { detail: { options }, cancelable: true})
		) return

		if (!nativePrecommit && ev.navigationType !== 'traverse') {
			abortController = null
			if (!doc) {
				ev.preventDefault()
				abortController = new AbortController()
				await precommitHandler(null)
				return
			}
		}

		async function precommitHandler(controller) {
			;({ response, doc } = await fetchHTML(options) || {})

			let history = (
				(navigation.transition?.from?.url || location.href) === response.url
					|| sourceElement?.closest('[data-hop-type="replace"]')
					? 'replace'
					: ev.navigationType
			)
			let redirectTo = response.redirected && response.url

			if (nativePrecommit
				? redirectTo || history !== ev.navigationType
				: ev.navigationType !== 'traverse'
			)
				return redirect(controller,
					redirectTo || ev.destination.url, {
					history, info: { ...ev.info, hop: { doc, response, sourceElement, id } }
				})
		}

		ev.intercept({
			precommitHandler,

			async handler() {
				if (!nativePrecommit && ev.navigationType === 'traverse')
					await precommitHandler(null)

				try {
					viewTransition.skipTransition()
					await viewTransition.updateCallbackDone
				} catch { /* ignore */ }

				if (canFallback(response, ev) && trackedElementsChanged(doc))
					return navigation.reload({ info: { hop: false } })

				viewTransition = await startViewTransition(ev, async () => {
					if (!await sendInterceptable(sourceElement, 'before-swap', { detail: { options }, cancelable: true })) return
					await swap(doc, ev)
					send(sourceElement, 'after-swap', { detail: { options } })
				}, options)

				viewTransition.updateCallbackDone.finally(async () => {
					await runScripts()
					send(sourceElement, 'load', { detail: { options } })
					announce()
				})

				viewTransition.finished.finally(() => {
					sourceElement?.removeAttribute(ID_ATTR)
					send(sourceElement, 'after-transition', { detail: { options } })
					resetViewTransition()
				})

				return viewTransition.updateCallbackDone
			},
			focus: 'manual',
			scroll: 'manual'
		})
	})
	started = true
}
addEventListener('DOMContentLoaded', start)

async function fetchHTML(options) {
	try {
		options.signal = abortController === null ? null : (abortController || options.navEvent).signal

		if (!await sendInterceptable(options.sourceElement, 'before-fetch', { detail: { options }, cancelable: true })) return

		const response = await fetch(options.to.href, options)
		const contentType = response.headers.get('content-type')
		const mediaType = contentType.split(';')[0].trim()

		if (canFallback(response, options.navEvent) && !supportsMediaType(mediaType)) {
			fallback(response.url)
			return
		}
		if (response.redirected) {
			const redirectedTo = new URL(response.url)
			if (redirectedTo.origin !== options.to.origin) {
				fallback(response.url)
				return
			}
		}

		const text = await response.text()
		parser = parser || new DOMParser()
		const doc = parser.parseFromString(text, mediaType)
		doc.querySelectorAll('noscript').forEach((el) => el.remove())

		if (canFallback(response, options.navEvent) && !enabled(doc)) {
			fallback(response.url)
			return
		}

		const links = preloadStyles(doc)
		links.length && (await Promise.all(links)) // todo: signal.aborted
		send(options.sourceElement, 'fetch-load', { detail: { options } })
		return { response, doc }
	} catch(error) {
		send(options.sourceElement, 'fetch-error', { detail: { options, error } })
		return { error }
	} finally {
		send(options.sourceElement, 'fetch-end', { detail: { options } })
	}
}

function preloadStyles(doc) {
	const oldEls = [...document.querySelectorAll('head link[rel=stylesheet]')]
	const newEls = [...doc.querySelectorAll('head link[rel=stylesheet]')]

	return newEls
		.filter(newEl => !oldEls.some(oldEl => oldEl.isEqualNode(newEl))) // todo: consider persistent stylesheets
		.map((el) => {
			let link = document.createElement('link')
			link.setAttribute('rel', 'preload')
			link.setAttribute('as', 'style')
			link.setAttribute('href', el.getAttribute('href'))
			return new Promise((resolve) => {
				['load', 'error'].forEach((ev) => link.addEventListener(ev, resolve))
				document.head.append(link)
			})
		})
}

async function startViewTransition(navEvent, update, options = {}) {
	if (
		document.startViewTransition &&
		!navEvent.hasUAVisualTransition &&
		await sendInterceptable(options.sourceElement, 'before-transition', { detail: { options }, cancelable: true })
	) {
		viewTransition = document.startViewTransition(update)
	} else {
		update()
	}
	return viewTransition
}

async function swap(doc, ev) {
	swapRootAttributes(doc)
	swapHeadElements(doc)
	withRestoredFocus(() => {
		swapBodyElement(doc.body)
	})
	await scroll(ev)
}

function swapRootAttributes(doc) {
	const currentRoot = document.documentElement
	const persistedAttrs = [...currentRoot.attributes].filter(
		({ name }) => (currentRoot.removeAttribute(name), [DIRECTION_ATTR].includes(name))
	)
	const attrs = [...doc.documentElement.attributes, ...persistedAttrs]
	attrs.forEach(({ name, value }) => currentRoot.setAttribute(name, value))
}

function swapHeadElements(doc) {
	const oldEls = [...document.head.children]
	const newEls = [...doc.head.children]

	for (const oldEl of oldEls) {
		const newEl = newEls.find(newEl => newEl.isEqualNode(oldEl))
		newEl ? newEl.remove() : oldEl.remove()
	}
	flagNewScripts(doc.head.getElementsByTagName('script'))
	document.head.append(...doc.head.children)
}

function flagNewScripts(scripts) {
	for (const script of scripts) script.__new = true
}

function withRestoredFocus(callback) {
	const activeEl = document.activeElement
	if (activeEl?.closest(`[${PERSIST_ATTR}]`)) {
		if (activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement) {
			const start = activeEl.selectionStart
			const end = activeEl.selectionEnd
			callback()
			activeEl.focus()
			if (typeof start === 'number') activeEl.selectionStart = start
			if (typeof end === 'number') activeEl.selectionEnd = end
		} else {
			callback()
			activeEl.focus()
		}
	} else {
		callback()
		document.querySelector('[autofocus]')?.focus()
	}
}

function swapBodyElement(newBody) {
	const oldBody = document.body
	oldBody.replaceWith(newBody) // resets scroll position

	for (const el of oldBody.querySelectorAll(`[${PERSIST_ATTR}]`)) {
		newBody.querySelector(`#${el.id}[${PERSIST_ATTR}]`)?.replaceWith(el)
	}
	flagNewScripts(newBody.getElementsByTagName('script'))
	attachShadowRoots(newBody)
}

function attachShadowRoots(root) {
	root.querySelectorAll('template[shadowrootmode]').forEach((template) => {
		const mode = template.getAttribute('shadowrootmode')
		const parent = template.parentNode
		if ((mode === 'closed' || mode === 'open') && parent instanceof HTMLElement) {
			// Skip if shadow root already exists (e.g., from transition-persisted elements)
			if (parent.shadowRoot) {
				template.remove()
				return
			}
			const shadowRoot = parent.attachShadow({ mode })
			shadowRoot.appendChild(template.content)
			template.remove()
			attachShadowRoots(shadowRoot)
		}
	})
}

async function scroll(navEvent) {
	await sendInterceptable(document, 'before-scroll')

	const sourceElement = navEvent.info?.hop?.sourceElement ?? navEvent.sourceElement
	const isRefresh = (
		new URL(navigation.transition.from.url).pathname === new URL(location.href).pathname
			&& !!sourceElement?.closest('[data-hop-type="replace"]')
	)
	const preserveScroll = isRefresh &&
		document.querySelector('meta[name="hop-refresh-scroll"][content="preserve"]')

	if (!preserveScroll) {
		if (['push', 'replace'].includes(navEvent.navigationType))
			scrollTo(0, 0) // Fix when navigating from a scrolled page in Chrome/WebKit
		navEvent.scroll()
	}

	send(document, 'scrolled')
}

function runScripts() {
	const runnable = [...document.scripts].filter(
		script => (script).__new && script.dataset.hopEval !== 'false'
	)
	let wait = Promise.resolve()
	let needsWaitForInlineModuleScript = false
	// Inline module scripts are deferred but still executed in order.
	// They can not be awaited for with onload.
	// Thus to be able to wait for the execution of all scripts, we make sure that the last inline module script
	// is always followed by an external module script
	for (const script of runnable) {
		script.getAttribute('type') === 'module' &&
			(needsWaitForInlineModuleScript = script.getAttribute('src') === null)
	}
	needsWaitForInlineModuleScript &&
		document.body.insertAdjacentHTML(
			'beforeend',
			`<script type="module" src="data:application/javascript,"/>`,
		)

	for (const script of runnable) {
		const type = script.getAttribute('type')
		if (type && type !== 'module' && type !== 'text/javascript') continue

		const newScript = document.createElement('script')
		newScript.innerHTML = script.innerHTML
		for (const attr of script.attributes) {
			if (attr.name === 'src') {
				const p = new Promise((r) => newScript.onload = newScript.onerror = r)
				wait = wait.then(() => p)
			}
			newScript.setAttribute(attr.name, attr.value)
		}
		script.replaceWith(newScript)
	}
	return wait
}

function announce() {
	const div = document.createElement('div')
	div.setAttribute('aria-live', 'assertive')
	div.setAttribute('aria-atomic', 'true')
	Object.assign(div.style, { position: 'absolute', left: '0', top: '0', clip: 'rect(0 0 0 0)', clipPath: 'inset(50%)', overflow: 'hidden', whiteSpace: 'nowrap', width: '1px', height: '1px' })

	document.body.append(div)
	setTimeout(
		() => {
			const title = document.title || document.querySelector('h1')?.textContent || location.pathname
			div.textContent = title
		},
		60 // Delay to ensure screen readers notice the change
	)
}

// Utils
const createEvent = (type, options = {}) =>
	new CustomEvent("hop:" + type, { cancelable: false, bubbles: true, composed: true, ...options })

const target = (el) => el?.isConnected ? el : document

const send = (el, type, options = {}) =>
	target(el).dispatchEvent(createEvent(type, options))

async function sendInterceptable(el, type, options = {}) {
	let ev = createEvent(type, options)
	let intercept = () => Promise.resolve(true)
	ev.intercept = (callback) => intercept = callback
	return target(el).dispatchEvent(ev) && await intercept()
}

const resetViewTransition = () => viewTransition = {
	updateCallbackDone: Promise.resolve(),
	finished: Promise.resolve(),
	skipTransition: () => {}
}

function enabled(el) {
	if (el instanceof Element) {
		return !(el.closest(`[${DISABLED_ATTR}]`)
			?.getAttribute(DISABLED_ATTR) === 'false')
	} else {
		return (el || document).querySelector('[name="hop"][content="true"]')
	}
}

const isHashChange = (navEvent) =>
	(navEvent.hashChange && !navEvent.sourceElement) ||
	(navEvent.hashChange && navEvent.sourceElement.matches('a[href^="#"]'))

const supportsMediaType = (type) => MEDIA_TYPES.includes(type)

function trackedElementsChanged(doc) {
	const oldEls = [...document.querySelectorAll(`[${TRACK_ATTR}="reload"]`)]
	const newEls = [...doc.querySelectorAll(`[${TRACK_ATTR}="reload"]`)]

	for (const oldEl of oldEls) {
		const found = newEls.some(newEl => newEl.isEqualNode(oldEl))
		if (!found) return true
	}
	return false
}

const canFallback = (response, navEvent) =>
	response?.redirected || !navEvent.formData

// Fallback to an unintercepted navigation
function fallback(to) {
	return navigation.navigate(to, { info: { hop: false } }).finished
}

function redirect(controller, to, options = {}) {
	try {
		controller.redirect(to, options)
	} catch (e) {
		navigation.navigate(to, options)
	}
}
