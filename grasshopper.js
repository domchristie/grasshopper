const PERSIST_ATTR = 'data-hop-persist'
const DISABLED_ATTR = 'data-hop'
const TRACK_ATTR = 'data-hop-track'
const DEFAULT_TIMEOUT = 60000
const nativePrecommit = !!self.NavigationPrecommitController

let started = false
let parser
let abortController
let viewTransition
let bypass
let currentHop

export function start() {
	if (started || !enabled() || !('navigation' in window)) return
	resetViewTransition()
	navigation.addEventListener('navigate', onNavigate)
	started = true
}

export function stop() {
	if (!started) return
	navigation.removeEventListener('navigate', onNavigate)
	abortController?.abort(new DOMException('Stopped', 'AbortError'))
	started = false
}

async function onNavigate(ev) {
	if (bypass) return
	const oldAbortController = abortController
	abortController = new AbortController()
	oldAbortController?.abort(new DOMException('Navigation was superseded', 'AbortError'))

	const canPrecommit = nativePrecommit && ev.cancelable
	let { id = crypto.randomUUID(), doc } = ev.info?.hop || {}

	// a non-precommit engine cancels the navigation, then re-issues it after the load
	const willPrevent = !canPrecommit && ev.navigationType !== 'traverse' && !doc

	const hop = {
		id,
		timeout: DEFAULT_TIMEOUT,
		from: new URL(location.href),
		to: new URL(ev.destination.url),
		method: ev.formData ? 'POST' : 'GET',
		body: ev.formData,
		headers: { 'x-hop-id': id },
		sourceElement: ev.sourceElement,
		direction: direction(ev),
		...(ev.info?.hop || {}),
		// all three override a stale value forwarded from a non-precommit flow
		navEvent: ev,
		signal: willPrevent // preventDefault() aborts ev.signal, so that path uses our controller alone
			? abortController.signal
			: AbortSignal.any([abortController.signal, ev.signal]),
		abort: abortController.abort.bind(abortController)
	}

	if (
		!ev.canIntercept ||
		ev.downloadRequest ||
		isSamePageHash(hop.from, hop.to, hop.sourceElement) ||
		!enabled(hop.sourceElement) ||
		// before-intercept is cancelable but synchronous, and fires before the
		// hop is accepted, so it can't use send()/sendInterceptable()
		!target(hop.sourceElement).dispatchEvent(createEvent('before-intercept', { detail: { hop }, cancelable: true }))
	) {
		abortController = oldAbortController
		return
	}

	currentHop = hop

	if (willPrevent) {
		ev.preventDefault()
		try { await precommitHandler(null) } catch { /* aborted or failed before commit; already prevented */ }
		return
	}

	async function precommitHandler(controller) {
		if (!hop.doc) await loadDoc(hop)

		let history = (
			hop.from.href === hop.response?.url || hop.sourceElement?.closest('[data-hop-type="replace"]')
				? 'replace'
				: ev.navigationType
		)
		let redirectTo = hop.response?.redirected && hop.response?.url

		if (canPrecommit
			? redirectTo || history !== ev.navigationType
			: ev.navigationType !== 'traverse'
		)
			return redirect(controller,
				redirectTo || ev.destination.url, {
				history, info: { ...ev.info, hop }
			})
	}

	ev.intercept({
		...(canPrecommit && { precommitHandler }),

		async handler() {
			if (!canPrecommit && ev.navigationType === 'traverse')
				await precommitHandler(null)

			try {
				viewTransition.skipTransition()
				await viewTransition.updateCallbackDone
			} catch { /* ignore */ }

			hop.signal.throwIfAborted()

			if (canFallback(hop.response, ev) && trackedElementsChanged(hop.doc))
				return withBypass(() => location.reload())

			const transition = await startViewTransition({
				update: async () => (await swap(hop), await scroll(hop)),
				types: [hop.direction]
			}, hop)

			transition.ready.catch(() => {})

			// catch first: a failed transition is already reported through this
			// handler's return value, but our own failures below are not
			transition.updateCallbackDone.catch(() => {}).then(async () => {
				await runScripts()
				if (currentHop !== hop) return
				send(hop, 'load')
			})

			transition.finished.catch(() => {}).then(() => {
				if (currentHop !== hop) return
				send(hop, 'after-transition')
				resetViewTransition()
			})

			return transition.updateCallbackDone
		},
		focus: 'manual',
		scroll: 'manual'
	})
}
addEventListener('DOMContentLoaded', start)

async function loadDoc(hop) {
	const timer = hop.timeout && setTimeout(
		() => hop.abort(new DOMException('Navigation timed out', 'TimeoutError')),
		hop.timeout
	)
	try {
		if (!await sendInterceptable(hop, 'before-fetch'))
			throw new DOMException('before-fetch was cancelled', 'AbortError')
		send(hop, 'fetch-start')

		hop.response = await fetch(hop.to.href, hop)

		if (!await sendInterceptable(hop, 'before-response'))
			throw new DOMException('before-response was cancelled', 'AbortError')

		if ([204, 205].includes(hop.response.status))
			throw new DOMException(`Response status is: ${hop.response.status}`, 'AbortError')
		const contentType = hop.response.headers.get('content-type')
		const mediaType = contentType?.split(';')[0].trim()
		const contentDisposition = hop.response.headers.get('content-disposition')
		if (isAttachment(contentDisposition))
			throw await tryFallback(hop, `Response is an attachment: ${contentDisposition}`, 'NotSupportedError', 'attachment')
		if (!supportsMediaType(mediaType))
			throw await tryFallback(hop, `Unsupported media type: ${mediaType}`, 'NotSupportedError', 'unsupported-media-type')
		if (hop.response.redirected) {
			const redirectedTo = new URL(hop.response.url)
			if (redirectedTo.origin !== hop.to.origin)
				throw await tryFallback(hop, `Redirected to a different origin: ${redirectedTo.origin}`, 'SecurityError', 'cross-origin-redirect')
		}

		const text = await hop.response.text()
		parser = parser || new DOMParser()
		hop.doc = parser.parseFromString(text, mediaType)
		hop.doc.querySelectorAll('noscript').forEach((el) => el.remove())

		if (!enabled(hop.doc))
			throw await tryFallback(hop, 'Destination document has disabled Grasshopper', 'NotAllowedError', 'disabled')

		await until(Promise.all(preloadStyles(hop.doc, hop.signal)), hop.signal)
		send(hop, 'fetch-load')
	} catch(error) {
		cancelBody(hop.response?.body)
		// WebKit rejects with a generic AbortError rather than the signal's
		// reason, so when the signal aborted, trust it over the thrown error
		const cause = hop.signal.aborted ? hop.signal.reason : error
		if (cause?.name === 'TimeoutError' || !(hop.signal.aborted || cause instanceof DOMException))
			send(hop, 'fetch-error', { error: cause })
		throw cause
	} finally {
		clearTimeout(timer)
		send(hop, 'fetch-end')
	}
}

function preloadStyles(doc, signal) {
	if (signal.aborted) return []

	const oldEls = [...document.querySelectorAll('head link[rel=stylesheet]')]
	const newEls = [...doc.querySelectorAll('head link[rel=stylesheet]')]

	for (const el of oldEls) el.removeAttribute('nonce')
	for (const el of newEls) el.removeAttribute('nonce')

	return newEls
		.filter(newEl => !oldEls.some(oldEl => oldEl.isEqualNode(newEl))) // todo: consider persistent stylesheets
		.map((el) => {
			let link = document.createElement('link')
			link.setAttribute('rel', 'preload')
			link.setAttribute('as', 'style')
			link.setAttribute('href', el.getAttribute('href'))
			const done = new AbortController()
			return new Promise((resolve) => {
				for (const type of ['load', 'error']) link.addEventListener(type, resolve, { signal: done.signal })
				signal.addEventListener('abort', () => link.remove(), { once: true, signal: done.signal })
				document.head.append(link)
			}).finally(() => done.abort())
		})
}

async function startViewTransition(options, hop) {
	if (
		document.startViewTransition &&
		!hop.navEvent.hasUAVisualTransition &&
		await sendInterceptable(hop, 'before-transition')
	) return viewTransition = document.startViewTransition(options)

	const done = options.update()
	const transition = viewTransition = {
		ready: done,
		updateCallbackDone: done,
		finished: done,
		skipTransition: () => {}
	}
	return await done, transition
}

async function swap(hop) {
	if (!await sendInterceptable(hop, 'before-swap')) return
	swapRootAttributes(hop.doc)
	swapHeadElements(hop.doc)
	withRestoredFocus(() => {
		replace(document.body, hop.doc.body)
	})
	send(hop, 'after-swap')
}

function swapRootAttributes(doc) {
	const currentRoot = document.documentElement
	for (const { name } of [...currentRoot.attributes]) currentRoot.removeAttribute(name)
	for (const { name, value } of doc.documentElement.attributes) currentRoot.setAttribute(name, value)
}

function swapHeadElements(doc) {
	const oldEls = [...document.head.children]
	const newEls = [...doc.head.children]

	for (const oldEl of oldEls) {
		oldEl.removeAttribute('nonce')
		const newEl = newEls.find(newEl => (newEl.removeAttribute('nonce'), newEl.isEqualNode(oldEl)))
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
			callback(), activeEl.focus()
			if (typeof start === 'number') activeEl.selectionStart = start
			if (typeof end === 'number') activeEl.selectionEnd = end
		} else callback(), activeEl.focus()
	} else callback(), document.querySelector('[autofocus]')?.focus()
}

export function replace(oldEl, newEl) {
	oldEl.replaceWith(newEl)

	for (const el of oldEl.querySelectorAll(`[${PERSIST_ATTR}]`)) {
		el.id && newEl.querySelector(`#${el.id}[${PERSIST_ATTR}]`)?.replaceWith(el)
	}
	flagNewScripts(newEl.getElementsByTagName('script'))
	attachShadowRoots(newEl)
}

function attachShadowRoots(root) {
	root.querySelectorAll('template[shadowrootmode]').forEach((template) => {
		const mode = template.getAttribute('shadowrootmode')
		const parent = template.parentNode
		if ((mode === 'closed' || mode === 'open') && parent instanceof HTMLElement) {
			// Skip if shadow root already exists (e.g., from transition-persisted elements)
			if (parent.shadowRoot) return template.remove()

			const shadowRoot = parent.attachShadow({ mode })
			shadowRoot.appendChild(template.content)
			template.remove()
			attachShadowRoots(shadowRoot)
		}
	})
}

async function scroll(hop) {
	if (hop.scroll === 'preserve') return
	if (!await sendInterceptable(hop, 'before-scroll')) return

	const isRefresh = (
		hop.from.pathname === new URL(location.href).pathname
			&& !!hop.sourceElement?.closest('[data-hop-type="replace"]')
	)
	if (isRefresh && document.querySelector('meta[name="hop-refresh-scroll"][content="preserve"]')) return

	// Fix when navigating from a scrolled page in Chrome/WebKit
	if (['push', 'replace'].includes(hop.navEvent.navigationType)) scrollTo(0, 0)
	hop.navEvent.scroll()

	send(hop, 'after-scroll')
}

export function runScripts() {
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
	if (needsWaitForInlineModuleScript) {
		document.body.insertAdjacentHTML(
			'beforeend',
			`<script type="module" src="data:application/javascript,"/>`,
		)
		const syncScript = document.body.lastElementChild
		syncScript.__new = true
		runnable.push(syncScript)
	}

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

// Utils
const createEvent = (type, options = {}) =>
	new CustomEvent("hop:" + type, { cancelable: false, bubbles: true, composed: true, ...options })

const target = (el) => el?.isConnected ? el : document

const send = (hop, type, detail) =>
	target(hop.sourceElement).dispatchEvent(createEvent(type, { detail: { hop, ...detail } }))

async function sendInterceptable(hop, type, detail) {
	const ev = createEvent(type, { detail: { hop, ...detail }, cancelable: true })
	const callbacks = []
	ev.intercept = (callback) => callbacks.push(callback)

	hop.signal.throwIfAborted()
	if (!target(hop.sourceElement).dispatchEvent(ev)) return false
	await until(Promise.all(callbacks.map(cb => cb())), hop.signal)
	hop.signal.throwIfAborted()

	return !ev.defaultPrevented
}

const resetViewTransition = () => viewTransition = {
	ready: Promise.resolve(),
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

function isSamePageHash(from, to, sourceElement) {
	if (sourceElement && !sourceElement.getAttribute('href')?.startsWith('#')) return false
	if (!from.href.includes('#') && !to.href.includes('#')) return false
	return from.pathname === to.pathname && from.search === to.search
}

function direction({ navigationType, destination, sourceElement }) {
	if (sourceElement?.closest('[data-hop-type="replace"]')) return 'none'
	if (navigationType === 'push') return 'forward'
	if (navigationType !== 'traverse') return 'none'
	const from = navigation.currentEntry.index
	return destination.index > from ? 'forward' : destination.index < from ? 'back' : 'none'
}

const supportsMediaType = (type) =>
	['text/html', 'application/xhtml+xml'].includes(type)

const isAttachment = (contentDisposition) =>
	/^\s*attachment\b/i.test(contentDisposition || '')

function trackedElementsChanged(doc) {
	const oldEls = [...document.querySelectorAll(`[${TRACK_ATTR}="reload"]`)]
	const newEls = [...doc.querySelectorAll(`[${TRACK_ATTR}="reload"]`)]
	return oldEls.some(oldEl => !newEls.some(newEl => newEl.isEqualNode(oldEl)))
}

async function tryFallback(hop, message, name, reason) {
	const error = new DOMException(message, name)
	try {
		if (await sendInterceptable(hop, 'before-fallback', { error, reason })
			&& canFallback(hop.response, hop.navEvent))
			fallback(hop.response?.url || hop.to.href)
	} finally {
		cancelBody(hop.response?.body)
	}
	return error
}

const canFallback = (response, navEvent) =>
	response?.redirected || !navEvent.formData

function withBypass(navigate) {
	bypass = true
	try { return navigate() } finally { bypass = false }
}

const fallback = (to) => withBypass(() => location.assign(to))

const cancelBody = (body) => body?.cancel().catch(() => {})

function until(promise, signal) {
	signal.throwIfAborted()
	const controller = new AbortController()
	return Promise.race([promise, new Promise((_, reject) =>
		signal.addEventListener('abort', () => reject(signal.reason),
			{ once: true, signal: controller.signal })
	)]).finally(() => controller.abort())
}

function redirect(controller, to, options = {}) {
	try {
		controller.redirect(to, options)
	} catch (e) {
		navigation.navigate(to, options)
	}
}
