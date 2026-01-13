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

## TODO

- [ ] Implement `data-hop-track="reload"`
