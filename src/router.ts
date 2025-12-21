import { swap } from './swap-functions.js';
import { PERSIST_ATTR, DIRECTION_ATTR, OLD_NEW_ATTR } from './attrs.js';

export type Fallback = 'none' | 'animate' | 'swap';
export type Direction = 'forward' | 'back';
export type NavigationTypeString = 'push' | 'replace' | 'traverse';
export type Options = {
	srcElement?: Element
	trigger?: Event
	method?: 'get' | 'post'
	history?: 'auto' | 'push' | 'replace'
	body?: string | FormData | URLSearchParams
};
export type Config = {
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

let send = (elt: Element | Document = document, type: string, detail?: any, bub?: boolean) => elt.dispatchEvent(new CustomEvent("hop:" + type, {detail, cancelable:true, bubbles:bub !== false, composed:true}));
let abortController: AbortController | undefined;
let currentTransition: ViewTransition | undefined;

type State = {
	index: number;
	scrollX: number;
	scrollY: number;
};
type Transition = {
	// The view transitions object (API and simulation)
	viewTransition?: ViewTransition;
	// Simulation: Whether transition was skipped
	transitionSkipped: boolean;
	// Simulation: The resolve function of the finished promise
	viewTransitionFinished?: () => void;
};

export const supportsViewTransitions = !!document.startViewTransition;

const enabled = () =>
	!!document.querySelector('[name="astro-view-transitions-enabled"]');

export const fallback = (): Fallback => {
	const el = document.querySelector('[name="astro-view-transitions-fallback"]');
	return el ? el.getAttribute('content') as Fallback : 'animate';
};

// only update history entries that are managed by us
// leave other entries alone and do not accidentally add state.
const saveScrollPosition = (positions: { scrollX: number; scrollY: number }) => {
	if (history.state) {
		history.scrollRestoration = 'manual';
		history.replaceState({ ...history.state, ...positions }, '');
	}
};

const samePage = (thisLocation: URL, otherLocation: URL) =>
	thisLocation.pathname === otherLocation.pathname && thisLocation.search === otherLocation.search;

// The previous transition that might still be in processing
let lastTransition: Transition | undefined;
// When we traverse the history, the window.location is already set to the new location.
// This variable tells us where we came from
let currentUrl: URL = new URL(location.href);

const onLoad = () => send(document, 'load');
const announce = () => {
	let div = document.createElement('div');
	div.setAttribute('aria-live', 'assertive');
	div.setAttribute('aria-atomic', 'true');
	div.className = 'astro-route-announcer';
	document.body.append(div);
	setTimeout(
		() => {
			let title = document.title || document.querySelector('h1')?.textContent || location.pathname;
			div.textContent = title;
		},
		// Much thought went into this magic number; the gist is that screen readers
		// need to see that the element changed and might not do so if it happens
		// too quickly.
		60,
	);
};

let parser: DOMParser;

// The History API does not tell you if navigation is forward or back, so
// you can figure it using an index. On pushState the index is incremented so you
// can use that to determine popstate if going forward or back.
let currentHistoryIndex = 0;

if (history.state) {
	// Here we reloaded a page with history state
	// (e.g. history navigation from non-transition page or browser reload)
	currentHistoryIndex = history.state.index;
	scrollTo({ left: history.state.scrollX, top: history.state.scrollY });
} else if (enabled()) {
	// This page is loaded from the browser address bar or via a link from extern,
	// it needs a state in the history
	history.replaceState({ index: currentHistoryIndex, scrollX, scrollY }, '');
	history.scrollRestoration = 'manual';
}

function runScripts() {
	let wait: Promise<any> = Promise.resolve();
	let needsWaitForInlineModuleScript = false;
	// Inline module scripts are deferred but still executed in order.
	// They can not be awaited for with onload.
	// Thus to be able to wait for the execution of all scripts, we make sure that the last inline module script
	// is always followed by an external module script
	for (const script of document.getElementsByTagName('script')) {
		script.dataset.astroEval !== 'false' &&
			script.getAttribute('type') === 'module' &&
			(needsWaitForInlineModuleScript = script.getAttribute('src') === null);
	}
	needsWaitForInlineModuleScript &&
		document.body.insertAdjacentHTML(
			'beforeend',
			`<script type="module" src="data:application/javascript,"/>`,
		);

	for (const script of document.getElementsByTagName('script')) {
		if (script.dataset.astroEval === 'false') continue
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

	let scrolledToTop = false;
	if (to.href !== location.href && !historyState) {
		if (navigationType === 'replace') {
			const current = history.state;
			history.replaceState(
				{
					index: current.index,
					scrollX: current.scrollX,
					scrollY: current.scrollY,
				},
				'',
				to.href,
			);
		} else {
			history.pushState(
				{ index: ++currentHistoryIndex, scrollX: 0, scrollY: 0 },
				'',
				to.href,
			);
		}
	}
	document.title = targetPageTitle;
	// now we are on the new page for non-history navigation!
	// (with history navigation page change happens before popstate is fired)
	currentUrl = to;

	// freshly loaded pages start from the top
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
// if fallback === "animate" then simulate view transitions
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

	if (config.navigationType !== 'traverse') saveScrollPosition({ scrollX, scrollY })
	if (samePage(from, to) && !options.body) {
		if ((direction !== 'back' && to.hash) || (direction === 'back' && from.hash)) {
			moveToLocation(config, document.title, historyState)
			return
		}
	}

	let newDoc: Document | undefined;
	if (send(config.srcElement, 'config', { config })) {
		if (newDoc = await defaultLoader()) {
			if (config.navigationType === 'traverse') saveScrollPosition({ scrollX, scrollY })
		} else {
			location.href = to.href
			return
		}
	} else {
		return
	}

	async function defaultLoader(): Promise<Document | undefined> {
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

		parser ??= new DOMParser();

		let newDoc = parser.parseFromString(config.text, config.mediaType);
		newDoc.querySelectorAll('noscript').forEach((el) => el.remove());

		// If ClientRouter is not enabled on the incoming page, do a full page load to it.
		// Unless this was a form submission, in which case we do not want to trigger another mutation.
		if (
			!newDoc.querySelector('[name="astro-view-transitions-enabled"]') &&
			!config.body
		) {
			return;
		}

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
	if (supportsViewTransitions) {
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
		onLoad()
		announce()
	})
	transitionFinished.finally(() => {
		currentTransition = void 0
		document.documentElement.removeAttribute(DIRECTION_ATTR)
		document.documentElement.removeAttribute(OLD_NEW_ATTR)
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

function onPopState(ev: PopStateEvent) {
	if (!enabled() && ev.state) {
		// The current page doesn't have transitions enabled
		// but the page we navigate to does (because it set the state).
		// Do a full page refresh to reload the client-side router from the new page.
		location.reload();
		return;
	}

	// Our transition entries always have state. Ignore stateless entries.
	if (ev.state === null) return
	const state: State = history.state;
	const nextIndex = state.index;
	const direction: Direction = nextIndex > currentHistoryIndex ? 'forward' : 'back';
	currentHistoryIndex = nextIndex;
	transition(direction, currentUrl, new URL(location.href), {}, state);
}

const onScrollEnd = () => {
	// NOTE: our "popstate" event handler may call `pushState()` or
	// `replaceState()` and then `scrollTo()`, which will fire "scroll" and
	// "scrollend" events. To avoid redundant work and expensive calls to
	// `replaceState()`, we simply check that the values are different before
	// updating.
	if (history.state && (scrollX !== history.state.scrollX || scrollY !== history.state.scrollY)) {
		saveScrollPosition({ scrollX, scrollY });
	}
};

// initialization
if (supportsViewTransitions || fallback() !== 'none') {
	addEventListener('popstate', onPopState);
	addEventListener('load', onLoad);
	// There's not a good way to record scroll position before a history back
	// navigation, so we will record it when the user has stopped scrolling.
	if ('onscrollend' in window) addEventListener('scrollend', onScrollEnd);
	else {
		// Keep track of state between intervals
		let intervalId: number | undefined, lastY: number, lastX: number, lastIndex: State['index'];
		const scrollInterval = () => {
			// Check the index to see if a popstate event was fired
			if (lastIndex !== history.state?.index) {
				clearInterval(intervalId);
				intervalId = undefined;
				return;
			}
			// Check if the user stopped scrolling
			if (lastY === scrollY && lastX === scrollX) {
				// Cancel the interval and update scroll positions
				clearInterval(intervalId);
				intervalId = undefined;
				onScrollEnd();
				return;
			} else {
				// Update vars with current positions
				(lastY = scrollY), (lastX = scrollX);
			}
		};
		// We can't know when or how often scroll events fire, so we'll just use them to start intervals
		addEventListener(
			'scroll',
			() => {
				if (intervalId !== undefined) return;
				(lastIndex = history.state?.index), (lastY = scrollY), (lastX = scrollX);
				intervalId = window.setInterval(scrollInterval, 50);
			},
			{ passive: true },
		);
	}
}
