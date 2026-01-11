# Grasshopper

> [!WARNING]
> Experimental & incomplete

Extracts the navigation system from the view transition code in [Astro](https://github.com/withastro/astro). It enables visits between server-rendered pages, while maintaining document state. Particularly useful for apps that need audio/video elements to continue playing across page navigations.

**Enabling**
```html
<meta name="hop-view-transitions-enabled" content="true" />
```

**Persistent Elements**
```html
<audio data-hop-persist id="unique_id" …></audio>
```

**Disabling on a link/form**
```html
<a data-hop-reload …>
```
This bypasses the fetch-based navigation and instead uses the default browser behaviour.

## TODO

- [ ] Implement `data-hop-transition-track="reload"`
- [ ] Page refreshes that maintain scroll position
