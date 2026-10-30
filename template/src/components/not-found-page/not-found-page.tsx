import { NotFound } from "@jakoblui-works/shared-ui";
import { Link, useLocation } from "@tanstack/react-router";

import { AppHeader } from "@/components/app-header/app-header";

// Any URL without a route, and `404.html`. shared-ui's default content; draw the site's own here
// to replace it.
export const NotFoundPage = () => {
  const path = useLocation({ select: (location) => location.pathname });
  return (
    <>
      <AppHeader />
      <main>
        <NotFound path={path} homeLink={<Link to="/" />} />
      </main>
    </>
  );
};
