# web-template

Copier template for jakoblui.com's sites. Everything under `template/` is rendered into new repos; the rest belongs to the template repo itself.

## Commands
```sh
uv tool install copier
scripts/test-template.sh false false   # theme_toggle use_api [csp]: render and check it (CI runs the combinations)
SHARED_UI_TARBALL=/abs/path/shared-ui.tgz NODE_AUTH_TOKEN=placeholder scripts/test-template.sh false false   # with an unpublished shared-ui
```
`scripts/test-template.sh` needs `NODE_AUTH_TOKEN` (a token with `read:packages`; locally `NODE_AUTH_TOKEN=$(gh auth token)`), Docker and network access. `SHARED_UI_TARBALL` must be an absolute path to a `.tgz`. The tests rendered into every site are in `template/src/*.test.ts*`.

## Layout
- `template/`: what a new site gets. `copier.yml`: the questions, `_skip_if_exists` and `_tasks`.
- `scripts/test-template.sh`: renders and checks the template; `.github/workflows/ci.yml` runs it.

## Rules
- `.jinja` only on files that use template variables. The generated `.gitignore` is `template/.gitignore.jinja` regardless, so git doesn't apply it to the template itself.
- In templated GitHub workflows, wrap `${{ … }}` in `{% raw %}…{% endraw %}`.
- Keep `--vcs-ref HEAD` in `scripts/test-template.sh`: without it, Copier renders the latest tag and ignores the working tree.
- Conditional files and folders use a name that renders empty when off (`src/{% if use_api %}api{% endif %}/`, `{% if use_api %}orval.config.ts{% endif %}.jinja`).
- Code every site must share exactly (the header, theme, 404 content, theme toggle) goes in shared-ui; the template only wires it in. Static files every site serves (the favicons) go here, rendered from `template/public/icon.svg.jinja`, the only icon source.
- The site-transition head script in `template/index.html.jinja` uses shared-ui's names for its attributes, cookie and `covered` state; `template/src/site-transition-head-script.test.ts` checks them against the installed shared-ui.
- With `csp`, `template/scripts/prerender.mjs.jinja` hashes shared-ui's `speculationRulesText`, never a copy of that text.
- `_skip_if_exists` files (`README.md`, `CLAUDE.md`, `src/routes/index.tsx`, `src/components/app-header/app-header.tsx`, `src/components/not-found-page/not-found-page.tsx`, `public/sitemap.xml`) are the site's own after the first render: a change to them only reaches new repos; tell existing ones by hand if it matters.
- Moving a `_skip_if_exists` file is a breaking change: `copier update` deletes the site's file at the old path, changes and all, without a conflict, and renders the default at the new one. The site restores its version from git.
- Releases are git tags (`v0.1.0`), made after merging, never on a branch. A release reaches every site in the same ship, through `copier update` in each (Shipping in `platform-docs/conventions.md`); sites don't take template-owned changes by hand.
- Dependency ranges, never `latest` (it churns the lockfile). Packages that must match (vitest and `@vitest/browser-playwright`) get the same range.
- In a generated repo, keep the repo's own additions at least one line away from template lines, or `copier update` conflicts on them.
