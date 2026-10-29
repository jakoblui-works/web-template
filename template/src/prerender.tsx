// Pages as HTML, built with `vite build --ssr` and written into `dist` by `scripts/prerender.mjs`:
// the home page, so crawlers get its text without running JavaScript, and the 404 page. Rendered
// with the router's SSR setup, so the page carries the router's state (`<Scripts />` in
// `__root.tsx`) and the browser can hydrate it (see `main.tsx`).
import { RouterServer, createRequestHandler } from "@tanstack/react-router/ssr/server";
import { prerender } from "react-dom/static";

import { createRouter } from "./router";

export const render = async (url: string) => {
  const handler = createRequestHandler({
    request: new Request(new URL(url, "http://localhost")),
    createRouter,
  });
  // Rendered here rather than with the router's `renderRouterToString`, which can't fail: an error
  // inside a Suspense boundary (the root route wraps the page in one) doesn't throw, React renders
  // a client-rendering fallback instead. Collected here, so the build fails rather than shipping an
  // empty page. `<Scripts />` writes all of the router's state during the render (there's no
  // deferred data to stream after it), so the markup is the whole page.
  const response = await handler(async ({ router }) => {
    const errors: unknown[] = [];
    const { prelude } = await prerender(<RouterServer router={router} />, {
      onError: (error) => {
        errors.push(error);
      },
    });
    if (errors.length > 0) throw new AggregateError(errors, `Prerendering ${url} failed`);
    return new Response(prelude);
  });
  return response.text();
};
