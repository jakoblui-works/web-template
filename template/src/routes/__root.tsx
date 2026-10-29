import { Outlet, Scripts, createRootRoute } from "@tanstack/react-router";

import { NotFoundPage } from "@/components/not-found-page";

// Each page renders the header itself (`AppHeader`), so a page can place it where it needs to.
// `Scripts` writes the router's state into prerendered pages, for hydrating them (see `main.tsx`).
// The scripts remove themselves once run, and it renders nothing in the browser, so the markup
// still matches.
const RootComponent = () => {
  return (
    <>
      <Outlet />
      <Scripts />
    </>
  );
};

// Any URL without a route. Built into `404.html` too (see `prerender.tsx`), which nginx serves for
// missing files.
export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: NotFoundPage,
});
