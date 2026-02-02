# Grasshopper

> [!WARNING]
> Experimental

Grasshopper intercepts link clicks and form submissions, fetching pages via the [Navigation API](https://developer.mozilla.org/en-US/docs/Web/API/Navigation_API) and swapping content while preserving designated elements.

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

## Scroll Behavior on Refresh

When navigating to the same pathname with `replace` history mode, scroll position is normally reset. To preserve it:

```html
<meta name="hop-refresh-scroll" content="preserve">
```

## Events

Grasshopper dispatches pre-swap events on the navigation's source element (typically a link, or form submitter) if it exists, or the `document`. All events bubble.

### `hop:before-intercept`

Fired on the source element (link or form) before navigation is intercepted. Cancel to fall back to standard navigation:

```js
document.addEventListener('hop:before-intercept', (e) => {
  if (someCondition) {
    e.preventDefault() // Use standard navigation instead
  }
})
```

### `hop:before-scroll`

Fired before scroll position is restored. You can intercept and provide custom scroll behavior:

```js
document.addEventListener('hop:before-scroll', (e) => {
    e.intercept(async () => {
        // Custom scroll logic
        window.scrollTo({ top: 0, behavior: 'smooth' })
        return true
    })
})
```

### `hop:scrolled`

Fired after scroll position is restored.

### `hop:loaded`

Fired after the page swap is complete and new scripts have executed. Use this to reinitialize JavaScript that depends on the new content:

```js
document.addEventListener('hop:loaded', () => {
    initializeComponents()
})
```

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

## Meta Tags Reference

| Name | Content | Description |
|------|---------|-------------|
| `hop` | `"true"` | Enables grasshopper. Required on both pages. |
| `hop-refresh-scroll` | `"preserve"` | Preserves scroll on same-path replace navigations. |
