import type { Fallback, Options } from './types';
import { supportsViewTransitions, navigate } from './router';
import { RELOAD_ATTR } from './attrs';

let lastClickedElementLeavingWindow: EventTarget | null = null;

function fallback(): Fallback {
	const el = document.querySelector('[name="astro-view-transitions-fallback"]');
	return el ? el.getAttribute('content') as Fallback : 'animate';
}

const leavesWindow = (ev: MouseEvent) =>
	(ev.button && ev.button !== 0) || // left clicks only
	ev.metaKey || // new tab (mac)
	ev.ctrlKey || // new tab (windows)
	ev.altKey || // download
	ev.shiftKey; // new window

if (supportsViewTransitions || fallback() !== 'none') {
	document.addEventListener('click', (ev) => {
		let link = ev.target;

		lastClickedElementLeavingWindow = leavesWindow(ev) ? link : null;

		if (ev.composed) link = ev.composedPath()[0];
		if (link instanceof Element) link = link.closest('a, area');
		if (
			!(link instanceof HTMLAnchorElement) &&
			!(link instanceof SVGAElement) &&
			!(link instanceof HTMLAreaElement)
		) return;

		// This check verifies that the click is happening on an anchor
		// that is going to another page within the same origin. Basically it determines
		// same-origin navigation, but omits special key combos for new tabs, etc.
		const linkTarget = link instanceof HTMLElement ? link.target : link.target.baseVal;
		const href = link instanceof HTMLElement ? link.href : link.href.baseVal;
		if (
			link.closest(`[${RELOAD_ATTR}]`) ||
			link.hasAttribute('download') ||
			!link.href ||
			(linkTarget && linkTarget !== '_self') ||
			new URL(href, location.href).origin !== location.origin ||
			lastClickedElementLeavingWindow ||
			ev.defaultPrevented
		) {
			// No page transitions in these cases,
			// Let the browser standard action handle this
			return;
		}
		ev.preventDefault();
		navigate(href, {
			history: link.dataset.astroHistory === 'replace' ? 'replace' : 'auto',
			sourceElement: link,
		});
	});

	document.addEventListener('submit', (ev) => {
		let el = ev.target as HTMLElement;
		const submitter = ev.submitter;

		const clickedWithKeys = submitter && submitter === lastClickedElementLeavingWindow;
		lastClickedElementLeavingWindow = null;

		if (el.tagName !== 'FORM' || ev.defaultPrevented || el.closest(`[${RELOAD_ATTR}]`) || clickedWithKeys) {
			return;
		}
		const form = el as HTMLFormElement;
		const formData = new FormData(form, submitter);
		// form.action and form.method can point to an <input name="action"> or <input name="method">
		// in which case should fallback to the form attribute
		const formAction =
			typeof form.action === 'string' ? form.action : form.getAttribute('action');
		const formMethod =
			typeof form.method === 'string' ? form.method : form.getAttribute('method');
		// Use the form action, if defined, otherwise fallback to current path.
		let action = submitter?.getAttribute('formaction') ?? formAction ?? location.pathname;
		// Use the form method, if defined, otherwise fallback to "get"
		const method = submitter?.getAttribute('formmethod') ?? formMethod ?? 'get';

		// the "dialog" method is a special keyword used within <dialog> elements
		// https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#attr-fs-method
		if (method === 'dialog' || location.origin !== new URL(action, location.href).origin) {
			// No page transitions in these cases,
			// Let the browser standard action handle this
			return;
		}

		const options: Options = { sourceElement: submitter ?? form };
		if (method === 'get') {
			const params = new URLSearchParams(formData as any);
			const url = new URL(action);
			url.search = params.toString();
			action = url.toString();
		} else {
			options.formData = formData;
		}

		ev.preventDefault();
		navigate(action, options);
	});
}
