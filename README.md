# Grasshopper

> [!WARNING]
> Experimental & incomplete

Extracts the navigation system from the view transition code in [Astro](https://github.com/withastro/astro). It enables visits between server-rendered pages, while maintaining document state. Particularly useful for apps that need audio/video elements to continue playing across page navigations.

**Enabling**
```html
<meta name="hop" content="true" />
```

**Refresh Scroll Behavior**
```html
<meta name="hop-refresh-scroll" content="preserve">
```
When present, the scroll position will be maintained during a page navigation if the from/to pathnames match and the navigation type is `replace`.

**Persistent Elements**
```html
<audio data-hop-persist id="unique_id" …></audio>
```

**Disabling on a link/form**
```html
<a data-hop="false" …>
```
This bypasses the fetch-based navigation and instead uses the default browser behaviour.

**Trackable Elements**
```html
<link rel="stylesheet" href="/styles.css?v=123" data-hop-track="reload">
<script src="/app.js?v=456" data-hop-track="reload"></script>
```
Elements with `data-hop-track="reload"` are compared between the current and new document during navigation. If any tracked element in the current document is not present (or has changed) in the new document, a full page reload is triggered instead of a soft navigation. Useful for cache-busted assets where a version change should force a fresh load.
