"use client";

import { Suspense, useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useReportWebVitals } from "next/web-vitals";
import { identify, track } from "@/lib/analytics";
import { currentVersion } from "@/lib/versions";

/**
 * Site-wide measurement.
 *
 * Mounted once in the root layout. Everything here is passive — it observes the
 * router and the document and reports what it sees, and renders nothing.
 *
 * The parts that need instrumenting at the source instead do it themselves:
 * the search palette, the code blocks' copy button, and anything carrying a
 * `data-analytics-id` attribute (see `SiteInteractions`).
 */
export function Analytics() {
  useEffect(() => {
    // Lets every report be sliced by which edition of the docs it came from,
    // which is the one dimension a versioned docs site always wants.
    identify({ docs_version: currentVersion.slug });
  }, []);

  return (
    <>
      {/*
        `useSearchParams` opts its subtree out of prerendering, so page views
        are fenced off behind their own boundary. Without it the whole static
        export below this point would bail out to client rendering — and the
        build fails outright rather than warning.
      */}
      <Suspense fallback={null}>
        <PageViews />
      </Suspense>
      <WebVitals />
      <SiteInteractions />
    </>
  );
}

function PageViews() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // A client-side navigation leaves `document.referrer` pointing at whatever
  // the visitor arrived from originally — the browser never updates it — so
  // the previous page has to be carried by hand.
  const previousUrl = useRef<string | null>(null);

  useEffect(() => {
    const query = searchParams.toString();
    const path = query ? `${pathname}?${query}` : pathname;

    // One frame's grace so the route's own metadata has been committed;
    // reading `document.title` in the same tick can still catch the old one.
    const frame = requestAnimationFrame(() => {
      track("page_view", {
        page_path: path,
        page_location: window.location.href,
        page_title: document.title,
        page_referrer: previousUrl.current ?? document.referrer ?? undefined,
      });
      previousUrl.current = window.location.href;
    });

    return () => cancelAnimationFrame(frame);
  }, [pathname, searchParams]);

  return null;
}

/**
 * Hoisted so the reference is stable — `useReportWebVitals` calls any new
 * function it is handed with every metric collected so far, so a callback
 * redefined on each render reports the same measurements repeatedly.
 */
const reportWebVital: Parameters<typeof useReportWebVitals>[0] = (metric) => {
  // CLS is a unitless fraction well under 1, and GA4 aggregates integers, so
  // it is scaled by a thousand as the web-vitals docs recommend. Everything
  // else is already in milliseconds.
  const scale = metric.name === "CLS" ? 1000 : 1;

  track(metric.name, {
    value: Math.round(metric.value * scale),
    metric_delta: Math.round(metric.delta * scale),
    metric_id: metric.id,
    metric_rating: metric.rating,
    navigation_type: metric.navigationType,
    // These arrive without the visitor doing anything. Left as interactions
    // they would make every session look engaged whether it was or not.
    non_interaction: true,
  });
};

function WebVitals() {
  useReportWebVitals(reportWebVital);
  return null;
}

const SCROLL_MILESTONES = [25, 50, 75, 100] as const;

/** Text is truncated before it is sent — GA4 caps parameter values at 100. */
function label(element: Element | null): string | undefined {
  const text = element?.textContent?.trim().replace(/\s+/g, " ");
  return text ? text.slice(0, 100) : undefined;
}

function SiteInteractions() {
  const pathname = usePathname();

  // ---- Clicks ----
  // Delegated from the document, so a component opts in by adding an attribute
  // rather than by importing anything or being wrapped in something.
  useEffect(() => {
    function handleClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const tagged = target.closest<HTMLElement>("[data-analytics-id]");
      if (tagged) {
        track("cta_click", {
          cta_id: tagged.dataset.analyticsId,
          cta_text: label(tagged),
          page_path: window.location.pathname,
        });
      }

      const anchor = target.closest("a");
      if (!anchor?.href) return;
      // `HTMLAnchorElement.href` is resolved to absolute for us.
      const url = new URL(anchor.href);
      // Same-origin navigation is already a page view; mailto: and friends are
      // not links out to anywhere measurable.
      if (url.origin === window.location.origin) return;
      if (url.protocol !== "https:" && url.protocol !== "http:") return;

      track("outbound_link", {
        link_url: url.href.slice(0, 100),
        link_domain: url.hostname,
        link_text: label(anchor),
        page_path: window.location.pathname,
      });
    }

    // Capture phase: React stops propagation on some handled clicks, and a
    // link that navigates may tear down its own listeners before a bubbling
    // one would have run.
    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, []);

  // ---- Reading depth ----
  // Per route, and each milestone once. On a docs site this is the closest
  // thing there is to "did anyone actually read this page".
  useEffect(() => {
    const reached = new Set<number>();

    function handleScroll() {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      // Short pages never scroll; reporting 100% for them would drown the
      // pages people genuinely read to the end.
      if (scrollable <= 0) return;
      const percent = (window.scrollY / scrollable) * 100;

      for (const milestone of SCROLL_MILESTONES) {
        if (percent + 0.5 >= milestone && !reached.has(milestone)) {
          reached.add(milestone);
          track("scroll_depth", {
            percent_scrolled: milestone,
            page_path: pathname,
            non_interaction: true,
          });
        }
      }
      if (reached.size === SCROLL_MILESTONES.length) {
        window.removeEventListener("scroll", handleScroll);
      }
    }

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [pathname]);

  // ---- Errors ----
  // A docs site that throws in the browser usually does it silently, because
  // nobody files a bug about a page that merely looked wrong.
  useEffect(() => {
    function handleError(event: ErrorEvent) {
      track("exception", {
        description: `${event.message} @ ${event.filename}:${event.lineno}`.slice(0, 100),
        page_path: window.location.pathname,
        fatal: false,
      });
    }

    function handleRejection(event: PromiseRejectionEvent) {
      track("exception", {
        description: `Unhandled rejection: ${String(event.reason)}`.slice(0, 100),
        page_path: window.location.pathname,
        fatal: false,
      });
    }

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  return null;
}
