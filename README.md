# web-template

A [Copier](https://copier.readthedocs.io/) template for a jakoblui.com frontend: React 19, Vite, TanStack Router, Tailwind 4, shadcn on Base UI, Storybook 10, Vitest, ESLint, pnpm. The header, theme and 404 content come from [shared-ui](https://github.com/jakoblui-works/shared-ui). Pages are prerendered and hydrated, nginx serves real 404s, and CI builds the site and Storybook images, pushes them to GHCR and triggers the infra deploy.

## Make a frontend
```sh
uv tool install copier
copier copy --trust gh:jakoblui-works/web-template my-web
```
`--trust` lets the template run its tasks: `pnpm install` (so the generated CI's `--frozen-lockfile` works) and, with the api, `pnpm generate:api`. Installing needs a GitHub token with `read:packages` for shared-ui (`pnpm config set "//npm.pkg.github.com/:_authToken" <token>`).

Questions:
- `app_name`: repo, image and container name (`cv-web`).
- `subdomain`: the site's box in the shared header (`cv`; `www` for the hub). It must be in shared-ui's `sites.ts` first.
- `host`: the domain; defaults to `<subdomain>.jakoblui.com` (`jakoblui.com` for `www`).
- `title`, `description`: the page head and link previews.
- `palette`: the brand colour, a Tailwind palette name.
- `theme_toggle`: a light/dark toggle in the header (shared-ui's `ThemeToggle`); without it, dark-only.
- `use_api`: an Orval client for the api's `api_tag` endpoints, react-query, a dev proxy, and a CI check that the client matches the prod spec.

The new repo still needs:
- the `DEPLOY_REPO_DISPATCH_TOKEN` secret, which `deploy.yml` uses to trigger the infra deploy;
- read access to the shared-ui package for its Actions (the package's "Manage Actions access");
- its GHCR packages made public after the first push (new org packages start private);
- its infra side (compose service, Traefik router, DNS) and its place in the site-web x-ray.

## Update a frontend
```sh
copier update --trust
```
Run it in the generated repo with everything committed. Copier applies the template's changes since the version in `.copier-answers.yml` and keeps your own edits; conflicts show up as in a git merge. `README.md`, `CLAUDE.md`, the home page, `app-header.tsx` and `not-found-page.tsx` are written once and then left alone, since they become the repo's own.

## Layout
- `copier.yml`: the questions.
- `template/`: what gets rendered. Files ending in `.jinja` are templated; the rest are copied as they are.
- `scripts/test-template.sh`: renders the template and checks the result (CI runs it for each combination of `theme_toggle` and `use_api`).
- `scripts/render-icons.mjs`: renders `template/public/icon.svg` to the bitmap icons (`pnpm icons`).
