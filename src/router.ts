import { swap } from './swap-functions.js';
import { PERSIST_ATTR, DIRECTION_ATTR } from './attrs.js';

type Direction = 'forward' | 'back';
type NavigationTypeString = 'push' | 'replace' | 'traverse';
type Options = {
	srcElement?: Element
	trigger?: Event
	method?: 'get' | 'post'
	history?: 'auto' | 'push' | 'replace'
	body?: string | FormData | URLSearchParams
};
type Config = {
	from: URL,
	to: URL,
	direction: Direction,
	srcElement?: Element,
	trigger?: Event,
	navigationType: NavigationTypeString,

	method?: 'GET' | 'POST' | 'PUT' | 'DELETE',
	body?: string | ArrayBuffer | Blob | DataView | File | FormData | URLSearchParams | ReadableStream,
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

let abortController: AbortController | undefined;
let currentTransition: ViewTransition | undefined;

// When we traverse the history, the window.location is already set to the new location.
// This variable tells us where we came from
let currentUrl: URL = new URL(location.href);

// The History API does not tell you if navigation is forward or back, so
// you can figure it using an index. On pushState the index is incremented so you
// can use that to determine popstate if going forward or back.
let currentHistoryIndex = 0
let parser = new DOMParser()

let enabled = (doc: Document = document) => !!doc.querySelector('[name="astro-view-transitions-enabled"]')

let samePage = (url: URL, otherUrl: URL) => url.pathname === otherUrl.pathname && url.search === otherUrl.search

let send = (elt: Element | Document = document, type: string, detail?: any, bub?: boolean) => elt.dispatchEvent(new CustomEvent("hop:" + type, {detail, cancelable:true, bubbles:bub !== false, composed:true}));

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

	div.className = 'astro-route-announcer'
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

function runScripts() {
  let runnable = [...document.scripts].filter(
    script => (script as any).__new && script.dataset.astroEval !== 'false'
  )
	let wait: Promise<any> = Promise.resolve();
	let needsWaitForInlineModuleScript = false;
	// Inline module scripts are deferred but still executed in order.
	// They can not be awaited for with onload.
	// Thus to be able to wait for the execution of all scripts, we make sure that the last inline module script
	// is always followed by an external module script
	for (const script of runnable) {
		script.getAttribute('type') === 'module' &&
			(needsWaitForInlineModuleScript = script.getAttribute('src') === null);
	}
	needsWaitForInlineModuleScript &&
		document.body.insertAdjacentHTML(
			'beforeend',
			`<script type="module" src="data:application/javascript,"/>`,
		);

	for (const script of runnable) {
		const type = script.getAttribute('type')
		if (type && type !== 'module' && type !== 'text/javascript') continue

		const newScript = document.createElement('script');
		newScript.innerHTML = script.innerHTML;
		for (const attr of script.attributes) {
			if (attr.name === 'src') {
				const p = new Promise((r) => newScript.onload = newScript.onerror = r)
				wait = wait.then(() => p)
			}
			newScript.setAttribute(attr.name, attr.value);
		}
		script.replaceWith(newScript);
	}
	return wait;
}

// Add a new entry to the browser history. This also sets the new page in the browser address bar.
// Sets the scroll position according to the hash fragment of the new location.
const moveToLocation = (
	config: Config,
	pageTitleForBrowserHistory: string,
	historyState?: State,
) => {
	const { from, to, navigationType } = config;
	const intraPage = samePage(from, to);

	const targetPageTitle = document.title;
	document.title = pageTitleForBrowserHistory;

	if (to.href !== location.href && !historyState) {
		if (navigationType === 'replace') {
			history.replaceState(history.state, '', to.href)
		} else {
			history.pushState({ index: ++currentHistoryIndex, scrollX: 0, scrollY: 0 }, '', to.href)
		}
	}
	document.title = targetPageTitle;
	// now we are on the new page for non-history navigation!
	// (with history navigation page change happens before popstate is fired)
	currentUrl = to;

	// freshly loaded pages start from the top
	let scrolledToTop = false;
	if (!intraPage) {
		scrollTo({ left: 0, top: 0, behavior: 'instant' });
		scrolledToTop = true;
	}

	if (historyState) {
		scrollTo(historyState.scrollX, historyState.scrollY);
	} else {
		if (to.hash) {
			// because we are already on the target page ...
			// ... what comes next is a intra-page navigation
			// that won't reload the page but instead scroll to the fragment
			history.scrollRestoration = 'auto';
			const savedState = history.state;
			location.href = to.href; // this kills the history state on Firefox
			if (!history.state) {
				history.replaceState(savedState, ''); // this restores the history state
				if (intraPage) {
					window.dispatchEvent(new PopStateEvent('popstate'));
				}
			}
		} else {
			if (!scrolledToTop) {
				scrollTo({ left: 0, top: 0, behavior: 'instant' });
			}
		}
		history.scrollRestoration = 'manual';
	}
};

function preloadStyleLinks(newDocument: Document) {
	const links: Promise<any>[] = [];
	for (const el of newDocument.querySelectorAll('head link[rel=stylesheet]')) {
		// Do not preload links that are already on the page.
		if (
			!document.querySelector(
				`[${PERSIST_ATTR}="${el.getAttribute(
					PERSIST_ATTR,
				)}"], link[rel=stylesheet][href="${el.getAttribute('href')}"]`,
			)
		) {
			const c = document.createElement('link');
			c.setAttribute('rel', 'preload');
			c.setAttribute('as', 'style');
			c.setAttribute('href', el.getAttribute('href')!);
			links.push(
				new Promise<any>((resolve) => {
					['load', 'error'].forEach((evName) => c.addEventListener(evName, resolve));
					document.head.append(c);
				}),
			);
		}
	}
	return links;
}

// replace head and body of the windows document with contents from newDocument
// if !popstate, update the history entry and scroll position according to toLocation
// if popState is given, this holds the scroll position for history navigation
async function updateDOM(newDoc: Document, config: Config, historyState?: State) {
	swap(newDoc)
	moveToLocation(config, document.title, historyState);
}

async function transition(
	direction: Direction,
	from: URL,
	to: URL,
	options: Options,
	historyState?: State,
) {
	abortController?.abort()
	abortController = new AbortController()

	// Check eligibility
	if (!enabled() || location.origin !== to.origin) {
		location.href = to.href
		return
	}

	let config: Config = {
		from,
		to,
		direction,
		navigationType: historyState ? 'traverse' : (options.history === 'replace' ? 'replace' : 'push'),
		srcElement: options.srcElement,
		signal: abortController.signal,
		body: options.body,
	};

	if (config.navigationType !== 'traverse') saveScrollPosition()
	if (samePage(from, to) && !options.body) {
		if ((direction !== 'back' && to.hash) || (direction === 'back' && from.hash)) {
			moveToLocation(config, document.title, historyState)
			return
		}
	}

	let newDoc: Document | undefined;
	if (send(config.srcElement, 'config', { config })) {
		if (newDoc = await fetchHtml()) {
			if (config.navigationType === 'traverse') saveScrollPosition()
		} else {
			location.href = to.href
			return
		}
	} else {
		return
	}

	async function fetchHtml(): Promise<Document | undefined> {
		try {
			if (!send(config.srcElement, 'before', { config })) return
			let response = config.response = await fetch(config.to.href, config)

			const contentType = response.headers.get('content-type') ?? '';
			config.mediaType = contentType.split(';', 1)[0].trim();
			if (config.mediaType !== 'text/html' && config.mediaType !== 'application/xhtml+xml') return

			config.text = await response.text();
			if (!send(config.srcElement, 'after', {config})) return
		} catch(error) {
			send(config.srcElement, 'error', {config, error})
			return
		} finally {
			send(config.srcElement, 'finally', {config})
		}

		if (config.response.redirected) {
			const redirectedTo = new URL(config.response.url);
			if (redirectedTo.origin !== config.to.origin) return;
			config.to = redirectedTo;
		}

		let newDoc = parser.parseFromString(config.text, config.mediaType);
		newDoc.querySelectorAll('noscript').forEach((el) => el.remove());

		// If ClientRouter is not enabled on the incoming page, do a full page load to it.
		// Unless this was a form submission, in which case we do not want to trigger another mutation.
		if (!enabled(newDoc) && !config.body) return

		const links = preloadStyleLinks(newDoc);
		links.length && !config.signal.aborted && (await Promise.all(links));

		return newDoc
	}

	try {
		currentTransition?.skipTransition()
	} catch {
		// ignore
	}

	document.documentElement.setAttribute(DIRECTION_ATTR, config.direction);

	let domUpdated: Promise<void> = Promise.resolve()
	let transitionFinished: Promise<void> = Promise.resolve()
	if (document.startViewTransition) {
		// This automatically cancels any previous transition
		// We also already took care that the earlier update callback got through
		currentTransition = document.startViewTransition(
			async () => await updateDOM(newDoc, config, historyState)
		)
		domUpdated = currentTransition.updateCallbackDone
		transitionFinished = currentTransition.finished
	} else {
		await updateDOM(newDoc, config, historyState)
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
}

export async function navigate(to: string | URL, options?: Options) {
	const config = {
		from: currentUrl,
		to: typeof to === 'string' ? new URL(to, location.href) : to,
		direction: 'forward',
		trigger: options?.trigger,
		srcElement: options?.srcElement ?? document,
		method: options?.method ?? 'get'
	}
	await transition('forward', currentUrl, config.to, options ?? {});
}

// initialization
addEventListener('DOMContentLoaded', function() {
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
})

addEventListener('popstate', function(ev: PopStateEvent) {
	if (!enabled() && ev.state) {
		// The current page doesn't have transitions enabled
		// but the page we navigate to does (because it set the state).
		// Do a full page refresh to reload the client-side router from the new page.
		return location.reload()	}

	// Our transition entries always have state. Ignore stateless entries.
	if (ev.state === null) return
	const state: State = history.state;
	const nextIndex = state.index;
	const direction: Direction = nextIndex > currentHistoryIndex ? 'forward' : 'back';
	currentHistoryIndex = nextIndex;
	transition(direction, currentUrl, new URL(location.href), {}, state);
})

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
