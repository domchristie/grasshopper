# Grasshopper

Faster HTML over-the-wire navigations using the [Navigation API](https://developer.mozilla.org/en-US/docs/Web/API/Navigation_API). Lightweight and extensible.

## Quick Start

```html
<head>
  <meta name="hop" content="true">
  <script type="module" src="grasshopper.js"></script>
</head>
```

The `<meta name="hop" content="true">` tag must be present on both the current page and the target page. Without it, grasshopper falls back to standard browser navigation.

## Persisting Elements

Add `data-hop-persist` and a unique `id` to elements that should survive navigation:

```html
<audio data-hop-persist id="player" src="/music.mp3" controls></audio>
```

When navigating to a page that contains an element with the same `id` and `data-hop-persist` attribute, the original element is moved into the new document instead of being replaced. This preserves playback state, event listeners, and any other runtime state.

**Requirements:**
- The element must have both `data-hop-persist` and `id` attributes
- The target page must contain a matching `data-hop-persist` and `id` attributes

## Disabling on Specific Links

Set `data-hop="false"` on links or forms that should use standard browser navigation:

```html
<a href="/subscribe" data-hop="false">Subscribe</a>
<form action="/login" data-hop="false">...</form>
<form action="/login">
	<input type="submit" data-hop="false" />
</form>
```

You can also place this attribute on a parent element to disable all descendants:

```html
<nav data-hop="false">
  <a href="/about">All links here use standard navigation</a>
</nav>
```

## History Behavior

Links and forms push to the history stack by default. To replace the current history entry, add `data-hop-type="replace"` to the navigating element or its parent:

```html
<a href="/tab-2" data-hop-type="replace">About</a>
<form action="/login" data-hop-type="replace">...</form>
<form action="/login">
	<input type="submit" data-hop-type="replace" />
</form>
```

## Tracking Asset Changes

Add `data-hop-track="reload"` to elements (typically stylesheets or scripts) that should trigger a full reload when they change:

```html
<link rel="stylesheet" href="/app.css?v=abc123" data-hop-track="reload">
<script src="/app.js?v=abc123" data-hop-track="reload"></script>
```

During navigation, grasshopper compares tracked elements between the current and new document. If any tracked element is missing or different in the new document, a full page reload occurs. This ensures cache-busted assets always load fresh.

## Scroll on Refresh

A "refresh" is a replace navigation to the same pathname. By default, scroll resets to the top or to a given fragment. To preserve scroll position on refresh:

```html
<head>
  <meta name="hop" content="true">
  <meta name="hop-refresh-scroll" content="preserve">
</head>
<body>
  <nav data-hop-type="replace">
    <a href="?sort=name">Sort by name</a>
    <a href="?sort=date">Sort by date</a>
  </nav>
</body>
```

This is useful for filtering, sorting, or making changes in-place.

**Requirements:**
- The navigation must be to the same pathname
- The triggering element must have `data-hop-type="replace"` (or be inside one)
- The page must have `<meta name="hop-refresh-scroll" content="preserve">`

## JavaScript API

### `start` and `stop`

Grasshopper automatically starts on `DOMContentLoaded`. For manual control, import `start` and/or `stop`:

```js
import { start, stop } from '/grasshopper.js'
stop()
history.replaceState({}, '', '#photo-3') // replaces URL without interception
start()

stop()
window.location = '/subscribe' // full page load
```

`start` adds the `navigate` event listener. Requires that the page includes `<meta name="hop" content="true">`.

`stop` removes the `navigate` event listener.

### `replace` and `runScripts`

For swaps outside of navigation (e.g. applying a fragment of HTML fetched by your own code or a third-party library), import `replace` and `runScripts`:

```js
import { replace, runScripts } from '/grasshopper.js'

const newEl = document.createElement('div')
newEl.innerHTML = await (await fetch('/fragment')).text()

replace(document.getElementById('target'), newEl)
await runScripts()
```

`replace(oldEl, newEl)` swaps `oldEl` for `newEl` in the DOM. It uses the same mechanism grasshopper uses internally to swap `<body>`: it keeps [persisted elements](#persisting-elements), flags new scripts for execution, and attaches any declarative shadow roots.

`runScripts()` executes scripts flagged by `replace()`. It returns a promise that resolves once all external and module scripts have loaded and run.

## Events

Events are dispatched on the navigation's source element (typically a link or form submitter) if it exists in the DOM, or the `document`.

All events include a [`hop`](#hop-object) object in their `detail`. Listeners can change some `hop` properties to change later steps. For example, set `hop.headers` in `hop:before-fetch`, or `hop.timeout` in `hop:before-intercept`.

- [`hop:before-intercept`](#hopbefore-intercept)
- [`hop:before-fetch`](#hopbefore-fetch)
- [`hop:fetch-start`](#hopfetch-start)
- [`hop:before-response`](#hopbefore-response)
- [`hop:fetch-load`](#hopfetch-load)
- [`hop:fetch-error`](#hopfetch-error)
- [`hop:before-fallback`](#hopbefore-fallback)
- [`hop:fetch-end`](#hopfetch-end)
- [`hop:before-transition`](#hopbefore-transition)
- [`hop:before-swap`](#hopbefore-swap)
- [`hop:after-swap`](#hopafter-swap)
- [`hop:before-scroll`](#hopbefore-scroll)
- [`hop:after-scroll`](#hopafter-scroll)
- [`hop:load`](#hopload)
- [`hop:after-transition`](#hopafter-transition)

### Canceling, Intercepting, and Aborting

`hop:before-*` events are cancelable. Call `preventDefault()` on the event to skip the next step. The navigation stops only if it needs that step. For example, canceling `hop:before-fetch` stops the navigation because there is no response to use. Canceling `hop:before-transition` skips the view transition, but the swap still runs.

All `hop:before-*` events _except `hop:before-intercept`_ are **interceptable**. Interceptable events expose an `intercept(callback)` method. The callback is an async function that runs before the default behavior proceeds. This is useful for pausing part of the navigation before automatically resuming. For example:

```js
document.addEventListener('hop:before-fetch', (e) => {
  e.intercept(async () => {
    const token = await getToken()
    e.detail.hop.headers['Authorization'] = `Bearer ${token}`
  })
})
```

Call `preventDefault()` in the listener to cancel at once. The intercept callbacks do not run.

Call `preventDefault()` inside an intercept callback to cancel after async work. The callbacks finish first, then grasshopper skips the default behavior.

Call `hop.abort(reason)` from any event, or at any time during the navigation. It aborts `hop.signal`, which cancels an in-flight fetch and stops the navigation at the next step. It does not wait for running intercept callbacks to finish. An abort is silent: `hop:fetch-error` does not fire, unless the reason is a `TimeoutError`. `hop:fetch-end` still fires.

### `hop:before-intercept`

Fires before grasshopper intercepts the navigation.
**Canceling** hands the navigation to the browser: a standard page load.
**Aborting** stops the navigation before the fetch.

_Unlike other `hop:before-*` events, this is not interceptable._

### `hop:before-fetch`

Fires before the page is fetched.
**Canceling** skips the fetch and stops the navigation.
**Aborting** does the same.

### `hop:fetch-start`

Fires immediately before the fetch request goes out.

### `hop:before-response`

Fires when the fetch completes, before the response is handled and the body is read.
**Canceling** stops the navigation and cancels the response body.
**Aborting** does the same.

Use `hop.response.clone()` if a listener needs the body, to prevent future read errors.

### `hop:fetch-load`

Fires after the page is fetched, parsed, and new stylesheets are preloaded.

### `hop:fetch-error`

Fires when the fetch throws an error (e.g. network failure), or times out (see [Load Timeout](#load-timeout)).

`e.detail.error` holds the error. The navigation then stops, and the URL and page content stay as they are. (On browsers without `NavigationPrecommitController`, a back/forward traversal has already committed the URL by this point, so the address bar shows the destination while the content stays put.)

### `hop:before-fallback`

Fires when grasshopper will not swap the response, just before it performs a standard (unintercepted) request.
**Canceling** skips the browser request. The navigation still stops.
**Aborting** also skips the browser request. The navigation stops with your reason instead.

`e.detail.reason` says why grasshopper will not swap the response. `e.detail.error` holds the `DOMException` that stops the navigation. Grasshopper throws it whether or not you cancel.

| Reason | Description |
|--------|-------------|
| `attachment` | The response has a `Content-Disposition: attachment` header. `hop.response` has an unread body. |
| `unsupported-media-type` | The response is not `text/html` or `application/xhtml+xml`. `hop.response` has an unread body. |
| `cross-origin-redirect` | The response redirected to a different origin. `hop.response` has an unread body. |
| `disabled` | The destination document does not opt in with `<meta name="hop" content="true">`. The body is already read — use `hop.doc`. |

The default behavior is a full browser navigation to the response URL. Cancel to prevent it and handle the response yourself:

```js
document.addEventListener('hop:before-fallback', (e) => {
  if (e.detail.reason !== 'attachment') return
  e.intercept(async () => { // keeps the response readable
    const blob = await e.detail.hop.response.blob()
    save(blob)
    e.preventDefault() // skips the browser navigation
  })
})
```

Canceling on its own is enough to skip the navigation. Intercept as well to read the response: the body is torn down once the navigation ends, so reads outside the callback fail with an `AbortError`.

A form `POST` whose response is not a redirect has no fallback to cancel. The event still fires, and the navigation stops.

### `hop:fetch-end`

Fires at the end of the load phase: after the fetch succeeds or fails, or after a cancel or abort skips it.

### `hop:before-transition`

Fires before `document.startViewTransition()` is called.
**Canceling** skips the view transition. The swap still runs, with no animation.
**Aborting** stops the navigation. Nothing swaps.

It does not fire if the browser already shows its own visual transition (for example, after a swipe-back gesture).

### `hop:before-swap`

Fires before the DOM swap.
**Canceling** skips the swap. The scroll still runs, and `hop:load` still fires.
**Aborting** skips the swap and the scroll.

### `hop:after-swap`

Fires immediately after the DOM swap.

### `hop:before-scroll`

Fires before the scroll position is set: to the top, to a fragment, or restored after a traversal.
**Canceling** leaves the scroll position untouched.
**Aborting** skips the scroll. The document is already swapped, but its new scripts do not run and `hop:load` does not fire.

### `hop:after-scroll`

Fires after the scroll position is set.

### `hop:load`

Fires after the swap, and after new scripts run.
It does not fire if the navigation aborts during the swap, or if a newer navigation has taken over.

### `hop:after-transition`

Fires after the view transition finishes.
It does not fire if a newer navigation has taken over.

## Hop Object

The `hop` object is available via `e.detail.hop` in all events. It is also passed as the second argument to `fetch()`, so properties like `method`, `headers`, `body`, and `signal` are used directly as fetch options. It contains:

| Property | Type | Description |
|----------|------|-------------|
| `id` | `string` | A UUID identifying the navigation. |
| `timeout` | `number` | How long the load phase may take, in ms. Defaults to `60000`. Set to falsy to disable. |
| `scroll` | `"preserve" \| undefined` | Set to `"preserve"` to keep the scroll position. `hop:before-scroll` then does not fire. |
| `sourceElement` | `Element \| undefined` | The element that initiated the navigation (e.g. a link or form submitter). |
| `direction` | `"forward" \| "back" \| "none"` | `"forward"` for pushes and traversals to a higher history index, `"back"` for traversals to a lower index, `"none"` for replaces and reloads. |
| `from` | `URL` | The URL of the page at the time of navigation. |
| `to` | `URL` | The destination URL. |
| `method` | `string` | `"GET"` or `"POST"`. |
| `body` | `FormData \| undefined` | The form data, if the navigation was triggered by a form submission. |
| `headers` | `object` | Request headers. Includes `x-hop-id`. |
| `signal` | `AbortSignal` | The abort signal for the fetch request. Available from `hop:before-intercept` onwards. |
| `abort` | `function` | Aborts this navigation. Takes an optional reason. See [Canceling, Intercepting, and Aborting](#canceling-intercepting-and-aborting). |
| `response` | `Response \| undefined` | The fetch response. Available from `hop:before-response` onwards. |
| `doc` | `Document \| undefined` | The parsed destination document. Available from `hop:fetch-load` onwards, or from `hop:before-fallback` when the reason is `disabled`. |
| `navEvent` | `NavigateEvent` | The underlying [NavigateEvent](https://developer.mozilla.org/en-US/docs/Web/API/NavigateEvent). |

## Load Timeout

The load phase (fetch, parse, and stylesheet preload) has a default timeout of `60000` ms. If it is not done by then, the navigation aborts with a `TimeoutError` and `hop:fetch-error` fires. Set a custom timeout by updating `hop.timeout` in the `before-intercept` event. Set to a falsy value to disable.

## Navigation ID

Each navigation is assigned a UUID. The ID is:

- Available as `hop.id` in all event details
- Sent as an `x-hop-id` header with the fetch request

## How It Works

1. **Intercept**: Listens to the Navigation API's `navigate` event. Checks if navigation should be handled (same-origin, not opted-out, both pages have `hop` meta tag).

2. **Fetch**: Retrieves the target page. Validates it's HTML. Preloads new stylesheets.

3. **Swap**: Inside a View Transition (when available), typed with `hop.direction` so CSS can target it via [`:active-view-transition-type()`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/:active-view-transition-type):
   - Updates `<html>` attributes
   - Diffs and updates `<head>` elements
   - Replaces `<body>`, then moves `data-hop-persist` elements from old to new
   - Re-executes new scripts
   - Restores focus and scroll position
   - Announces page title for screen readers

## Browser Support

Requires the [Navigation API](https://caniuse.com/wf-navigation) and [AbortSignal.any](https://caniuse.com/wf-abortsignal-any).

## Attributes Reference

| Attribute | Values | Description |
|-----------|--------|-------------|
| `data-hop-persist` | (presence) | Element survives navigation. Requires `id`. |
| `data-hop` | `"false"` | Disables fetch navigation on this element and descendants. |
| `data-hop-type` | `"replace"` | Uses `replaceState` instead of `pushState`. |
| `data-hop-track` | `"reload"` | Triggers full reload if element changes between pages. |

## Meta Tags Reference

| Name | Content | Description |
|------|---------|-------------|
| `hop` | `"true"` | Enables grasshopper. Required on both pages. |
| `hop-refresh-scroll` | `"preserve"` | Preserves scroll on refresh (same-path replace navigation). |

## License

MIT License

Copyright (c) 2025 Dom Christie

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

This license also applies to code from the [withastro/astro](https://github.com/withastro/astro) repository:

MIT License

Copyright (c) 2021 Fred K. Schott

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
