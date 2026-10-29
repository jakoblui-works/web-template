# web-template

Copier template for jakoblui.com frontends. Everything under `template/` is rendered into new repos; the rest (this file, the README, `package.json`, `scripts/`, `.github/`) belongs to the template repo itself.

## Commands
```sh
uv tool install copier
scripts/test-template.sh false false   # render (theme_toggle, use_api) and check it; CI runs all four
pnpm install && pnpm icons             # render template/public/icon.svg to favicon.ico and apple-touch-icon.png
```
The script needs `NODE_AUTH_TOKEN` (a GitHub token with `read:packages`; locally `NODE_AUTH_TOKEN=$(gh auth token)`), Docker, and network access (the api renders read the prod OpenAPI spec). It renders, installs with `--frozen-lockfile`, lints, builds (with the prerender), tests, builds Storybook, then builds both images and checks them as nginx serves them:
- **T1:** every answer combination installs, lints, builds and tests.
- **T2:** nothing unrendered (`{{`, `{%`, `{#` outside GitHub expressions).
- **T3:** the site image: `/` is the prerendered page with `no-cache`, `/assets/` is `immutable` and gzipped, an unknown path is a 404 with `404.html`.
- **T4:** the Storybook image serves `index.json` with the CORS headers storybook-host's composition needs.
- **T5:** the package token is in neither image.
- **T6:** with `theme_toggle`, `index.html`'s script reads shared-ui's `THEME_STORAGE_KEY`.
- **G1** (`template/src/app.test.tsx.jinja`, rendered into every app): the header shows the app's `subdomain` and links home.

## Rules
- `.jinja` only on files that use template variables. The generated `.gitignore` is `template/.gitignore.jinja` regardless, so git doesn't apply it to the template itself.
- In templated GitHub workflows, wrap `${{ … }}` in `{% raw %}…{% endraw %}`.
- `scripts/test-template.sh` renders with `--vcs-ref HEAD`: without it, Copier renders the latest tag and ignores the working tree.
- Conditional files and folders use a name that renders empty when off (`src/{% if use_api %}api{% endif %}/`, `{% if use_api %}orval.config.ts{% endif %}.jinja`).
- Code every site must share exactly (the header, theme, 404 content, theme toggle) goes in shared-ui, not here; the template only wires it in. Static files every site serves (the favicons) go here.
- The pages are the app's own from the first render (`_skip_if_exists`): the home route, `app-header.tsx`, `not-found-page.tsx`, plus `README.md` and `CLAUDE.md`. A change to them only reaches new repos; tell existing ones by hand if it matters.
- Releases are git tags (`v0.1.0`); `copier update` moves between them. Tag after merging, not on a branch.
- Dependency ranges, not `latest`: `latest` re-resolves on every `pnpm add` and churns the lockfile. Packages that must match (vitest and `@vitest/browser-playwright`) get the same range, or a fresh install mixes versions.
- In a generated repo, keep the repo's own additions at least one line away from template lines: git treats changes on adjacent lines as one conflict.
