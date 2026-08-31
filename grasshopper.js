const PERSIST_ATTR = 'data-hop-persist'
const DISABLED_ATTR = 'data-hop'
const TRACK_ATTR = 'data-hop-track'
const ID_ATTR = 'data-hop-id'
const nativePrecommit = !!self.NavigationPrecommitController
class FetchAbort extends Error {}

let started = false
let parser
let abortController
let viewTransition

export function start() {
	if (started || !enabled() || !('navigation' in window)) return
	resetViewTransition()
	navigation.addEventListener('navigate', onNavigate)
	started = true
}

export function stop() {
	if (!started) return
	navigation.removeEventListener('navigate', onNavigate)
	abortController?.abort()
	started = false
}

async function onNavigate(ev) {
	abortController?.abort()
	document.querySelector(`[${ID_ATTR}]`)?.removeAttribute(ID_ATTR)

	const canPrecommit = nativePrecommit && ev.cancelable
	let { id = crypto.randomUUID() } = ev.info?.hop || {}

	const hop = {
		id,
		from: new URL(location.href),
		to: new URL(ev.destination.url),
		method: ev.formData ? 'POST' : 'GET',
		body: ev.formData,
		headers: { 'x-hop-id': id },
		sourceElement: ev.sourceElement,
		...(ev.info?.hop || {}),
		navEvent: ev // prevent stale navEvent forwarded from a non-precommit flow
	}

	if (
		!ev.canIntercept ||
		ev.downloadRequest ||
		isSamePageHash(hop.from, hop.to, hop.sourceElement) ||
		!enabled(hop.sourceElement) ||
		!send(hop.sourceElement, 'before-intercept', { detail: { hop }, cancelable: true })
	) return

	hop.sourceElement?.setAttribute(ID_ATTR, id)

	if (!canPrecommit && ev.navigationType !== 'traverse') {
		abortController = null
		if (!hop.doc) {
			ev.preventDefault()
			abortController = new AbortController()
			try { await precommitHandler(null) } catch { /* aborted or failed before commit; already prevented */ }
			return
		}
	}

	async function precommitHandler(controller) {
		if (!hop.doc) Object.assign(hop, await fetchHTML(hop))

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

			if (canFallback(hop.response, ev) && trackedElementsChanged(hop.doc))
				return stop(), navigation.reload()

			viewTransition = await startViewTransition(async () => {
				await swap(hop)
				await scroll(hop)
			}, hop)

			viewTransition.updateCallbackDone.finally(async () => {
				await runScripts()
				send(hop.sourceElement, 'load', { detail: { hop } })
			})

			viewTransition.finished.finally(() => {
				hop.sourceElement?.removeAttribute(ID_ATTR)
				send(hop.sourceElement, 'after-transition', { detail: { hop } })
				resetViewTransition()
			})

			return viewTransition.updateCallbackDone
		},
		focus: 'manual',
		scroll: 'manual'
	})
}
addEventListener('DOMContentLoaded', start)

async function fetchHTML(hop) {
	try {
		hop.signal = abortController === null ? null : (abortController || hop.navEvent).signal

		if (!await sendInterceptable(hop.sourceElement, 'before-fetch', { detail: { hop }, cancelable: true }))
			throw new FetchAbort()
		send(hop.sourceElement, 'fetch-start', { detail: { hop } })

		const response = await fetch(hop.to.href, hop)
		const contentType = response.headers.get('content-type')
		const mediaType = contentType?.split(';')[0].trim()

		if (canFallback(response, hop.navEvent) && !supportsMediaType(mediaType)) {
			fallback(response.url)
			throw new FetchAbort()
		}
		if (response.redirected) {
			const redirectedTo = new URL(response.url)
			if (redirectedTo.origin !== hop.to.origin) {
				fallback(response.url)
				throw new FetchAbort()
			}
		}

		const text = await response.text()
		parser = parser || new DOMParser()
		const doc = parser.parseFromString(text, mediaType)
		doc.querySelectorAll('noscript').forEach((el) => el.remove())

		if (canFallback(response, hop.navEvent) && !enabled(doc)) {
			fallback(response.url)
			throw new FetchAbort()
		}

		const links = preloadStyles(doc)
		links.length && (await Promise.all(links)) // todo: signal.aborted
		send(hop.sourceElement, 'fetch-load', { detail: { hop } })
		return { response, doc }
	} catch(error) {
		if (!(error instanceof FetchAbort)) send(hop.sourceElement, 'fetch-error', { detail: { hop, error } })
		throw error
	} finally {
		send(hop.sourceElement, 'fetch-end', { detail: { hop } })
	}
}

function preloadStyles(doc) {
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
			return new Promise((resolve) => {
				['load', 'error'].forEach((ev) => link.addEventListener(ev, resolve))
				document.head.append(link)
			})
		})
}

async function startViewTransition(update, hop = {}) {
	if (
		document.startViewTransition &&
		!hop.navEvent.hasUAVisualTransition &&
		await sendInterceptable(hop.sourceElement, 'before-transition', { detail: { hop }, cancelable: true })
	) {
		viewTransition = document.startViewTransition(update)
	} else {
		await update()
	}
	return viewTransition
}

async function swap(hop) {
	if (!await sendInterceptable(hop.sourceElement, 'before-swap', { detail: { hop }, cancelable: true })) return
	swapRootAttributes(hop.doc)
	swapHeadElements(hop.doc)
	withRestoredFocus(() => {
		replace(document.body, hop.doc.body)
	})
	send(hop.sourceElement, 'after-swap', { detail: { hop } })
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
	if (!await sendInterceptable(hop.sourceElement, 'before-scroll', { detail: { hop }, cancelable: true })) return

	const isRefresh = (
		hop.from.pathname === new URL(location.href).pathname
			&& !!hop.sourceElement?.closest('[data-hop-type="replace"]')
	)
	if (isRefresh && document.querySelector('meta[name="hop-refresh-scroll"][content="preserve"]')) return

	// Fix when navigating from a scrolled page in Chrome/WebKit
	if (['push', 'replace'].includes(hop.navEvent.navigationType)) scrollTo(0, 0)
	hop.navEvent.scroll()

	send(hop.sourceElement, 'after-scroll', { detail: { hop } })
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

const send = (el, type, options = {}) =>
	target(el).dispatchEvent(createEvent(type, options))

async function sendInterceptable(el, type, options = {}) {
	let ev = createEvent(type, options)
	let intercept = () => Promise.resolve(true)
	ev.intercept = (callback) => intercept = callback
	return target(el).dispatchEvent(ev) && (await intercept(), !ev.defaultPrevented)
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

function isSamePageHash(from, to, sourceElement) {
	if (sourceElement && !sourceElement.getAttribute('href')?.startsWith('#')) return false
	if (!from.href.includes('#') && !to.href.includes('#')) return false
	return from.pathname === to.pathname && from.search === to.search
}

const supportsMediaType = (type) =>
	['text/html', 'application/xhtml+xml'].includes(type)

function trackedElementsChanged(doc) {
	const oldEls = [...document.querySelectorAll(`[${TRACK_ATTR}="reload"]`)]
	const newEls = [...doc.querySelectorAll(`[${TRACK_ATTR}="reload"]`)]
	return oldEls.some(oldEl => !newEls.some(newEl => newEl.isEqualNode(oldEl)))
}

const canFallback = (response, navEvent) =>
	response?.redirected || !navEvent.formData

const fallback = (to) => (stop(), navigation.navigate(to))

function redirect(controller, to, options = {}) {
	try {
		controller.redirect(to, options)
	} catch (e) {
		navigation.navigate(to, options)
	}
}
