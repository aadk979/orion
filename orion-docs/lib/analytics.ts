import type { Analytics } from "firebase/analytics";

/**
 * Firebase Analytics.
 *
 * Everything that reports a measurement goes through `track()`, and `track()`
 * is built so that nothing downstream of it can break a page. The SDK is loaded
 * on demand, initialisation failures are swallowed, and every call is fire and
 * forget — a blocked request, an unsupported browser, or a visitor who has
 * opted out all produce the same result, which is nothing happening.
 *
 * The site is a static export, so this is entirely client-side. There is no
 * server to proxy through and no request-time hook to hang page views on, which
 * is why route changes are tracked by the component in
 * `components/analytics/analytics.tsx` rather than here.
 */

/**
 * The Firebase web config. Public by design: it ships in the browser bundle of
 * every Firebase web app and identifies the project rather than authorising
 * anything against it. What guards the project is its security rules and the
 * authorised-domains list, not the secrecy of these values.
 */
const firebaseConfig = {
  apiKey: "AIzaSyC5s-WKT40d9ER8kIRova7JYQC1ldptAVw",
  authDomain: "orion-64aef.firebaseapp.com",
  projectId: "orion-64aef",
  storageBucket: "orion-64aef.firebasestorage.app",
  messagingSenderId: "443326565463",
  appId: "1:443326565463:web:7a712414df8fc6d628e712",
  measurementId: "G-QQJHYFBYKY",
};

/**
 * Honour Do Not Track and Global Privacy Control. Set to `false` to measure
 * every visitor regardless — nothing else in this file depends on it, and no
 * caller can tell the difference.
 */
const RESPECT_DO_NOT_TRACK = true;

/** GA4 accepts scalars; objects and arrays are dropped at collection time. */
export type AnalyticsParams = Record<string, string | number | boolean | undefined>;

let analyticsPromise: Promise<Analytics | null> | null = null;

function hasOptedOut(): boolean {
  if (!RESPECT_DO_NOT_TRACK) return false;
  const nav = window.navigator as Navigator & {
    msDoNotTrack?: string;
    globalPrivacyControl?: boolean;
  };
  const legacy = (window as Window & { doNotTrack?: string }).doNotTrack;
  return (
    nav.doNotTrack === "1" ||
    nav.msDoNotTrack === "1" ||
    legacy === "1" ||
    nav.globalPrivacyControl === true
  );
}

/**
 * Resolves the Analytics handle, or `null` if we cannot or should not measure.
 *
 * Loaded on demand. The Analytics SDK is a substantial dependency and no page
 * needs it in order to render, so keeping it out of the entry bundle costs
 * nothing but a promise and keeps it off the critical path.
 */
function loadAnalytics(): Promise<Analytics | null> {
  analyticsPromise ??= (async () => {
    if (typeof window === "undefined" || hasOptedOut()) return null;
    try {
      const [{ getApps, initializeApp }, firebaseAnalytics] = await Promise.all([
        import("firebase/app"),
        import("firebase/analytics"),
      ]);
      // Cookies disabled, a non-browser environment, an unsupported engine.
      if (!(await firebaseAnalytics.isSupported())) return null;

      const app = getApps()[0] ?? initializeApp(firebaseConfig);

      // `send_page_view: false` because we send page views ourselves. The
      // automatic one fires on document load, which in an App Router site means
      // the entry page and nothing after it — so leaving it on would give a
      // duplicate of the first page and none of the navigations that follow.
      return firebaseAnalytics.initializeAnalytics(app, {
        config: { send_page_view: false },
      });
    } catch {
      // Blocked by an extension, offline, or the endpoint is unreachable.
      // Analytics failing is never a reason for the page to fail.
      return null;
    }
  })();
  return analyticsPromise;
}

/**
 * GA4 only accepts names made of letters, digits and underscores, starting with
 * a letter, up to 40 characters — anything else is discarded at collection
 * time, silently, which is the worst way to lose data. Not hypothetical: Next
 * reports web vitals under names like `Next.js-hydration`.
 */
function sanitiseName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, "_").replace(/^[^A-Za-z]+/, "");
  return (cleaned || "event").slice(0, 40);
}

/**
 * Records an event. Safe to call from anywhere at any time, including before
 * the SDK has loaded and on the server, where it does nothing.
 */
export function track(name: string, params?: AnalyticsParams): void {
  void (async () => {
    const analytics = await loadAnalytics();
    if (!analytics) return;
    try {
      const { logEvent } = await import("firebase/analytics");
      logEvent(analytics, sanitiseName(name), params);
    } catch {
      // As in `loadAnalytics` — measurement never propagates a failure.
    }
  })();
}

/**
 * Attaches properties to this visitor for every subsequent event, for slicing
 * reports by things that are true of the session rather than the interaction.
 */
export function identify(properties: Record<string, string>): void {
  void (async () => {
    const analytics = await loadAnalytics();
    if (!analytics) return;
    try {
      const { setUserProperties } = await import("firebase/analytics");
      setUserProperties(analytics, properties);
    } catch {
      // As above.
    }
  })();
}
