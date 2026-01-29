const MEDIA_TYPES = ['text/html', 'application/xhtml+xml']
const DIRECTION_ATTR = 'data-hop-direction'
const PERSIST_ATTR = 'data-hop-persist'
const DISABLED_ATTR = 'data-hop'
const nativePrecommit = !!self.NavigationPrecommitController

let started = false
let parser
let viewTransition

function start() {
	if (started || !enabled() || !('navigation' in window)) return
	resetViewTransition()

	navigation.addEventListener('navigate', async function (ev) {
		if (
			!ev.canIntercept ||
			ev.info?.hop === false ||
			ev.downloadRequest ||
			isHashChange(ev) ||
			!enabled(ev.sourceElement) ||
			!send(ev.sourceElement, 'before-intercept')
		) return

		let newDoc = ev.info?.hop?.doc

		if (!nativePrecommit && !newDoc && ev.navigationType !== 'traverse') {
			ev.preventDefault()
			await precommitHandler(null)
			return
		}

		async function precommitHandler(controller) {
			let { response, doc } = (await fetchHTML({
				to: new URL(ev.destination.url),
				navEvent: ev
			}) || {})
			if (!response || !doc) return Promise.reject('blarg')

			newDoc = doc

			let history = ev.sourceElement?.closest('[data-hop-type="replace"]')
				? 'replace' : ev.navigationType
			if (
				(!nativePrecommit && ev.navigationType !== 'traverse') ||
				(response.redirected && response.url) ||
				history !== ev.navigationType
			)
				return redirect(controller,
					(response.redirected && response.url) || ev.destination.url, {
					history, info: { ...ev.info, hop: { doc } }
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

				viewTransition = startViewTransition(() => swap(newDoc, ev))

				viewTransition.updateCallbackDone.finally(async () => {
					await runScripts()
					send(document, 'loaded')
					announce()
				})

				viewTransition.finished.finally(() => {
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
	options.method = options.navEvent.formData ? 'POST' : 'GET'
	options.body = options.navEvent.formData

	let response, mediaType, text
	try {
		// TODO before-fetch event
		response = await fetch(options.to.href, options)

		if (!supportsMediaType(mediaType = response.headers.get('content-type'))) {
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

		text = await response.text()
		// TODO fetched event
	} catch(e) {
		// TODO fetch-errored event
		throw e
	} finally {
		// TODO fetch-done event
	}

	parser = parser || new DOMParser()
	const doc = parser.parseFromString(text, mediaType)
	doc.querySelectorAll('noscript').forEach((el) => el.remove())

	// If ClientRouter is not enabled on the incoming page, do a full page load to it.
	// Unless this was a form submission, in which case we do not want to trigger another mutation.
	if (!enabled(doc) && !options.body) {
		fallback(response.url)
		return
	}

	const links = preloadStyles(doc)
	links.length && (await Promise.all(links)) // todo: signal.aborted

	return { response, doc }
}

function preloadStyles(newDoc) {
	const oldEls = [...document.querySelectorAll('head link[rel=stylesheet]')]
	const newEls = [...newDoc.querySelectorAll('head link[rel=stylesheet]')]

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

function startViewTransition(update) {
	if (document.startViewTransition) {
		viewTransition = document.startViewTransition(update)
	} else {
		update()
	}
	return viewTransition
}

async function swap(newDoc, ev) {
	swapRootAttributes(newDoc)
	swapHeadElements(newDoc)
	withRestoredFocus(() => {
		swapBodyElement(newDoc.body)
	})
	await scroll(ev)
}

function swapRootAttributes(newDoc) {
	const currentRoot = document.documentElement
	const persistedAttrs = [...currentRoot.attributes].filter(
		({ name }) => (currentRoot.removeAttribute(name), [DIRECTION_ATTR].includes(name))
	)
	const attrs = [...newDoc.documentElement.attributes, ...persistedAttrs]
	attrs.forEach(({ name, value }) => currentRoot.setAttribute(name, value))
}

function swapHeadElements(newDoc) {
	const oldEls = [...document.head.children]
	const newEls = [...newDoc.head.children]

	for (const oldEl of oldEls) {
		const newEl = newEls.find(newEl => newEl.isEqualNode(oldEl))
		newEl ? newEl.remove() : oldEl.remove() // todo: track element reloads
	}
	flagNewScripts(newDoc.head.getElementsByTagName('script'))
	document.head.append(...newDoc.head.children)
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
	scrollTo(0, 0) // Fix when navigating from a scrolled page in Chrome/Safari
	navEvent.scroll()
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
		// Much thought went into this magic number; the gist is that screen readers
		// need to see that the element changed and might not do so if it happens
		// too quickly.
		60
	)
}

// Utils
const createEvent = (type, detail) =>
	new CustomEvent("hop:" + type, { detail, cancelable: true, bubbles: true, composed: true })

const send = (el, type, detail = {}) =>
	(el || document).dispatchEvent(createEvent(type, detail))

async function sendInterceptable(el, type, detail = {}) {
	let ev = createEvent(type, detail)
	let intercept = () => Promise.resolve(true)
	ev.intercept = (callback) => intercept = callback
	return (el || document).dispatchEvent(ev) && await intercept()
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

// Fallback to an unintercepted navigation
function fallback(to) {
	return navigation.navigate(to, { info: { hop: false } }).finished
}

// TODO figure out handling of non-controller case
function redirect(controller, to, options = {}) {
	try {
		controller.redirect(to, options)
	} catch (e) {
		navigation.navigate(to, { ...options, hop: { redirect: true } })
	}
}
