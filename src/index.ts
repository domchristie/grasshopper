type Direction = 'forward' | 'back' | 'none'
type NavigationTypeString = 'push' | 'replace' | 'traverse'
type Config = {
	from: URL,
	to: URL,
	direction: Direction,
	srcElement?: Element,
	trigger?: Event,
	navigationType: NavigationTypeString,

	method?: 'GET' | 'POST' | 'PUT' | 'DELETE',
	body?: string | FormData | URLSearchParams,
	headers?: Headers | {},
	signal: AbortSignal,

	response?: Response,
	mediaType?: string,
	text?: string,
}

let DIRECTION_ATTR = 'data-hop-direction'
let PERSIST_ATTR = 'data-hop-persist'
let DISABLED_ATTR = 'data-hop'

let started = false
let currentTransition: ViewTransition | undefined
let parser

function enabled(el: Element | Document = document) {
	if (el instanceof Document) {
		return el.querySelector('[name="hop"][content="true"]')
	} else if (el instanceof Element) {
		return !(el.closest(`[${DISABLED_ATTR}]`)?.getAttribute(DISABLED_ATTR) === 'false')
	}
}

let isHashChange = (ev) => (ev.hashChange && !ev.sourceElement) || (ev.hashChange && ev.sourceElement.matches('a[href^="#"]'))
function direction(ev) {
	if (ev.navigationType === 'traverse') {
		return ev.destination.index > navigation.currentEntry.index ? 'forward' : 'back'
	} else if (['replace', 'reload'].includes(ev.navigationType)) {
		return 'none'
	} else {
		return 'forward'
	}
}

let send = (el: Element | Document = document, type: string, detail?: any, bub?: boolean) => el.dispatchEvent(new CustomEvent("hop:" + type, { detail, cancelable: true, bubbles: bub !== false, composed: true }))

async function fetchHtml(cfg: Config): Promise<Document | undefined> {
	try {
		if (!send(cfg.srcElement, 'before', { cfg })) return
		let response = cfg.response = await fetch(cfg.to.href, cfg)

		const contentType = response.headers.get('content-type') ?? ''
		cfg.mediaType = contentType.split(';', 1)[0].trim()
		if (cfg.mediaType !== 'text/html' && cfg.mediaType !== 'application/xhtml+xml') return

		cfg.text = await response.text()
		if (!send(cfg.srcElement, 'after', {cfg})) return
	} catch(error) {
		send(cfg.srcElement, 'error', {cfg, error})
		return
	} finally {
		send(cfg.srcElement, 'finally', {cfg})
	}

	if (cfg.response.redirected) {
		const redirectedTo = new URL(cfg.response.url)
		if (redirectedTo.origin !== cfg.to.origin) return
		cfg.to = redirectedTo
	}

	parser = parser || new DOMParser()
	let newDoc = parser.parseFromString(cfg.text, cfg.mediaType)
	newDoc.querySelectorAll('noscript').forEach((el) => el.remove())

	// If ClientRouter is not enabled on the incoming page, do a full page load to it.
	// Unless this was a form submission, in which case we do not want to trigger another mutation.
	if (!enabled(newDoc) && !cfg.body) return

	const links = preloadStyles(newDoc)
	links.length && !cfg.signal.aborted && (await Promise.all(links))

	return newDoc
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
		newBody.querySelector(`#${el.id}[${PERSIST_ATTR}]`)?.replaceWith(el)
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

function scroll(from, to, ev) {
	let isRefresh = from.pathname === to.pathname && ev.navigationType === 'replace'
	let preserveScroll = isRefresh && document.querySelector('meta[name="hop-refresh-scroll"]')?.getAttribute('content') === 'preserve'
	if (!preserveScroll) {
		window.scrollTo(0, 0)
		ev.scroll()
	}
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

export async function hop(ev) {
	let from = new URL(location.href)
	let to = new URL(ev.destination.url)

	let cfg: Config = {
		from,
		to,
		direction: direction(ev),
		navigationType: ev.navigationType,
		signal: ev.signal
	}
	if (!send(cfg.srcElement, 'config', { cfg })) return

	let newDoc: Document | undefined = await fetchHtml(cfg)
	if (!newDoc) {
		location.href = cfg.to.href
		return
	}

	try {
		currentTransition?.skipTransition()
		await currentTransition?.updateCallbackDone
	} catch {
		// ignore
	}

	document.documentElement.setAttribute(DIRECTION_ATTR, cfg.direction)

	let swapped: Promise<void> = Promise.resolve()
	let transitioned: Promise<void> = Promise.resolve()
	if (document.startViewTransition) {
		currentTransition = document.startViewTransition(swap)
		swapped = currentTransition.updateCallbackDone
		transitioned = currentTransition.finished
	} else {
		swap()
	}

	swapped.finally(async () => {
		send(document, 'swapped', { cfg })
		scroll(from, to, ev)
		await runScripts()
		send(document, 'load')
		announce()
	})

	return transitioned.finally(() => {
		currentTransition = void 0
		document.documentElement.removeAttribute(DIRECTION_ATTR)
	})

	function swap() {
		if (!newDoc) return
		swapRootAttributes(newDoc)
		swapHeadElements(newDoc)
		withRestoredFocus(() => {
			swapBodyElement(newDoc.body)
		})
	}
}

// initialization
function start() {
	if (started || !enabled() || !('navigation' in window)) return

	navigation.addEventListener('navigate', function (ev) {
		let srcElement = ev.info?.srcElement || ev.sourceElement || undefined
		if (!ev.canIntercept || ev.downloadRequest || isHashChange(ev) || !enabled(srcElement)) return

		ev.intercept({
			async handler() {
				if (ev.navigationType !== 'replace' && srcElement?.closest('[data-hop-type="replace"]')) {
					return navigation.navigate(ev.destination.url, { history: 'replace', info: {srcElement} }).finished
				} else {
					await hop(ev)
				}
			},
			scroll: 'manual'
		})
	})
	started = true
}
addEventListener('DOMContentLoaded', start)
