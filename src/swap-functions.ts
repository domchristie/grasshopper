import { NON_OVERRIDABLE_ASTRO_ATTRS, PERSIST_ATTR } from './attrs.js'

function swapRootAttributes(newDoc: Document) {
	const currentRoot = document.documentElement
	const nonOverridableAstroAttributes = [...currentRoot.attributes].filter(
		({ name }) => (currentRoot.removeAttribute(name), NON_OVERRIDABLE_ASTRO_ATTRS.includes(name))
	);
	[...newDoc.documentElement.attributes, ...nonOverridableAstroAttributes].forEach(
		({ name, value }) => currentRoot.setAttribute(name, value)
	)
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

function swapBodyElement(newBody: HTMLElement, oldBody: HTMLElement) {
	// Note: resets scroll position
	oldBody.replaceWith(newBody)

	for (const el of oldBody.querySelectorAll(`[${PERSIST_ATTR}]`)) {
		const id = el.getAttribute(PERSIST_ATTR)
		const newEl = newBody.querySelector(`[${PERSIST_ATTR}="${id}"]`)
		if (newEl) newEl.replaceWith(el)
	}
	flagNewScripts(newBody.getElementsByTagName('script'))

	// This will upgrade any Declarative Shadow DOM in the new body.
	attachShadowRoots(newBody)
}

/**
 * Attach Shadow DOM roots for templates with the declarative `shadowrootmode` attribute.
 * @see https://github.com/withastro/astro/issues/14340
 * @see https://web.dev/articles/declarative-shadow-dom#polyfill
 * @param root DOM subtree to attach shadow roots within.
 */
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

export function swap(newDoc: Document) {
	swapRootAttributes(newDoc)
	swapHeadElements(newDoc)
	withRestoredFocus(() => {
		swapBodyElement(newDoc.body, document.body)
	})
}
