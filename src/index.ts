type Direction = 'forward' | 'back'
type NavigationTypeString = 'push' | 'replace' | 'traverse'
type Config = {
	from: URL,
	to: URL,
	direction: Direction,
	srcElement?: Element,
	trigger?: Event,
	navigationType: NavigationTypeString,
	historyState?: State,

	method?: 'GET' | 'POST' | 'PUT' | 'DELETE',
	body?: string | FormData | URLSearchParams,
	headers?: Headers | {},
	signal: AbortSignal,

	response?: Response,
	mediaType?: string,
	text?: string,
}
type State = {
	index: number
	scrollX: number
	scrollY: number
}

let DIRECTION_ATTR = 'data-hop-direction'
let PERSIST_ATTR = 'data-hop-transition-persist'
let DISABLED_ATTR = 'data-hop'

let started = false

let abortController: AbortController | undefined
let currentTransition: ViewTransition | undefined

// When we traverse the history, the window.location is already set to the new location.
// This variable tells us where we came from
let currentUrl: URL = new URL(location.href)

// The History API does not tell you if navigation is forward or back, so
// you can figure it using an index. On pushState the index is incremented so you
// can use that to determine popstate if going forward or back.
let currentHistoryIndex = 0
let parser = new DOMParser()

function enabled(el: Element | Document = document) {
	if (el instanceof Document) {
		return el.querySelector('[name="hop-view-transitions-enabled"]')
	} else if (el instanceof Element) {
		return !(el.closest(`[${DISABLED_ATTR}]`)?.getAttribute(DISABLED_ATTR) === 'false')
	}
}

let samePage = (url: URL, otherUrl: URL) => url.pathname === otherUrl.pathname && url.search === otherUrl.search

let send = (el: Element | Document = document, type: string, detail?: any, bub?: boolean) => el.dispatchEvent(new CustomEvent("hop:" + type, { detail, cancelable: true, bubbles: bub !== false, composed: true }))

let leavesWindow = (ev: MouseEvent) =>
	(ev.button && ev.button !== 0) || // left clicks only
	ev.metaKey || // new tab (mac)
	ev.ctrlKey || // new tab (windows)
	ev.altKey || // download
	ev.shiftKey // new window

// form.action and form.method can point to an <input name="action"> or <input name="method">
// in which case should fallback to the form attribute
let formAttr = (form: HTMLFormElement, submitter: HTMLElement | null, attr: string, defaultVal: any) =>
	submitter?.getAttribute(`form${attr}`) ?? (form[attr] === 'string' ? form[attr] : form.getAttribute(attr)) ?? defaultVal

// only update history entries that are managed by us
// leave other entries alone and do not accidentally add state.
function saveScrollPosition() {
	if (history.state) {
		history.scrollRestoration = 'manual'
		// avoid expensive calls to history.replaceState
		if (scrollX !== history.state.scrollX || scrollY !== history.state.scrollY) {
			history.replaceState({ ...history.state, scrollX, scrollY }, '')
		}
	}
}

function announce() {
	let div = document.createElement('div')
	div.setAttribute('aria-live', 'assertive')
	div.setAttribute('aria-atomic', 'true')
	Object.assign(div.style, { position: 'absolute', left: '0', top: '0', clip: 'rect(0 0 0 0)', clipPath: 'inset(50%)', overflow: 'hidden', whiteSpace: 'nowrap', width: '1px', height: '1px' })

	document.body.append(div)
	setTimeout(
		() => {
			let title = document.title || document.querySelector('h1')?.textContent || location.pathname
			div.textContent = title
		},
		// Much thought went into this magic number; the gist is that screen readers
		// need to see that the element changed and might not do so if it happens
		// too quickly.
		60
	)
}

async function fetchHtml(config: Config): Promise<Document | undefined> {
	try {
		if (!send(config.srcElement, 'before', { config })) return
		let response = config.response = await fetch(config.to.href, config)

		const contentType = response.headers.get('content-type') ?? ''
		config.mediaType = contentType.split(';', 1)[0].trim()
		if (config.mediaType !== 'text/html' && config.mediaType !== 'application/xhtml+xml') return

		config.text = await response.text()
		if (!send(config.srcElement, 'after', {config})) return
	} catch(error) {
		send(config.srcElement, 'error', {config, error})
		return
	} finally {
		send(config.srcElement, 'finally', {config})
	}

	if (config.response.redirected) {
		const redirectedTo = new URL(config.response.url)
		if (redirectedTo.origin !== config.to.origin) return
		config.to = redirectedTo
	}

	let newDoc = parser.parseFromString(config.text, config.mediaType)
	newDoc.querySelectorAll('noscript').forEach((el) => el.remove())

	// If ClientRouter is not enabled on the incoming page, do a full page load to it.
	// Unless this was a form submission, in which case we do not want to trigger another mutation.
	if (!enabled(newDoc) && !config.body) return

	const links = preloadStyles(newDoc)
	links.length && !config.signal.aborted && (await Promise.all(links))

	return newDoc
}

function swapRootAttributes(newDoc: Document) {
	const currentRoot = document.documentElement
	const persistedAttrs = [...currentRoot.attributes].filter(
		({ name }) => (currentRoot.removeAttribute(name), [DIRECTION_ATTR].includes(name))
	)
	const attrs = [...newDoc.documentElement.attributes, ...persistedAttrs]
	attrs.forEach(({ name, value }) => currentRoot.setAttribute(name, value))
}

function swapHeadElements(newDoc: Document) {
	const oldEls = [...document.head.children]
	const newEls = [...newDoc.head.children]

	for (const oldEl of oldEls) {
		const newEl = newEls.find(newEl => newEl.isEqualNode(oldEl))
		newEl ? newEl.remove() : oldEl.remove() // todo: track element reloads
	}
	flagNewScripts(newDoc.head.getElementsByTagName('script'))
	document.head.append(...newDoc.head.children)
}

function swapBodyElement(newBody: HTMLElement) {
	const oldBody = document.body
	oldBody.replaceWith(newBody) // resets scroll position

	for (const el of oldBody.querySelectorAll(`[${PERSIST_ATTR}]`)) {
		const id = el.getAttribute(PERSIST_ATTR)
		newBody.querySelector(`[${PERSIST_ATTR}="${id}"]`)?.replaceWith(el)
	}
	flagNewScripts(newBody.getElementsByTagName('script'))
	attachShadowRoots(newBody)
}

function attachShadowRoots(root: Element | ShadowRoot) {
	root.querySelectorAll<HTMLTemplateElement>('template[shadowrootmode]').forEach((template) => {
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

function withRestoredFocus(callback: () => void) {
	const activeEl = document.activeElement as HTMLElement
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
	}
}

function flagNewScripts(scripts: HTMLCollectionOf<HTMLScriptElement>) {
	for (let script of scripts) (script as any).__new = true
}

function runScripts() {
	let runnable = [...document.scripts].filter(
		script => (script as any).__new && script.dataset.hopEval !== 'false'
	)
	let wait: Promise<any> = Promise.resolve()
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

function preloadStyles(newDoc: Document) {
	let oldEls = [...document.querySelectorAll('head link[rel=stylesheet]')]
	let newEls = [...newDoc.querySelectorAll('head link[rel=stylesheet]')]

	return newEls
		.filter(newEl => !oldEls.some(oldEl => oldEl.isEqualNode(newEl))) // todo: consider persistent stylesheets
		.map((el) => {
			let link = document.createElement('link')
			link.setAttribute('rel', 'preload')
			link.setAttribute('as', 'style')
			link.setAttribute('href', el.getAttribute('href')!)
			return new Promise((resolve) => {
				['load', 'error'].forEach((ev) => link.addEventListener(ev, resolve))
				document.head.append(link)
			})
		})
}

export async function hop(to: URL | string, options: Partial<Config>) {
	to = to instanceof URL ? to : new URL(to, location.href)
	abortController?.abort()
	abortController = new AbortController()

	// Check eligibility
	if (!enabled() || location.origin !== to.origin) {
		location.href = to.href
		return
	}

	let config: Config = {
		from: currentUrl,
		to,
		direction: 'forward',
		navigationType: options.historyState ? 'traverse' : (options.navigationType === 'replace' ? 'replace' : 'push'),
		signal: abortController.signal,
		...options
	}

	if (config.navigationType !== 'traverse') saveScrollPosition()
	if (samePage(config.from, to) && !config.body) {
		if ((config.direction !== 'back' && to.hash) || (config.direction === 'back' && config.from.hash)) {
			moveToLocation(document.title, config.historyState)
			return
		}
	}

	let newDoc: Document | undefined
	if (send(config.srcElement, 'config', { config })) {
		if (newDoc = await fetchHtml(config)) {
			if (config.navigationType === 'traverse') saveScrollPosition()
		} else {
			location.href = to.href
			return
		}
	} else {
		return
	}

	try {
		currentTransition?.skipTransition()
		await currentTransition?.updateCallbackDone
	} catch {
		// ignore
	}

	document.documentElement.setAttribute(DIRECTION_ATTR, config.direction)

	let domUpdated: Promise<void> = Promise.resolve()
	let transitionFinished: Promise<void> = Promise.resolve()
	if (document.startViewTransition) {
		// This automatically cancels any previous transition
		// We also already took care that the earlier update callback got through
		currentTransition = document.startViewTransition(
			async () => await updateDOM(newDoc, config.historyState)
		)
		domUpdated = currentTransition.updateCallbackDone
		transitionFinished = currentTransition.finished
	} else {
		await updateDOM(newDoc, config.historyState)
	}
	domUpdated.finally(async () => {
		send(document, 'swapped', { config })
		await runScripts()
		send(document, 'load')
		announce()
	})
	transitionFinished.finally(() => {
		currentTransition = void 0
		document.documentElement.removeAttribute(DIRECTION_ATTR)
	})

	async function updateDOM(newDoc: Document, historyState?: State) {
		const title = document.title
		swapRootAttributes(newDoc)
		swapHeadElements(newDoc)
		withRestoredFocus(() => {
			swapBodyElement(newDoc.body)
		})
		moveToLocation(title, historyState)
	}

	function moveToLocation(title: string, historyState?: State) {
		updateHistory(title, historyState)
		scroll(config.from, config.to, historyState)
	}

	function updateHistory(title: string, historyState?: State) {
		const { to, navigationType } = config

		const targetTitle = document.title
		document.title = title

		if (to.href !== location.href && !historyState) {
			if (navigationType === 'replace') {
				history.replaceState(history.state, '', to.href)
			} else {
				history.pushState({ index: ++currentHistoryIndex, scrollX: 0, scrollY: 0 }, '', to.href)
			}
		}
		document.title = targetTitle
		currentUrl = to
	}

	function scroll(from: URL, to: URL, historyState?: State) {
		let scrollToOpts: ScrollToOptions = { left: 0, top: 0, behavior: 'instant' }

		if (historyState) {
			scrollToOpts = { left: historyState.scrollX, top: historyState.scrollY }
		} else {
			if (to.hash) {
				// because we are already on the target page ...
				// ... what comes next is a intra-page navigation
				// that won't reload the page but instead scroll to the fragment
				history.scrollRestoration = 'auto'
				const savedState = history.state
				location.href = to.href; // this kills the history state on Firefox
				if (!history.state) {
					history.replaceState(savedState, '') // this restores the history state
					if (samePage(from, to)) window.dispatchEvent(new PopStateEvent('popstate'))
				}
				history.scrollRestoration = 'manual'
				return
			}
		}
		scrollTo(scrollToOpts)
		history.scrollRestoration = 'manual'
	}
}

// initialization
function start() {
	if (started || !enabled()) return

	let lastClickedElementLeavingWindow: EventTarget | null = null

	document.addEventListener('click', (ev) => {
		let link = ev.target
		lastClickedElementLeavingWindow = leavesWindow(ev) ? link : null

		// Check eligibility
		if (ev.composed) link = ev.composedPath()[0]
		if (link instanceof Element) link = link.closest('a, area')
		if (
			!(link instanceof HTMLAnchorElement) &&
			!(link instanceof SVGAElement) &&
			!(link instanceof HTMLAreaElement)
		) return
		const linkTarget = link instanceof SVGAElement ? link.target.baseVal : link.target
		const href = link instanceof SVGAElement ? link.href.baseVal : link.href
		if (
			!enabled(link) ||
			link.hasAttribute('download') ||
			!link.href ||
			(linkTarget && linkTarget !== '_self') ||
			new URL(href, location.href).origin !== location.origin ||
			lastClickedElementLeavingWindow ||
			ev.defaultPrevented
		) return

		ev.preventDefault()
		hop(href, {
			srcElement: link,
			navigationType: link.dataset.hopType === 'replace' ? 'replace' : undefined
		})
	})

	document.addEventListener('submit', (ev) => {
		let el = ev.target as HTMLElement
		let submitter = ev.submitter

		let clickedWithKeys = submitter && submitter === lastClickedElementLeavingWindow
		lastClickedElementLeavingWindow = null

		// Check eligibility
		if (el.tagName !== 'FORM' || ev.defaultPrevented || !enabled(el) || clickedWithKeys) return
		let form = el as HTMLFormElement
		let action = new URL(formAttr(form, submitter, 'action', location.pathname), location.href)
		let method = formAttr(form, submitter, 'method', 'get')
		let enctype = formAttr(form, submitter, 'enctype', 'application/x-www-form-urlencoded')
		if (method === 'dialog' || location.origin !== new URL(action, location.href).origin) return

		let body: FormData | URLSearchParams | undefined = new FormData(form, submitter)
		if (method === 'get') {
			let params = new URLSearchParams(body as any)
			action.search = params.toString()
			body = void 0
		} else if (enctype === 'application/x-www-form-urlencoded') {
			body = new URLSearchParams(body as any)
		}
		ev.preventDefault()
		hop(action, {
			srcElement: submitter ?? form,
			method,
			body,
			navigationType: (submitter ?? form).dataset.hopType === 'replace' ? 'replace' : undefined
		})
	})

	addEventListener('popstate', function(ev: PopStateEvent) {
		if (!enabled() && ev.state) {
			// The current page doesn't have transitions enabled
			// but the page we navigate to does (because it set the state).
			// Do a full page refresh to reload the client-side router from the new page.
			return location.reload()
		}

		// Our transition entries always have state. Ignore stateless entries.
		if (ev.state === null) return
		const state: State = history.state
		const nextIndex = state.index
		const direction: Direction = nextIndex > currentHistoryIndex ? 'forward' : 'back'
		currentHistoryIndex = nextIndex
		hop(location.href, { direction, from: currentUrl, historyState: state })
	})

	if (history.state) {
		// Here we reloaded a page with history state
		// (e.g. history navigation from non-transition page or browser reload)
		currentHistoryIndex = history.state.index
		scrollTo({ left: history.state.scrollX, top: history.state.scrollY })
	} else if (enabled()) {
		// This page is loaded from the browser address bar or via a link from extern,
		// it needs a state in the history
		history.replaceState({ index: currentHistoryIndex, scrollX, scrollY }, '')
		history.scrollRestoration = 'manual'
	}

	// There's not a good way to record scroll position before a history back
	// navigation, so we will record it when the user has stopped scrolling.
	if ('onscrollend' in window) addEventListener('scrollend', saveScrollPosition)
	else {
		let intervalId: number | undefined, lastY: number, lastX: number, lastIndex: State['index']
		function scrollInterval() {
			// Check the index to see if a popstate event was fired
			if (lastIndex !== history.state?.index) return reset()

			// Check if the user stopped scrolling
			if (lastY === scrollY && lastX === scrollX) {
				saveScrollPosition()
				return reset()
			} else {
				(lastY = scrollY), (lastX = scrollX)
			}
		}
		function reset() {
			clearInterval(intervalId)
			intervalId = void 0
		}
		// We can't know when or how often scroll events fire, so we'll just use them to start intervals
		addEventListener('scroll', function () {
			if (intervalId !== undefined) return
			(lastIndex = history.state?.index), (lastY = scrollY), (lastX = scrollX)
			intervalId = window.setInterval(scrollInterval, 50)
		})
	}
	started = true
}
addEventListener('DOMContentLoaded', start)
