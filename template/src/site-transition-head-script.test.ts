import {
  SITE_TRANSITION_ATTRIBUTE,
  SITE_TRANSITION_COOKIE,
  SITE_TRANSITION_STATES,
  SITE_TRANSITION_TO_ATTRIBUTE,
  siteTransitionCookie,
} from "@jakoblui-works/shared-ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import indexHtml from "../index.html?raw";

// The arrival side of shared-ui's site transitions: the inline script in index.html's <head> that
// covers the page before its first paint when the visitor arrives from another site, and uncovers
// it by itself if shared-ui's JavaScript never does. The names, states and the cookie (as shared-ui's
// click handler writes it) are shared-ui's.

// vitest's jsdom environment, which the tests move between hosts and whose cookies they reset.
declare const jsdom: {
  reconfigure(options: { url: string }): void;
  cookieJar: { removeAllCookiesSync(): void };
};

// The script uncovers the page by itself after about 1 s. The bound is that plus slack; the
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

/** The cookie shared-ui's click handler writes on this page, for a link to `destinationHref`. */
const writeSignal = (destinationHref: string) => {
  document.cookie = siteTransitionCookie(destinationHref, location.hostname);
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

// The string contract between shared-ui and the head script.
describe("index.html's site-transition head script", () => {
  it("uses shared-ui's names for the mark, its destination, the cookie and the covered state", () => {
    const script = headScripts().find((body) => mentions(SITE_TRANSITION_COOKIE).test(body)) ?? "";
    expect(script, `no inline head script uses the cookie "${SITE_TRANSITION_COOKIE}"`).toMatch(
      mentions(SITE_TRANSITION_COOKIE),
    );
    expect(script).toMatch(mentions(SITE_TRANSITION_ATTRIBUTE));
    expect(script).toMatch(mentions(SITE_TRANSITION_TO_ATTRIBUTE));
    // The one state the script sets and clears; shared-ui's other states are only compared against
    // (the tests below set them from SITE_TRANSITION_STATES).
    expect(script).toMatch(mentions(SITE_TRANSITION_STATES.covered));
  });
});

// A cold load is never covered; an arrival is covered at once and never stays so.
describe("the head script on a normal load", () => {
  it("never marks a page loaded without the signal", () => {
    const marks = recordMarks();
    runHeadScripts();
    vi.advanceTimersByTime(NEVER_STUCK_MS);
    expect(marks()).toEqual([]);
    expect(mark()).toBeNull();
  });

  it("leaves a signal for another site alone and doesn't mark the page", () => {
    writeSignal("https://ats.jakoblui.com/");
    const marks = recordMarks();
    runHeadScripts();
    vi.advanceTimersByTime(NEVER_STUCK_MS);
    expect(marks()).toEqual([]);
    expect(signal()).toBe("ats.jakoblui.com");
  });

  // Each kind of host takes the cookie's Domain differently; the script must delete the cookie
  // shared-ui wrote, which only a matching Domain does.
  it.each([
    { from: "https://ats.jakoblui.com/", url: "https://cv.jakoblui.com/" },
    { from: "https://cv.jakoblui.com/", url: "https://jakoblui.com/" },
    { from: "http://ats.jakoblui.localhost:5174/", url: "http://cv.jakoblui.localhost:5173/" },
    { from: "http://localhost:3001/", url: "http://localhost:3000/" },
    { from: "http://127.0.0.1:8081/", url: "http://127.0.0.1:8080/" },
  ])("covers an arrival at $url at once, takes the signal and uncovers by itself", ({ from, url }) => {
    jsdom.reconfigure({ url: from });
    writeSignal(url);
    jsdom.reconfigure({ url });
    expect(signal()).toBe(location.host);

    runHeadScripts();
    expect(mark()).toBe(SITE_TRANSITION_STATES.covered);
    expect(signal(), "the signal is still there after the head script ran").toBeUndefined();

    // Still covered at the first paint: the cover is drawn from the mark before any other script.
    vi.advanceTimersToNextFrame();
    expect(mark()).toBe(SITE_TRANSITION_STATES.covered);

    // Nothing else runs (shared-ui's JavaScript blocked or failing): the script uncovers by itself.
    vi.advanceTimersByTime(NEVER_STUCK_MS);
    expect(mark()).toBeNull();
    expect(root().hasAttribute(SITE_TRANSITION_TO_ATTRIBUTE)).toBe(false);
  });

  it("leaves a page alone that shared-ui is revealing", () => {
    writeSignal(location.href);
    runHeadScripts();
    // shared-ui's arrive() is sliding the cover off; finishing it (or its own fallback) is shared-ui's.
    root().setAttribute(SITE_TRANSITION_ATTRIBUTE, SITE_TRANSITION_STATES.revealing);
    vi.advanceTimersByTime(NEVER_STUCK_MS);
    expect(mark()).toBe(SITE_TRANSITION_STATES.revealing);
  });

  it("leaves a page alone that the visitor is already leaving again", () => {
    writeSignal(location.href);
    runHeadScripts();
    expect(mark()).toBe(SITE_TRANSITION_STATES.covered);
    // A click on another site's link within the second: shared-ui's leave() marks the page.
    root().setAttribute(SITE_TRANSITION_TO_ATTRIBUTE, "emerald");
    root().setAttribute(SITE_TRANSITION_ATTRIBUTE, SITE_TRANSITION_STATES.leaving);
    vi.advanceTimersByTime(NEVER_STUCK_MS);
    expect(mark()).toBe(SITE_TRANSITION_STATES.leaving);
    expect(root().getAttribute(SITE_TRANSITION_TO_ATTRIBUTE)).toBe("emerald");
  });
});

// A prerendered page is covered from the start, keeps the cover through activation with the
// signal and loses it at activation without.
describe("the head script on a prerendered page", () => {
  it.each([
    { written: "before the prerender", early: true },
    { written: "while the page waits prerendered", early: false },
  ])(
    "covers it from the start and, with the signal ($written), keeps the cover until its own clear",
    ({ early }) => {
      if (early) writeSignal(location.href);
      startPrerendering();
      runHeadScripts();
      expect(mark()).toBe(SITE_TRANSITION_STATES.covered);

      // A prerendered page can wait any time before it's shown; it stays covered meanwhile.
      vi.advanceTimersByTime(NEVER_STUCK_MS);
      expect(mark()).toBe(SITE_TRANSITION_STATES.covered);

      if (!early) writeSignal(location.href);
      activate();
      expect(mark()).toBe(SITE_TRANSITION_STATES.covered);
      expect(signal(), "the signal is still there after activation").toBeUndefined();
      vi.advanceTimersToNextFrame();
      expect(mark()).toBe(SITE_TRANSITION_STATES.covered);

      vi.advanceTimersByTime(NEVER_STUCK_MS);
      expect(mark()).toBeNull();
    },
  );

  it.each([
    { case: "no signal", destination: null },
    { case: "a signal for another site", destination: "https://ats.jakoblui.com/" },
  ])("removes the mark at activation with $case", ({ destination }) => {
    startPrerendering();
    runHeadScripts();
    expect(mark()).toBe(SITE_TRANSITION_STATES.covered);

    if (destination) writeSignal(destination);
    activate();
    expect(mark(), "the page is covered on its first frame after activation").toBeNull();

    const marks = recordMarks();
    vi.advanceTimersByTime(NEVER_STUCK_MS);
    expect(marks()).toEqual([]);
    expect(signal()).toBe(destination ? new URL(destination).host : undefined);
  });
});
