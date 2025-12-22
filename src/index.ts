import { navigate } from './router'
import { RELOAD_ATTR } from './attrs'

let started = false

let lastClickedElementLeavingWindow: EventTarget | null = null

const leavesWindow = (ev: MouseEvent) =>
	(ev.button && ev.button !== 0) || // left clicks only
	ev.metaKey || // new tab (mac)
	ev.ctrlKey || // new tab (windows)
	ev.altKey || // download
	ev.shiftKey // new window

// form.action and form.method can point to an <input name="action"> or <input name="method">
// in which case should fallback to the form attribute
const formAttr = (form: HTMLFormElement, submitter: HTMLElement | null, attr: string, defaultVal: any) =>
	submitter?.getAttribute(`form${attr}`) ?? (form[attr] === 'string' ? form[attr] : form.getAttribute(attr)) ?? defaultVal

if (!started) {
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
			link.closest(`[${RELOAD_ATTR}]`) ||
			link.hasAttribute('download') ||
			!link.href ||
			(linkTarget && linkTarget !== '_self') ||
			new URL(href, location.href).origin !== location.origin ||
			lastClickedElementLeavingWindow ||
			ev.defaultPrevented
		) return

		ev.preventDefault()
		navigate(href, {
			srcElement: link,
			history: link.dataset.astroHistory === 'replace' ? 'replace' : 'auto'
		})
	})

	document.addEventListener('submit', (ev) => {
		let el = ev.target as HTMLElement
		let submitter = ev.submitter

		let clickedWithKeys = submitter && submitter === lastClickedElementLeavingWindow
		lastClickedElementLeavingWindow = null

		// Check eligibility
		if (el.tagName !== 'FORM' || ev.defaultPrevented || el.closest(`[${RELOAD_ATTR}]`) || clickedWithKeys) return
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
		navigate(action, {
			srcElement: submitter ?? form,
			method,
			body,
			history: (submitter ?? form).dataset.astroHistory === 'replace' ? 'replace' : 'auto'
		})
	})
	started = true
}
