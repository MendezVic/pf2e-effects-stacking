# UI: Svelte 5 in ApplicationV2

This file covers only the **Foundry integration** — the glue Svelte's own docs will
never describe. For the language itself (runes, syntax, component gotchas), use Svelte's
AI tooling, below; don't rely on memory.

## The shell pattern

Every window stays an `ApplicationV2` (the v14 hard rule); Svelte renders its content.
The shell is thin — mount a component, hand it the app instance, unmount on close.

```ts
// src/ui/ExampleApp.ts
import { mount, unmount } from 'svelte';
import Example from './Example.svelte';

const { ApplicationV2 } = foundry.applications.api;

export class ExampleApp extends ApplicationV2 {
  static override DEFAULT_OPTIONS = {
    id: 'pf2e-example',
    tag: 'section',
    classes: ['pf2e-example'],
    window: { title: 'Example', icon: 'fa-solid fa-flask', resizable: false },
    position: { width: 420, height: 'auto' as const },
  };

  #component?: ReturnType<typeof mount>;
  #root?: HTMLElement;

  static open(): ExampleApp {
    const app = new ExampleApp();
    app.render({ force: true });
    return app;
  }

  // AppV2 runs _renderHTML on every render; mount once and reuse the node, so a
  // re-render neither leaks a second component (the first is never unmounted) nor
  // discards Svelte's reactive state. Svelte drives all updates from here.
  protected override async _renderHTML(): Promise<HTMLElement> {
    if (!this.#component) {
      this.#root = document.createElement('div');
      this.#component = mount(Example, { target: this.#root, props: { app: this } });
    }
    return this.#root!;
  }

  protected override _replaceHTML(result: HTMLElement, content: HTMLElement): void {
    content.replaceChildren(result);
  }

  protected override async _preClose(): Promise<void> {
    if (this.#component) {
      unmount(this.#component);
      this.#component = undefined;
      this.#root = undefined;
    }
  }
}
```

Lifecycle mapping:
- `_renderHTML()` — mount the component **once** into a detached element and cache both;
  return the cached element on every later render. Re-mounting per render leaks the prior
  component (it's never unmounted) and throws away Svelte's reactive state.
- `_replaceHTML(result, content)` — `content.replaceChildren(result)` (idempotent — `result`
  is the same cached node each render).
- `_preClose()` — `unmount(this.#component)` so the component cleans up.

ApplicationV2's abstract signatures (in the `foundry-pf2e` typedefs) are
`_renderHTML(context, options): Promise<unknown>` and
`_replaceHTML(result: unknown, content: HTMLElement, options): void`. Overriding with
narrower or fewer params (omit `options`, return `HTMLElement`) is fine.

The component receives the app as a prop and drives the window through it:

```svelte
<!-- src/ui/Example.svelte -->
<script lang="ts">
  import type { ExampleApp } from './ExampleApp';
  let { app }: { app: ExampleApp } = $props();
</script>

<button type="button" onclick={() => app.close()}>Close</button>
```

## Svelte 5, not 4

Mount with `mount`/`unmount` from `svelte` and use runes inside components. Do **not**
use the Svelte 4 forms (`new Component({ target, props })`, `$destroy()`, `export let`,
`$:`, `on:click`). Older Foundry-Svelte modules (e.g. pf2e-reignmaker) are Svelte 4 —
translate their snippets when you copy from them.

## The `*.svelte` ambient shim

So `.ts` files can `import Example from './Example.svelte'` under `tsc`:

```ts
// src/app.d.ts
declare module '*.svelte' {
  import type { Component } from 'svelte';
  const component: Component<Record<string, unknown>>;
  export default component;
}
```

`svelte-check` type-checks the components; `tsc` covers the `.ts`. `npm run check` runs both.

## Wiring

`svelte.config.ts` uses `vitePreprocess()`; `vite.config.ts` registers the `svelte()`
plugin (see `vite-build.md`). Component `<style>` blocks are scoped and fold into the
single emitted `.css`.

## The language itself — use Svelte's AI tooling

Svelte ships an MCP server / CLI (`@sveltejs/mcp`). Reach for it instead of recalling
syntax — it pulls from the official docs and validates code:

- **Validate every component you write:** `npx -y @sveltejs/mcp svelte-autofixer <file>` —
  static analysis that catches common AI Svelte 5 mistakes. Run it after editing a `.svelte`.
- **Look up the language:** `npx -y @sveltejs/mcp list-sections`, then
  `npx -y @sveltejs/mcp get-documentation <sections>`.
- **Persistent option:** add the stdio MCP server `npx -y @sveltejs/mcp` to the MCP config
  for tools/prompts/resources in every session.
- **Bulk context to fetch:** `https://svelte.dev/docs/svelte/llms.txt` (Svelte),
  `https://svelte.dev/llms-small.txt` / `-medium` / `-full` (Svelte + SvelteKit).
