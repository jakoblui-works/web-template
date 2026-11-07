import {
  SITE_TRANSITION_ATTRIBUTE,
  SITE_TRANSITION_COOKIE,
  SITE_TRANSITION_TO_ATTRIBUTE,
} from "@jakoblui-works/shared-ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import indexHtml from "../index.html?raw";

// The arrival side of shared-ui's site transitions: the inline script in index.html's <head> that
// covers the page before its first paint when the visitor arrives from another site, and uncovers
// it by itself if shared-ui's JavaScript never does. The names are shared-ui's; the cookie is the
// one shared-ui's click handler writes: `<cookie>=<destination host>`, Domain the host's last two
// labels (none for a single label or an IP), path=/, max-age=10, SameSite=Lax.

// vitest's jsdom environment, which the tests move between hosts and whose cookies they reset.
declare const jsdom: {
  reconfigure(options: { url: string }): void;
  cookieJar: { removeAllCookiesSync(): void };
};

// C3: the script uncovers the page by itself after about 1 s. The bound is that plus slack; the
// exact delay stays the script's to choose.
const NEVER_STUCK_MS = 2_000;

const escape = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The name on its own, not as part of a longer one (`data-site-transition` in `data-site-transition-to`). */
const mentions = (name: string) => new RegExp(`(?<![\\w-])${escape(name)}(?![\\w-])`);

/** index.html's inline classic scripts in <head>, in order (the theme script among them). */
const headScripts = () =>
  [...new DOMParser().parseFromString(indexHtml, "text/html").head.querySelectorAll("script")]
    .filter((script) => !script.src && (!script.type || script.type === "text/javascript"))
    .map((script) => script.text);

/** Runs index.html's inline head scripts against this document, as the browser does on load. */
const runHeadScripts = () => {
  const scripts = headScripts();
  expect(
    scripts.some((script) => mentions(SITE_TRANSITION_COOKIE).test(script)),
    "index.html has no inline head script that reads the site-transition cookie",
  ).toBe(true);
  for (const script of scripts) new Function(script)();
};

const root = () => document.documentElement;
const mark = () => root().getAttribute(SITE_TRANSITION_ATTRIBUTE);
const signal = () =>
  document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(`${SITE_TRANSITION_COOKIE}=`))
    ?.slice(SITE_TRANSITION_COOKIE.length + 1);

/** What shared-ui's click handler on another site writes, for a page on `domain` (or host-only). */
const writeSignal = (destination: string, domain: string | null) => {
  document.cookie = [
    `${SITE_TRANSITION_COOKIE}=${destination}`,
    ...(domain ? [`Domain=${domain}`] : []),
    "path=/",
    "max-age=10",
    "SameSite=Lax",
  ].join("; ");
};

/** Every value the mark takes from now on, including ones set and removed within a task. */
const recordMarks = () => {
  const seen: (string | null)[] = [];
  const observer = new MutationObserver((records) => {
    for (const record of records) seen.push((record.target as Element).getAttribute(SITE_TRANSITION_ATTRIBUTE));
  });
  observer.observe(root(), { attributes: true, attributeFilter: [SITE_TRANSITION_ATTRIBUTE] });
  return () => {
    for (const record of observer.takeRecords()) seen.push((record.target as Element).getAttribute(SITE_TRANSITION_ATTRIBUTE));
    observer.disconnect();
    return seen;
  };
};

let prerendering: boolean | undefined;

beforeEach(() => {
  // Timers only, not Date: jsdom's cookie jar expires cookies by Date, so a faked clock would expire
  // the test's own cookie (max-age=10) while the tests wait out the script's clear.
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "setImmediate",
      "clearImmediate",
      "requestAnimationFrame",
      "cancelAnimationFrame",
    ],
  });
  // jsdom has no matchMedia; the theme script (with theme_toggle) asks it for the system theme.
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query }));
  prerendering = undefined;
  jsdom.reconfigure({ url: "https://cv.jakoblui.com/" });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (document as { prerendering?: boolean }).prerendering;
  root().removeAttribute(SITE_TRANSITION_ATTRIBUTE);
  root().removeAttribute(SITE_TRANSITION_TO_ATTRIBUTE);
  root().classList.remove("dark");
  jsdom.cookieJar.removeAllCookiesSync();
  jsdom.reconfigure({ url: "http://localhost:3000/" });
});

/** Makes this document a prerendered one until `activate()` (Chromium's `document.prerendering`). */
const startPrerendering = () => {
  prerendering = true;
  Object.defineProperty(document, "prerendering", { configurable: true, get: () => prerendering });
};
const activate = () => {
  prerendering = false;
  document.dispatchEvent(new Event("prerenderingchange"));
};

// L1 / G2 (T3.2): the string contract between shared-ui and the head script.
describe("index.html's site-transition head script", () => {
  it("uses shared-ui's names for the mark, its destination and the cookie", () => {
    const script = headScripts().find((body) => mentions(SITE_TRANSITION_COOKIE).test(body)) ?? "";
    expect(script, `no inline head script uses the cookie "${SITE_TRANSITION_COOKIE}"`).toMatch(
      mentions(SITE_TRANSITION_COOKIE),
    );
    expect(script).toMatch(mentions(SITE_TRANSITION_ATTRIBUTE));
    expect(script).toMatch(mentions(SITE_TRANSITION_TO_ATTRIBUTE));
  });
});

// L2 (C3, T3.2): a cold load is never covered; an arrival is covered at once and never stays so.
describe("the head script on a normal load", () => {
  it("never marks a page loaded without the signal", () => {
    const marks = recordMarks();
    runHeadScripts();
    vi.advanceTimersByTime(NEVER_STUCK_MS);
    expect(marks()).toEqual([]);
    expect(mark()).toBeNull();
  });

  it("leaves a signal for another site alone and doesn't mark the page", () => {
    writeSignal("ats.jakoblui.com", "jakoblui.com");
    const marks = recordMarks();
    runHeadScripts();
    vi.advanceTimersByTime(NEVER_STUCK_MS);
    expect(marks()).toEqual([]);
    expect(signal()).toBe("ats.jakoblui.com");
  });

  // Each kind of host takes the cookie's Domain differently; the script must delete the cookie
  // shared-ui wrote, which only a matching Domain does.
  it.each([
    { from: "https://ats.jakoblui.com/", url: "https://cv.jakoblui.com/", domain: "jakoblui.com" },
    { from: "https://cv.jakoblui.com/", url: "https://jakoblui.com/", domain: "jakoblui.com" },
    {
      from: "http://ats.jakoblui.localhost:5174/",
      url: "http://cv.jakoblui.localhost:5173/",
      domain: "jakoblui.localhost",
    },
    { from: "http://localhost:3001/", url: "http://localhost:3000/", domain: null },
    { from: "http://127.0.0.1:8081/", url: "http://127.0.0.1:8080/", domain: null },
  ])("covers an arrival at $url at once, takes the signal and uncovers by itself", ({ from, url, domain }) => {
    jsdom.reconfigure({ url: from });
    writeSignal(new URL(url).host, domain);
    jsdom.reconfigure({ url });
    expect(signal()).toBe(location.host);

    runHeadScripts();
    expect(mark()).toBe("covered");
    expect(signal(), "the signal is still there after the head script ran").toBeUndefined();

    // Still covered at the first paint: the cover is drawn from the mark before any other script.
    vi.advanceTimersToNextFrame();
    expect(mark()).toBe("covered");

    // Nothing else runs (shared-ui's JavaScript blocked or failing): the script uncovers by itself.
    vi.advanceTimersByTime(NEVER_STUCK_MS);
    expect(mark()).toBeNull();
    expect(root().hasAttribute(SITE_TRANSITION_TO_ATTRIBUTE)).toBe(false);
  });

  it("uncovers a page shared-ui is revealing", () => {
    writeSignal(location.host, "jakoblui.com");
    runHeadScripts();
    // shared-ui's arrive() started sliding the cover off, but never finished.
    root().setAttribute(SITE_TRANSITION_ATTRIBUTE, "revealing");
    vi.advanceTimersByTime(NEVER_STUCK_MS);
    expect(mark()).toBeNull();
  });

  it("leaves a page alone that the visitor is already leaving again", () => {
    writeSignal(location.host, "jakoblui.com");
    runHeadScripts();
    expect(mark()).toBe("covered");
    // A click on another site's link within the second: shared-ui's leave() marks the page.
    root().setAttribute(SITE_TRANSITION_TO_ATTRIBUTE, "emerald");
    root().setAttribute(SITE_TRANSITION_ATTRIBUTE, "leaving");
    vi.advanceTimersByTime(NEVER_STUCK_MS);
    expect(mark()).toBe("leaving");
    expect(root().getAttribute(SITE_TRANSITION_TO_ATTRIBUTE)).toBe("emerald");
  });
});

describe("the head script on a prerendered page", () => {
  it.each([
    { written: "before the prerender", early: true },
    { written: "while the page waits prerendered", early: false },
  ])(
    "covers it from the start and, with the signal ($written), keeps the cover until its own clear",
    ({ early }) => {
      if (early) writeSignal(location.host, "jakoblui.com");
      startPrerendering();
      runHeadScripts();
      expect(mark()).toBe("covered");

      // A prerendered page can wait any time before it's shown; it stays covered meanwhile.
      vi.advanceTimersByTime(NEVER_STUCK_MS);
      expect(mark()).toBe("covered");

      if (!early) writeSignal(location.host, "jakoblui.com");
      activate();
      expect(mark()).toBe("covered");
      expect(signal(), "the signal is still there after activation").toBeUndefined();
      vi.advanceTimersToNextFrame();
      expect(mark()).toBe("covered");

      vi.advanceTimersByTime(NEVER_STUCK_MS);
      expect(mark()).toBeNull();
    },
  );

  it.each([
    { case: "no signal", destination: null },
    { case: "a signal for another site", destination: "ats.jakoblui.com" },
  ])("removes the mark at activation with $case", ({ destination }) => {
    startPrerendering();
    runHeadScripts();
    expect(mark()).toBe("covered");

    if (destination) writeSignal(destination, "jakoblui.com");
    activate();
    expect(mark(), "the page is covered on its first frame after activation").toBeNull();

    const marks = recordMarks();
    vi.advanceTimersByTime(NEVER_STUCK_MS);
    expect(marks()).toEqual([]);
    expect(signal()).toBe(destination ?? undefined);
  });
});
