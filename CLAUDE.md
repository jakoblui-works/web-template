# web-template

Copier template for jakoblui.com frontends. Everything under `template/` is rendered into new repos; the rest (this file, the README, `scripts/`, `.github/`) belongs to the template repo itself.

## Commands
```sh
uv tool install copier
scripts/test-template.sh false false   # render (theme_toggle, use_api[, csp]) and check it; CI runs all four, plus ats-web's with csp
SHARED_UI_TARBALL=/abs/path/shared-ui.tgz NODE_AUTH_TOKEN=placeholder scripts/test-template.sh false false   # shared-ui from a local tarball
```
The script needs `NODE_AUTH_TOKEN` (a GitHub token with `read:packages`; locally `NODE_AUTH_TOKEN=$(gh auth token)`), Docker, and network access (the api renders read the prod OpenAPI spec). `SHARED_UI_TARBALL` (an absolute path to a `.tgz`) installs shared-ui from that file instead of GitHub Packages, for a version not published yet: the script renders with `--skip-tasks`, copies the tarball into the render as `shared-ui-<first 12 hex of its sha256>.tgz` (pnpm caches by name and version, so a re-packed tarball needs a new name), overrides the dependency in the render's `pnpm-workspace.yaml`, adds the file to the first `COPY` of the render's `Dockerfile` and `Dockerfile.storybook`, runs the `_tasks` by hand (mirror `copier.yml`'s) and prints the installed version; `template/` is untouched. It renders, installs with `--frozen-lockfile`, lints, builds (with the prerender), tests, builds Storybook, then builds both images and checks them as nginx serves them:
- **T1:** every answer combination installs, lints, builds and tests.
- **T2:** nothing unrendered (`{{`, `{%`, `{#` outside GitHub expressions).
- **T3:** the site image: `/` is the prerendered page with `no-cache`, `/assets/` is `immutable` and gzipped, `.wasm` is gzipped `application/wasm` and `.mjs` is JavaScript, an unknown path is a 404 with `404.html`; `/` and the 404 page send `Supports-Loading-Mode: credentialed-prerender` (other sites prerender them).
- **T4:** the Storybook image serves `index.json` with the CORS headers storybook-host's composition needs.
- **T5:** the package token is in neither image.
- **T6:** with `theme_toggle`, `index.html`'s script reads shared-ui's `THEME_STORAGE_KEY`.
- **T7:** with `csp`, `/` and the 404 page send the answer's policy with the hashes of their inline scripts and of shared-ui's speculation rules added to `script-src` (nothing else), and both load in Chromium without a CSP violation, `/` with the speculation rules inserted and their hash in the policy; without it, no CSP header.
- **T8:** the build renders `favicon.ico` (16, 32 and 48 px PNGs) and `apple-touch-icon.png` (180 px) into `dist/`.
- **G1** (`template/src/app.test.tsx.jinja`, rendered into every app): the header shows the app's `subdomain` and links home.
- **G2** (`template/src/site-transition-head-script.test.ts`, rendered into every app): `index.html`'s site-transition head script uses shared-ui's `SITE_TRANSITION_ATTRIBUTE`, `SITE_TRANSITION_TO_ATTRIBUTE`, `SITE_TRANSITION_COOKIE` and `SITE_TRANSITION_STATES.covered`.
- **G3** (same file): the head script, run in jsdom with fake timers: no cookie, or one for another host, never marks the page (and keeps that cookie); a cookie for this host marks it `covered` at once, deletes the cookie (for each kind of host: two or more labels, `localhost`, an IP) and clears the mark by itself only while it still reads `covered` (`revealing` is shared-ui's to finish, `leaving` stays); a prerendered page is covered from the start, keeps the cover through activation with the cookie and loses it at activation without.

The site-transition head script and prerendering (`template/index.html.jinja`, `template/nginx.conf.jinja`): the site-transition head script covers an arrival before the first paint from shared-ui's cookie signal and uncovers by itself after about a second if the page still reads `covered`; its attribute and cookie names are shared with shared-ui, and G2 checks them. nginx opts pages into prerendering with `Supports-Loading-Mode` (`always`, so the 404 page gets it). With `csp`, `scripts/prerender.mjs` adds the hashes of the inline scripts and of shared-ui's speculation rules, taken from its `speculationRulesText` so the two can't drift.

## Rules
- `.jinja` only on files that use template variables. The generated `.gitignore` is `template/.gitignore.jinja` regardless, so git doesn't apply it to the template itself.
- In templated GitHub workflows, wrap `${{ … }}` in `{% raw %}…{% endraw %}`.
- `scripts/test-template.sh` renders with `--vcs-ref HEAD`: without it, Copier renders the latest tag and ignores the working tree.
- Conditional files and folders use a name that renders empty when off (`src/{% if use_api %}api{% endif %}/`, `{% if use_api %}orval.config.ts{% endif %}.jinja`).
- Code every site must share exactly (the header, theme, 404 content, theme toggle) goes in shared-ui, not here; the template only wires it in. Static files every site serves (the favicons) go here. `public/icon.svg` is the only icon source, with the dot in the site's palette; `scripts/icons-plugin.mjs` renders the bitmap icons from it in each build.
- The pages are the app's own from the first render (`_skip_if_exists`): the home route, `app-header.tsx`, `not-found-page.tsx`, plus `README.md` and `CLAUDE.md`. A change to them only reaches new repos; tell existing ones by hand if it matters.
- Moving a `_skip_if_exists` file is a breaking change for repos made from the template: `copier update` deletes the repo's file at the old path, with its changes and no conflict, and renders the default at the new one. Restore the repo's version from git afterwards (seen moving `app-header.tsx`, `v0.2.0`).
- Releases are git tags (`v0.1.0`); `copier update` moves between them. Tag after merging, not on a branch.
- A release reaches every site in the same ship, through `copier update` in each (see Shipping in `platform-docs/conventions.md`); sites don't take template-owned changes by hand.
- Dependency ranges, not `latest`: `latest` re-resolves on every `pnpm add` and churns the lockfile. Packages that must match (vitest and `@vitest/browser-playwright`) get the same range, or a fresh install mixes versions.
- In a generated repo, keep the repo's own additions at least one line away from template lines: git treats changes on adjacent lines as one conflict.
