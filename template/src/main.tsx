import { RouterProvider, deepEqual } from "@tanstack/react-router";
import { RouterClient } from "@tanstack/react-router/ssr/client";
import ReactDOM from "react-dom/client";

import { createRouter } from "./router";
import "./styles.css";

const router = createRouter();

/**
 * The search params a URL's routes read: only what their schemas validate (`_strictSearch`; a
 * match's `search` also passes on every other param), so ones the app doesn't use (`?fbclid`,
 * `?utm_source`) drop out. `null` if they don't validate, or the router no longer says.
 */
const searchFor = ({ pathname, search }: { pathname: string; search: string }) => {
  const match = router.matchRoutes(pathname, router.options.parseSearch(search)).at(-1);
  if (!match || match.searchError) return null;
  return typeof match._strictSearch === "object" ? match._strictSearch : null;
};

/** Whether this URL renders the same page as `url`: the same path and the same search params. */
const rendersAs = (url: URL) => {
  if (url.pathname !== location.pathname) return false;
  const search = searchFor(url);
  return search !== null && deepEqual(search, searchFor(location));
};

// Built pages hold a prerendered page (see `prerender.tsx`), marked with the URL it was rendered
// for. On a URL that renders the same it's hydrated, so it isn't drawn again. On any other (a
// made-up path served the 404 page, search params the page renders differently) it would differ
// from what the app renders, so it's replaced with a fresh render, as is the empty page in dev.
const prerendered = document.querySelector<HTMLElement>("[data-prerendered]");
if (
  prerendered?.dataset.prerendered &&
  rendersAs(new URL(prerendered.dataset.prerendered, location.origin))
) {
  ReactDOM.hydrateRoot(prerendered, <RouterClient router={router} />);
} else {
  ReactDOM.createRoot(document.getElementById("app")!).render(<RouterProvider router={router} />);
}
