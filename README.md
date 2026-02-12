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

## Events

Events are dispatched on the navigation's source element (typically a link or form submitter) if it exists in the DOM, or the `document`.

All events include an [`options`](#options-object) object in their `detail`.

- [`hop:before-intercept`](#hopbefore-intercept) — Cancelable.
- [`hop:before-fetch`](#hopbefore-fetch) — Cancelable, interceptable.
- [`hop:fetch-load`](#hopfetch-load)
- [`hop:fetch-error`](#hopfetch-error)
- [`hop:fetch-end`](#hopfetch-end)
- [`hop:before-transition`](#hopbefore-transition) — Cancelable, interceptable.
- [`hop:before-swap`](#hopbefore-swap) — Cancelable, interceptable.
- [`hop:after-swap`](#hopafter-swap)
- [`hop:before-scroll`](#hopbefore-scroll) — Cancelable, interceptable.
- [`hop:after-scroll`](#hopafter-scroll)
- [`hop:load`](#hopload)
- [`hop:after-transition`](#hopafter-transition)

### Cancelable events

**Cancelable** events can be prevented with `e.preventDefault()`. This skips the associated step:

```js
document.addEventListener('hop:before-intercept', (e) => {
  if (someCondition) {
    e.preventDefault() // Fall back to standard navigation
  }
})
```

### Interceptable events

**Interceptable** events expose an `e.intercept(callback)` method. The callback is an async function that runs before the default behavior proceeds.

### `hop:before-intercept`

Fired before navigation is intercepted. Cancel to fall back to standard browser navigation.

### `hop:before-fetch`

Fired before the page is fetched. Cancel to skip the fetch entirely.

### `hop:fetch-load`

Fired after the page has been fetched and new stylesheets have been preloaded.

### `hop:fetch-error`

Fired when the fetch throws an error (e.g. network failure). Includes the error object in `e.detail.error`.

### `hop:fetch-end`

Fired after every fetch attempt, whether it succeeded or failed.

### `hop:before-transition`

Fired before `document.startViewTransition()` is called. Cancel to skip the view transition (the swap still runs without an animation).

### `hop:before-swap`

Fired before the DOM swap. Cancel to prevent the swap entirely (the document content remains unchanged).

### `hop:after-swap`

Fired immediately after the DOM swap.

### `hop:before-scroll`

Fired before scroll position is set i.e. scrolled to top, scrolled to a fragment, or restored after a traversal. Cancel to prevent scrolling entirely.

### `hop:after-scroll`

Fired after scroll position is restored i.e. scrolled to top, scrolled to a fragment, or restored after a traversal.

### `hop:load`

Fired after the swap is complete and new scripts have executed.

### `hop:after-transition`

Fired after the view transition finishes.

## Options Object

The `options` object is available via `e.detail.options` in all events. It is also passed as the second argument to `fetch()`, so properties like `method`, `headers`, `body`, and `signal` are used directly as fetch options. It contains:

| Property | Type | Description |
|----------|------|-------------|
| `id` | `string` | A UUID identifying the navigation. |
| `sourceElement` | `Element \| undefined` | The element that initiated the navigation (e.g. a link or form submitter). |
| `from` | `URL` | The URL of the page at the time of navigation. |
| `to` | `URL` | The destination URL. |
| `method` | `string` | `"GET"` or `"POST"`. |
| `body` | `FormData \| undefined` | The form data, if the navigation was triggered by a form submission. |
| `headers` | `object` | Request headers. Includes `x-hop-id`. |
| `signal` | `AbortSignal \| null` | The abort signal for the fetch request. Available from `hop:before-fetch` onwards. |
| `navEvent` | `NavigateEvent` | The underlying [NavigateEvent](https://developer.mozilla.org/en-US/docs/Web/API/NavigateEvent). |

## Navigation ID

Each navigation is assigned a UUID. The ID is:

- Available as `options.id` in all event details
- Set as a `data-hop-id` attribute on the source element during navigation (removed after the transition completes)
- Sent as an `x-hop-id` header with the fetch request

## How It Works

1. **Intercept**: Listens to the Navigation API's `navigate` event. Checks if navigation should be handled (same-origin, not opted-out, both pages have `hop` meta tag).

2. **Fetch**: Retrieves the target page. Validates it's HTML. Preloads new stylesheets.

3. **Swap**: Inside a View Transition (when available):
   - Updates `<html>` attributes
   - Diffs and updates `<head>` elements
   - Replaces `<body>`, then moves `data-hop-persist` elements from old to new
   - Re-executes new scripts
   - Restores focus and scroll position
   - Announces page title for screen readers

## Browser Support

Requires the [Navigation API](https://caniuse.com/mdn-api_navigation).

## Attributes Reference

| Attribute | Values | Description |
|-----------|--------|-------------|
| `data-hop-persist` | (presence) | Element survives navigation. Requires `id`. |
| `data-hop` | `"false"` | Disables fetch navigation on this element and descendants. |
| `data-hop-type` | `"replace"` | Uses `replaceState` instead of `pushState`. |
| `data-hop-track` | `"reload"` | Triggers full reload if element changes between pages. |
| `data-hop-id` | UUID | Set automatically on the source element during navigation. |

## Meta Tags Reference

| Name | Content | Description |
|------|---------|-------------|
| `hop` | `"true"` | Enables grasshopper. Required on both pages. |
| `hop-refresh-scroll` | `"preserve"` | Preserves scroll on refresh (same-path replace navigation). |
