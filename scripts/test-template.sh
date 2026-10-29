#!/usr/bin/env bash
# Render the template and check the generated app: install, lint, build, tests, Storybook, and both
# images as served by nginx.
# Usage: scripts/test-template.sh <theme_toggle: true|false> <use_api: true|false>
# Needs NODE_AUTH_TOKEN: a GitHub token with read:packages, for @jakoblui-works/shared-ui (the Docker
# builds take it as a secret; installs read it through the user-level npmrc, see the README).
set -euo pipefail

if [[ $# -ne 2 || ! $1 =~ ^(true|false)$ || ! $2 =~ ^(true|false)$ ]]; then
    echo "usage: $0 <theme_toggle: true|false> <use_api: true|false>" >&2
    exit 2
fi
theme_toggle=$1
use_api=$2
: "${NODE_AUTH_TOKEN:?set NODE_AUTH_TOKEN to a GitHub token with read:packages}"

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
app=example-web
tmp=$(mktemp -d)
project="$tmp/$app"
tag="test-template-$$"
site_image="$app:$tag"
storybook_image="$app-storybook:$tag"
site_container="$app-$tag"
storybook_container="$app-storybook-$tag"

cleanup() {
    docker rm -f "$site_container" "$storybook_container" >/dev/null 2>&1 || true
    docker rmi -f "$site_image" "$storybook_image" >/dev/null 2>&1 || true
    rm -rf "$tmp"
}
trap cleanup EXIT

step() { printf '\n==> %s\n' "$*"; }
fail() { printf 'FAILED: %s\n' "$*" >&2; exit 1; }

# `cv` is in shared-ui's sites.ts, which AppHeader's `current` is typed by.
# Part of T2: a plain file next to its .jinja twin renders to the same path, and Copier silently
# keeps one of them.
step "No file in the template both plain and as .jinja"
twins=$(cd "$repo/template" && find . -name '*.jinja' | while read -r j; do if [[ -e ${j%.jinja} ]]; then echo "${j%.jinja}"; fi; done)
[[ -z $twins ]] || fail "plain and .jinja versions of: $twins"

step "Render (theme_toggle=$theme_toggle, use_api=$use_api)"
answers=(-d app_name="$app" -d subdomain=cv -d description="An example app's \"page\", with \$1 & <b>." -d theme_toggle="$theme_toggle" -d use_api="$use_api")
[[ $use_api == true ]] && answers+=(-d api_tag=cv)
copier copy --trust --defaults --vcs-ref HEAD "${answers[@]}" "$repo" "$project"
cd "$project"

# T2. node_modules and the lockfile come from the install task, not the template.
step "No unrendered Jinja"
jinja='\{\{|\{%|\{#'
bad_names=$(find . -path ./node_modules -prune -o -path ./.git -prune -o -print | grep -E "$jinja" || true)
# Strip GitHub Actions expressions (${{ ... }}) before matching; print the original line.
bad_lines=$(grep -rnIE "$jinja" --exclude-dir=node_modules --exclude-dir=.git --exclude=pnpm-lock.yaml . \
    | awk '{ line = $0; gsub(/\$\{\{[^}]*\}\}/, "", line); if (line ~ /\{\{|\{%|\{#/) print $0 }' || true)
if [[ -n $bad_names || -n $bad_lines ]]; then
    [[ -n $bad_names ]] && printf 'Unrendered Jinja in file names:\n%s\n' "$bad_names" >&2
    [[ -n $bad_lines ]] && printf 'Unrendered Jinja in files:\n%s\n' "$bad_lines" >&2
    exit 1
fi

# T1
step "pnpm install --frozen-lockfile"
pnpm install --frozen-lockfile
step "lint"
pnpm run lint
step "build (with prerender and tsc)"
pnpm run build
step "test"
pnpm exec playwright install chromium >/dev/null
pnpm run test
step "build-storybook"
pnpm run build-storybook

# T6: the inline script in index.html and ThemeToggle read and write the same key.
if [[ $theme_toggle == true ]]; then
    step "index.html's theme script reads shared-ui's THEME_STORAGE_KEY"
    key=$(node --input-type=module -e 'import { THEME_STORAGE_KEY } from "@jakoblui-works/shared-ui"; process.stdout.write(THEME_STORAGE_KEY)' 2>/dev/null) \
        || key=$(grep -oE 'THEME_STORAGE_KEY = "[^"]+"' node_modules/@jakoblui-works/shared-ui/dist/index.js | cut -d'"' -f2)
    [[ -n $key ]] || fail "couldn't read THEME_STORAGE_KEY from the package"
    grep -qF "localStorage.getItem(\"$key\")" index.html \
        || fail "index.html's script doesn't read localStorage key \"$key\""
    echo "Both use \"$key\""
fi

step "Docker images"
docker build -q --secret id=npm_token,env=NODE_AUTH_TOKEN -t "$site_image" . >/dev/null
docker build -q -f Dockerfile.storybook --secret id=npm_token,env=NODE_AUTH_TOKEN -t "$storybook_image" . >/dev/null

# T5
step "No token in either image"
for image in "$site_image" "$storybook_image"; do
    # Counted rather than `grep -q`, which stops reading early: under pipefail, the writer's SIGPIPE
    # would make a match look like no match.
    # docker's own failures stop the script; only grep's "no match" (exit 1) is let through.
    history=$(docker history --no-trunc "$image")
    in_history=$(grep -cF "$NODE_AUTH_TOKEN" <<<"$history" || true)
    [[ $in_history == 0 ]] || fail "the token is in $image's history"
    # The image's own files: the served build and nginx's config (BusyBox grep, so no --exclude-dir).
    in_files=$(docker run --rm --entrypoint sh "$image" -c 'grep -rlsF "$0" /usr/share/nginx/html /etc/nginx; [ $? -le 1 ]' "$NODE_AUTH_TOKEN")
    [[ -z $in_files ]] || fail "the token is in $image: $in_files"
done
echo "Neither image holds it"

# Starts a container and prints its address once nginx answers.
serve() {
    local name=$1 image=$2 port
    docker run -d --name "$name" -p 127.0.0.1::80 "$image" >/dev/null
    port=$(docker port "$name" 80/tcp | head -1 | cut -d: -f2)
    for _ in $(seq 1 20); do
        if curl -fs -o /dev/null "http://127.0.0.1:$port/"; then
            echo "http://127.0.0.1:$port"
            return
        fi
        sleep 0.5
    done
    docker logs "$name" >&2
    fail "nginx in $image didn't answer"
}
header() { grep -i "^$1:" | head -1 | cut -d: -f2- | tr -d '\r' | sed 's/^ *//'; }

# T3
step "The site image serves the app"
site=$(serve "$site_container" "$site_image")
home=$(curl -s -D - -o "$tmp/home.html" "$site/")
[[ $(head -1 <<<"$home") == *" 200"* ]] || fail "/ didn't return 200"
grep -q 'data-prerendered="/"' "$tmp/home.html" || fail "/ isn't the prerendered home page"
[[ $(header cache-control <<<"$home") == no-cache ]] || fail "/ isn't no-cache"
asset=$(grep -oE '/assets/[^"]+\.js' "$tmp/home.html" | head -1 || true)
[[ -n $asset ]] || fail "no script in /assets/ on the home page"
asset_headers=$(curl -s -D - -o /dev/null -H 'Accept-Encoding: gzip' "$site$asset")
[[ $(header cache-control <<<"$asset_headers") == *immutable* ]] || fail "$asset isn't cached as immutable"
[[ $(header content-encoding <<<"$asset_headers") == gzip ]] || fail "$asset isn't gzipped"
missing=$(curl -s -D - -o "$tmp/missing.html" "$site/no-such-page")
[[ $(head -1 <<<"$missing") == *" 404"* ]] || fail "an unknown path didn't return 404"
grep -q 'data-prerendered="/404"' "$tmp/missing.html" || fail "an unknown path isn't served the prerendered 404 page"
echo "200 and no-cache for /, immutable and gzip for $asset, 404 with 404.html for an unknown path"

# T4
step "The Storybook image serves index.json for composition"
storybook=$(serve "$storybook_container" "$storybook_image")
origin=https://storybook.jakoblui.com
index=$(curl -s -D - -o "$tmp/index.json" -H "Origin: $origin" "$storybook/index.json")
[[ $(head -1 <<<"$index") == *" 200"* ]] || fail "index.json didn't return 200"
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$tmp/index.json" || fail "index.json isn't JSON"
[[ $(header access-control-allow-origin <<<"$index") == "$origin" ]] || fail "index.json doesn't allow $origin"
[[ $(header access-control-allow-credentials <<<"$index") == true ]] || fail "index.json doesn't allow credentials"
echo "index.json allows $origin, with credentials"

step "All checks passed (theme_toggle=$theme_toggle, use_api=$use_api)"
