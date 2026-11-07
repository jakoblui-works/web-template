#!/usr/bin/env bash
# Render the template and check the generated app: install, lint, build, tests, Storybook, and both
# images as served by nginx.
# With SHARED_UI_TARBALL=<absolute path to a .tgz>, shared-ui comes from that tarball instead of GitHub
# Packages (for a version not published yet); NODE_AUTH_TOKEN can then be a placeholder.
# Usage: scripts/test-template.sh <theme_toggle: true|false> <use_api: true|false> [csp: true|false]
# Needs NODE_AUTH_TOKEN: a GitHub token with read:packages, for @jakoblui-works/shared-ui (the Docker
# builds take it as a secret; installs read it through the user-level npmrc, see the README).
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 || ! $1 =~ ^(true|false)$ || ! $2 =~ ^(true|false)$ || ! ${3:-false} =~ ^(true|false)$ ]]; then
    echo "usage: $0 <theme_toggle: true|false> <use_api: true|false> [csp: true|false]" >&2
    exit 2
fi
theme_toggle=$1
use_api=$2
csp=${3:-false}
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

step "Render (theme_toggle=$theme_toggle, use_api=$use_api, csp=$csp)"
answers=(-d app_name="$app" -d subdomain=cv -d description="An example app's \"page\", with \$1 & <b>." -d theme_toggle="$theme_toggle" -d use_api="$use_api")
[[ $use_api == true ]] && answers+=(-d api_tag=cv)
# Strict: no inline scripts or third parties beyond what the build hashes.
policy="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
[[ $csp == true ]] && answers+=(-d csp="$policy")
tarball=${SHARED_UI_TARBALL:-}
if [[ -n $tarball ]]; then
    [[ $tarball == /* && $tarball == *.tgz && -f $tarball ]] || fail "SHARED_UI_TARBALL must be the absolute path of an existing .tgz: $tarball"
    # No tasks yet: the install must see the tarball first.
    copier copy --trust --skip-tasks --defaults --vcs-ref HEAD "${answers[@]}" "$repo" "$project"
else
    copier copy --trust --defaults --vcs-ref HEAD "${answers[@]}" "$repo" "$project"
fi
cd "$project"
if [[ -n $tarball ]]; then
    # Named by its content: pnpm reuses its cached copy of a tarball with the same name and version,
    # so a re-packed tarball would otherwise install as the old code.
    hash=$(sha256sum "$tarball" | cut -c1-12)
    tgz=shared-ui-$hash.tgz
    step "Using the local shared-ui tarball $tarball (sha256 $hash, as $tgz)"
    # In the render only. Next to package.json, so the Dockerfile's first COPY can name it.
    cp "$tarball" "$tgz"
    printf "overrides:\n  '@jakoblui-works/shared-ui': file:./%s\n" "$tgz" >> pnpm-workspace.yaml
    for dockerfile in Dockerfile Dockerfile.storybook; do
        sed -i "s|^COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./\$|COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc $tgz ./|" "$dockerfile"
        grep -q "^COPY .* $tgz ./\$" "$dockerfile" || fail "couldn't add the tarball to $dockerfile's first COPY"
    done
    # What copier's _tasks (copier.yml) would have run.
    pnpm install
    [[ $use_api == true ]] && pnpm generate:api
    pnpm ls @jakoblui-works/shared-ui
fi

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
# T8: the build renders the bitmap icons from icon.svg (nothing else would notice them missing).
step "The build renders favicon.ico (16/32/48) and apple-touch-icon.png (180) from icon.svg"
node --input-type=module <<'EOF' || fail "the icons in dist aren't right"
    import { readFileSync } from "node:fs";
    const pngSize = (png, where) => {
        if (png.readUInt32BE(0) !== 0x89504e47) throw new Error(`${where} isn't a PNG`);
        return [png.readUInt32BE(16), png.readUInt32BE(20)];
    };
    const ico = readFileSync("dist/favicon.ico");
    if (ico.readUInt16LE(2) !== 1) throw new Error("favicon.ico isn't an icon");
    const sizes = [];
    for (let i = 0; i < ico.readUInt16LE(4); i++) {
        const entry = 6 + 16 * i;
        const data = ico.subarray(ico.readUInt32LE(entry + 12), ico.readUInt32LE(entry + 12) + ico.readUInt32LE(entry + 8));
        const [w, h] = pngSize(data, `favicon.ico image ${i}`);
        if (w !== (ico[entry] || 256) || h !== (ico[entry + 1] || 256)) throw new Error(`favicon.ico image ${i} is ${w}x${h}, not what its entry says`);
        sizes.push(w);
    }
    if (sizes.join() !== "16,32,48") throw new Error(`favicon.ico holds ${sizes.join()}, not 16,32,48`);
    const [w, h] = pngSize(readFileSync("dist/apple-touch-icon.png"), "apple-touch-icon.png");
    if (w !== 180 || h !== 180) throw new Error(`apple-touch-icon.png is ${w}x${h}`);
    if (!readFileSync("dist/icon.svg", "utf8").includes("<svg")) throw new Error("dist/icon.svg isn't an SVG");
EOF
echo "favicon.ico holds 16, 32 and 48 px PNGs; apple-touch-icon.png is 180 px"

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
# Other sites prerender these pages for the site transitions (shared-ui's speculation rules), which
# Chromium only does across origins when the page opts in.
for page in home missing; do
    [[ $(header supports-loading-mode <<<"${!page}") == credentialed-prerender ]] \
        || fail "$page doesn't send Supports-Loading-Mode: credentialed-prerender"
done
# No generated app ships these yet, so put one of each into the running container.
docker exec "$site_container" sh -c 'head -c 4096 /dev/zero > /usr/share/nginx/html/assets/t3.wasm && head -c 4096 /dev/zero | tr "\\0" a > /usr/share/nginx/html/assets/t3.mjs'
wasm_headers=$(curl -s -D - -o /dev/null -H 'Accept-Encoding: gzip' "$site/assets/t3.wasm")
[[ $(header content-type <<<"$wasm_headers") == application/wasm ]] || fail ".wasm isn't served as application/wasm"
[[ $(header content-encoding <<<"$wasm_headers") == gzip ]] || fail ".wasm isn't gzipped"
mjs_headers=$(curl -s -D - -o /dev/null "$site/assets/t3.mjs")
[[ $(header content-type <<<"$mjs_headers") == application/javascript ]] || fail ".mjs isn't served as JavaScript"
echo "200 and no-cache for /, immutable and gzip for $asset, .wasm gzipped, .mjs as JavaScript, 404 with 404.html for an unknown path, both pages opt in to credentialed prerendering"

# T7
if [[ $csp == true ]]; then
    step "The CSP header allows the pages' inline scripts and speculation rules by hash, and the pages run without a violation"
    for page in home missing; do
        sent=$(header content-security-policy <<<"${!page}")
        [[ -n $sent ]] || fail "no Content-Security-Policy on $page"
        # The answer, with hashes added to script-src only (no 'inline-speculation-rules': Chromium
        # ignores it once script-src lists hashes).
        [[ $(sed -E "s/ 'sha256-[^']+'//g" <<<"$sent") == "$policy" ]] || fail "$page's policy isn't the answer plus hashes: $sent"
        node --input-type=module -e '
            import { createHash } from "node:crypto";
            import { readFileSync } from "node:fs";
            const [file, sent] = process.argv.slice(1);
            const html = readFileSync(file, "utf8");
            const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter(([, a]) => !/\ssrc=/.test(a));
            if (scripts.length === 0) throw new Error("no inline scripts to check");
            for (const [, , body] of scripts) {
                const hash = `sha256-${createHash("sha256").update(body).digest("base64")}`;
                if (!sent.includes(`'\''${hash}'\''`)) throw new Error(`inline script ${hash} not allowed`);
            }' "$tmp/$page.html" "$sent" || fail "an inline script on $page isn't allowed by the policy"
    done
    # The rules SiteHeader inserts are allowed by their hash: read from the page as it runs.
    SITE="$site" POLICY="$(header content-security-policy <<<"$home")" node --input-type=module -e '
        import { createHash } from "node:crypto";
        import { chromium } from "playwright";
        const browser = await chromium.launch();
        const violations = [];
        for (const path of ["/", "/no-such-page"]) {
            const page = await browser.newPage();
            page.on("console", (m) => { if (/Content.Security.Policy/i.test(m.text())) violations.push(`${path}: ${m.text()}`); });
            await page.addInitScript(() => {
                document.addEventListener("securitypolicyviolation", (e) => console.error(`Content Security Policy: ${e.violatedDirective} ${e.blockedURI}`));
            });
            await page.goto(process.env.SITE + path, { waitUntil: "networkidle" });
            if (path === "/") {
                // SiteHeader inserts the speculation rules once the app runs.
                const rules = await page.waitForSelector(`script[type="speculationrules"]`, { state: "attached" })
                    .then((script) => script.evaluate((element) => element.textContent))
                    .catch(() => violations.push("/: no speculation rules inserted"));
                if (typeof rules === "string") {
                    const hash = `sha256-${createHash("sha256").update(rules).digest("base64")}`;
                    if (!process.env.POLICY.includes(`'\''${hash}'\''`)) violations.push(`/: the speculation rules (${hash}) aren'\''t in the policy`);
                }
                // Let a violation the insertion caused reach the console before the page closes.
                await page.evaluate(() => new Promise((resolve) => setTimeout(resolve)));
            }
            await page.close();
        }
        await browser.close();
        if (violations.length) { console.error(violations.join("\n")); process.exit(1); }' || fail "the pages break the policy in Chromium"
    echo "Both pages send the policy with their inline scripts' and the speculation rules' hashes; / inserts its speculation rules; no violations in Chromium"
else
    [[ -z $(header content-security-policy <<<"$home") ]] || fail "a Content-Security-Policy without the csp answer"
fi

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

step "All checks passed (theme_toggle=$theme_toggle, use_api=$use_api, csp=$csp)"
