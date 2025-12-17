import { detectScriptExecuted, swap } from './swap-functions.js';
import { PERSIST_ATTR, DIRECTION_ATTR, OLD_NEW_ATTR } from './attrs.js';

export type Fallback = 'none' | 'animate' | 'swap';
export type Direction = 'forward' | 'back';
export type NavigationTypeString = 'push' | 'replace' | 'traverse';
export type Options = {
	history?: 'auto' | 'push' | 'replace';
	formData?: FormData;
	sourceElement?: Element; // more than HTMLElement, e.g. SVGAElement
};
export type Config = {
	from: URL,
	to: URL,
	direction: Direction,
	navigationType: NavigationTypeString,
	sourceElement?: Element,

	method?: 'GET' | 'POST' | 'PUT' | 'DELETE',
	body?: string | ArrayBuffer | Blob | DataView | File | FormData | URLSearchParams | ReadableStream,
  headers?: Headers | {},
  signal: AbortSignal,

  response?: Response,
  mediaType?: string,
  text?: string,
}

let send = (elt: Element | Document = document, type: string, detail?: any, bub?: boolean) => elt.dispatchEvent(new CustomEvent("hop:" + type, {detail, cancelable:true, bubbles:bub !== false, composed:true}));

type State = {
	index: number;
	scrollX: number;
	scrollY: number;
};
type Navigation = { controller: AbortController };
type Transition = {
	// The view transitions object (API and simulation)
	viewTransition?: ViewTransition;
	// Simulation: Whether transition was skipped
	transitionSkipped: boolean;
	// Simulation: The resolve function of the finished promise
	viewTransitionFinished?: () => void;
};

export const supportsViewTransitions = !!document.startViewTransition;

const transitionEnabledOnThisPage = () =>
	!!document.querySelector('[name="astro-view-transitions-enabled"]');

export const fallback = (): Fallback => {
	const el = document.querySelector('[name="astro-view-transitions-fallback"]');
	return el ? el.getAttribute('content') as Fallback : 'animate';
};

// only update history entries that are managed by us
// leave other entries alone and do not accidentally add state.
const updateScrollPosition = (positions: { scrollX: number; scrollY: number }) => {
	if (history.state) {
		history.scrollRestoration = 'manual';
		history.replaceState({ ...history.state, ...positions }, '');
	}
};

const samePage = (thisLocation: URL, otherLocation: URL) =>
	thisLocation.pathname === otherLocation.pathname && thisLocation.search === otherLocation.search;

// The previous navigation that might still be in processing
let mostRecentNavigation: Navigation | undefined;
// The previous transition that might still be in processing
let mostRecentTransition: Transition | undefined;
// When we traverse the history, the window.location is already set to the new location.
// This variable tells us where we came from
let originalLocation: URL;

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
} else if (transitionEnabledOnThisPage()) {
	// This page is loaded from the browser address bar or via a link from extern,
	// it needs a state in the history
	history.replaceState({ index: currentHistoryIndex, scrollX, scrollY }, '');
	history.scrollRestoration = 'manual';
}

function runScripts() {
	let wait = Promise.resolve();
	let needsWaitForInlineModuleScript = false;
	// The original code made the assumption that all inline scripts are directly executed when inserted into the DOM.
	// This is not true for inline module scripts, which are deferred but still executed in order.
	// inline module scripts can not be awaited for with onload.
	// Thus to be able to wait for the execution of all scripts, we make sure that the last inline module script
	// is always followed by an external module script
	for (const script of document.getElementsByTagName('script')) {
		script.dataset.astroExec === undefined &&
			script.getAttribute('type') === 'module' &&
			(needsWaitForInlineModuleScript = script.getAttribute('src') === null);
	}
	needsWaitForInlineModuleScript &&
		document.body.insertAdjacentHTML(
			'beforeend',
			`<script type="module" src="data:application/javascript,"/>`,
		);

	for (const script of document.getElementsByTagName('script')) {
		if (script.dataset.astroExec === '') continue;
		const type = script.getAttribute('type');
		if (type && type !== 'module' && type !== 'text/javascript') continue;
		const newScript = document.createElement('script');
		newScript.innerHTML = script.innerHTML;
		for (const attr of script.attributes) {
			if (attr.name === 'src') {
				const p = new Promise((r) => {
					newScript.onload = newScript.onerror = r;
				});
				wait = wait.then(() => p as any);
			}
			newScript.setAttribute(attr.name, attr.value);
		}
		newScript.dataset.astroExec = '';
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
	originalLocation = to;

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
async function updateDOM(
	newDoc: Document,
	config: Config,
	currentTransition: Transition,
	historyState?: State,
	fallback?: Fallback,
) {
	async function animate(phase: string) {
		function isInfinite(animation: Animation) {
			const effect = animation.effect;
			if (!effect || !(effect instanceof KeyframeEffect) || !effect.target) return false;
			const style = window.getComputedStyle(effect.target, effect.pseudoElement);
			return style.animationIterationCount === 'infinite';
		}
		const currentAnimations = document.getAnimations();
		// Trigger view transition animations waiting for data-astro-transition-fallback
		document.documentElement.setAttribute(OLD_NEW_ATTR, phase);
		const nextAnimations = document.getAnimations();
		const newAnimations = nextAnimations.filter(
			(a) => !currentAnimations.includes(a) && !isInfinite(a),
		);
		// Wait for all new animations to finish (resolved or rejected).
		// Do not reject on canceled ones.
		return Promise.allSettled(newAnimations.map((a) => a.finished));
	}

	const animateFallbackOld = async () => {
		if (
			fallback === 'animate' &&
			!currentTransition.transitionSkipped &&
			!config.signal.aborted
		) {
			try {
				await animate('old');
			} catch {
				// animate might reject as a consequence of a call to skipTransition()
				// ignored on purpose
			}
		}
	};

	const pageTitleForBrowserHistory = document.title; // document.title will be overridden by swap()
	// const swapEvent = await doSwap(
	// 	newDoc,
	// 	config,
	// 	currentTransition.viewTransition!,
	// 	animateFallbackOld,
	// );


  animateFallbackOld()
  swap(newDoc)

	moveToLocation(config, pageTitleForBrowserHistory, historyState);
	send(document, 'swapped', { config })

	if (fallback === 'animate') {
		if (!currentTransition.transitionSkipped) {  // todo: consider abortable?
			animate('new').finally(() => currentTransition.viewTransitionFinished!());
		} else {
			currentTransition.viewTransitionFinished!();
		}
	}
}

function abortAndRecreateMostRecentNavigation(): Navigation {
	mostRecentNavigation?.controller.abort();
	return (mostRecentNavigation = {
		controller: new AbortController(),
	});
}

async function transition(
	direction: Direction,
	from: URL,
	to: URL,
	options: Options,
	historyState?: State,
) {
	// The most recent navigation always has precedence
	// Yes, there can be several navigation instances as the user can click links
	// while we fetch content or simulate view transitions. Even synchronous creations are possible
	// e.g. by calling navigate() from an transition event.
	// Invariant: all but the most recent navigation are already aborted.

	const currentNavigation = abortAndRecreateMostRecentNavigation();

	// not ours
	if (!transitionEnabledOnThisPage() || location.origin !== to.origin) {
		if (currentNavigation === mostRecentNavigation) mostRecentNavigation = undefined;
		location.href = to.href;
		return;
	}

	let config: Config = {
		from,
		to,
		direction,
		navigationType: historyState ? 'traverse' : (options.history === 'replace' ? 'replace' : 'push'),
		sourceElement: options.sourceElement,
		signal: currentNavigation!.controller.signal,
		body: options.formData,
	};

	if (config.navigationType !== 'traverse') {
		updateScrollPosition({ scrollX, scrollY });
	}
	if (samePage(from, to) && !options.formData) {
		if ((direction !== 'back' && to.hash) || (direction === 'back' && from.hash)) {
			moveToLocation(config, document.title, historyState);
			if (currentNavigation === mostRecentNavigation) mostRecentNavigation = undefined;
			return;
		}
	}

	let newDoc: Document | undefined;
	if (send(options.sourceElement, 'config', { config })) {
	  if (newDoc = await defaultLoader()) {
  	  if (config.navigationType === 'traverse') updateScrollPosition({ scrollX, scrollY })
    } else {
      location.href = to.href;
      return;
    }
	} else {
    return;
	}

	async function defaultLoader(): Promise<Document | undefined> {
		if (config.body) {
			config.method = 'POST';
			const form = (config.sourceElement as HTMLInputElement)?.form ||
				config.sourceElement?.closest('form');
			config.body = form?.enctype === 'application/x-www-form-urlencoded'
				? new URLSearchParams(config.body as any)
				: config.body;
		}
		try {
			if (!send(config.sourceElement, 'before', { config })) return
			let response = config.response = await fetch(config.to.href, config)

			const contentType = response.headers.get('content-type') ?? '';
			// drop potential charset (+ other name/value pairs) as parser needs the mediaType
			config.mediaType = contentType.split(';', 1)[0].trim();
			// the DOMParser can handle two types of HTML
			// everything else (e.g. audio/mp3) will be handled by the browser but not by us
			if (config.mediaType !== 'text/html' && config.mediaType !== 'application/xhtml+xml') return

			config.text = await response.text();
			if (!send(config.sourceElement, 'after', {config})) return
		} catch(error) {
			send(config.sourceElement, 'error', {config, error})
			return
		} finally {
			send(config.sourceElement, 'finally', {config})
		}

		// if there was a redirection, show the final URL in the browser's address bar
		if (config.response.redirected) {
			const redirectedTo = new URL(config.response.url);
			// but do not redirect cross origin
			if (redirectedTo.origin !== config.to.origin) return;
			config.to = redirectedTo;
		}

		parser ??= new DOMParser();

		let newDoc = parser.parseFromString(config.text, config.mediaType);
		// The next line might look like a hack,
		// but it is actually necessary as noscript elements
		// and their contents are returned as markup by the parser,
		// see https://developer.mozilla.org/en-US/docs/Web/API/DOMParser/parseFromString
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
	async function abortAndRecreateMostRecentTransition(): Promise<Transition> {
		if (mostRecentTransition) {
			if (mostRecentTransition.viewTransition) {
				try {
					mostRecentTransition.viewTransition.skipTransition();
				} catch {
					// might throw AbortError DOMException. Ignored on purpose.
				}
				try {
					// UpdateCallbackDone might already been settled, i.e. if the previous transition finished updating the DOM.
					// Could not take long, we wait for it to avoid parallel updates
					// (which are very unlikely as long as swap() is not async).
					await mostRecentTransition.viewTransition.updateCallbackDone;
				} catch {
					// There was an error in the update callback of the transition which we cancel.
					// Ignored on purpose
				}
			}
		}
		return (mostRecentTransition = { transitionSkipped: false });
	}

	const currentTransition = await abortAndRecreateMostRecentTransition();

	if (config.signal.aborted) {
		if (currentNavigation === mostRecentNavigation) mostRecentNavigation = undefined;
		return;
	}

	document.documentElement.setAttribute(DIRECTION_ATTR, config.direction);
	if (supportsViewTransitions) {
		// This automatically cancels any previous transition
		// We also already took care that the earlier update callback got through
		currentTransition.viewTransition = document.startViewTransition(
			async () => await updateDOM(newDoc, config, currentTransition, historyState),
		);
	} else {
		// Simulation mode requires a bit more manual work
		const updateDone = (async () => {
			// Immediately paused to setup the ViewTransition object for Fallback mode
			await Promise.resolve(); // hop through the micro task queue
			await updateDOM(newDoc, config, currentTransition, historyState, fallback());
			return undefined;
		})();

		// When the updateDone promise is settled,
		// we have run and awaited all swap functions and the after-swap event
		// This qualifies for "updateCallbackDone".
		//
		// For the build in ViewTransition, "ready" settles shortly after "updateCallbackDone",
		// i.e. after all pseudo elements are created and the animation is about to start.
		// In simulation mode the "old" animation starts before swap,
		// the "new" animation starts after swap. That is not really comparable.
		// Thus we go with "very, very shortly after updateCallbackDone" and make both equal.
		//
		// "finished" resolves after all animations are done.

		currentTransition.viewTransition = {
			updateCallbackDone: updateDone, // this is about correct
			ready: updateDone, // good enough
			// Finished promise could have been done better: finished rejects iff updateDone does.
			// Our simulation always resolves, never rejects.
			finished: new Promise((r) => (currentTransition.viewTransitionFinished = r as () => void)), // see end of updateDOM
			skipTransition: () => {
				currentTransition.transitionSkipped = true;
				// This cancels all animations of the simulation
				document.documentElement.removeAttribute(OLD_NEW_ATTR);
			},
			types: new Set<string>(), // empty by default
		};
	}
	// In earlier versions was then'ed on viewTransition.ready which would not execute
	// if the visual part of the transition has errors or was skipped
	currentTransition.viewTransition?.updateCallbackDone.finally(async () => {
		await runScripts();
		onLoad();
		announce();
	});
	// finished.ready and finished.finally are the same for the simulation but not
	// necessarily for native view transition, where finished rejects when updateCallbackDone does.
	currentTransition.viewTransition?.finished.finally(() => {
		currentTransition.viewTransition = undefined;
		if (currentTransition === mostRecentTransition) mostRecentTransition = undefined;
		if (currentNavigation === mostRecentNavigation) mostRecentNavigation = undefined;
		document.documentElement.removeAttribute(DIRECTION_ATTR);
		document.documentElement.removeAttribute(OLD_NEW_ATTR);
	});
	try {
		// Compatibility:
		// In an earlier version we awaited viewTransition.ready, which includes animation setup.
		// Scripts that depend on the view transition pseudo elements should hook on viewTransition.ready.
		await currentTransition.viewTransition?.updateCallbackDone;
	} catch (e) {
		// This log doesn't make it worse than before, where we got error messages about uncaught exceptions, which can't be caught when the trigger was a click or history traversal.
		// Needs more investigation on root causes if errors still occur sporadically
		const err = e as Error;
		// biome-ignore lint/suspicious/noConsole: allowed
		console.log('[astro]', err.name, err.message, err.stack);
	}
}

export async function navigate(href: string, options?: Options) {
	await transition('forward', originalLocation, new URL(href, location.href), options ?? {});
}

function onPopState(ev: PopStateEvent) {
	if (!transitionEnabledOnThisPage() && ev.state) {
		// The current page doesn't have View Transitions enabled
		// but the page we navigate to does (because it set the state).
		// Do a full page refresh to reload the client-side router from the new page.
		location.reload();
		return;
	}

	// History entries without state are created by the browser (e.g. for hash links)
	// Our view transition entries always have state.
	// Just ignore stateless entries.
	// The browser will handle navigation fine without our help
	if (ev.state === null) {
		return;
	}
	const state: State = history.state;
	const nextIndex = state.index;
	const direction: Direction = nextIndex > currentHistoryIndex ? 'forward' : 'back';
	currentHistoryIndex = nextIndex;
	transition(direction, originalLocation, new URL(location.href), {}, state);
}

const onScrollEnd = () => {
	// NOTE: our "popstate" event handler may call `pushState()` or
	// `replaceState()` and then `scrollTo()`, which will fire "scroll" and
	// "scrollend" events. To avoid redundant work and expensive calls to
	// `replaceState()`, we simply check that the values are different before
	// updating.
	if (history.state && (scrollX !== history.state.scrollX || scrollY !== history.state.scrollY)) {
		updateScrollPosition({ scrollX, scrollY });
	}
};

// initialization
if (supportsViewTransitions || fallback() !== 'none') {
	originalLocation = new URL(location.href);
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
for (const script of document.getElementsByTagName('script')) {
	detectScriptExecuted(script);
	script.dataset.astroExec = '';
}
