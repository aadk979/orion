"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, FileText, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GithubIcon } from "@/components/ui/icons";
import { track } from "@/lib/analytics";
import { duration, ease } from "@/lib/motion";
import type { NavNode } from "@/lib/nav-tree";
import { docs } from "@/lib/site-config";
import { source } from "@/lib/release-status";
import { currentVersion, VERSIONS_BASE_PATH } from "@/lib/versions";

/**
 * The helpful half of the 404.
 *
 * A dead end on a documentation site is nearly always one of three things: a
 * link written before the docs were versioned, a path typed from memory, or a
 * page that was renamed. All three are recoverable from the URL itself, so this
 * reads it, guesses what was being looked for, and puts the candidates on
 * screen — rather than offering a "go home" button and calling that help.
 *
 * A client component because a static export has no server to tell us which URL
 * 404'd; only the browser knows. Everything derived from it is therefore
 * deferred to after mount, which is also what keeps hydration honest — the
 * prerendered 404.html has no path to render.
 */

/** Destinations offered when there is nothing to guess from, and as a floor. */
const QUICK_LINKS: { title: string; href: string; note: string }[] = [
  { title: "Documentation", href: docs(), note: "Start at the top" },
  { title: "Getting Started", href: docs("getting-started"), note: "A node running in ten minutes" },
  { title: "Architecture", href: docs("architecture"), note: "How the pieces fit" },
  { title: "API Reference", href: docs("api-reference"), note: "Every endpoint" },
  { title: "Configuration", href: docs("configuration"), note: "Every option" },
  { title: "Editions", href: VERSIONS_BASE_PATH, note: "What each release changed" },
];

/**
 * Path segments that say nothing about the subject. Every docs URL carries the
 * version prefix, so leaving these in would score the whole site equally.
 */
const NOISE = new Set([
  "versions",
  "docs",
  "index",
  "html",
  "htm",
  "page",
  "en",
  currentVersion.slug,
]);

const MAX_RESULTS = 6;

/**
 * The failed address, read from the browser.
 *
 * Through `useSyncExternalStore` rather than an effect, because the server
 * snapshot is the part that matters: the prerendered `404.html` knows no path,
 * so it must render none, and React is then told explicitly that the client
 * will have one. Written as `useState` + `useEffect` this is the classic
 * hydration mismatch.
 *
 * Nothing to subscribe to — the location cannot change under this component
 * without navigating away from it.
 */
const subscribeToLocation = () => () => {};
const readLocation = () => window.location.pathname + window.location.search;
const noLocation = () => null;

type Entry = {
  title: string;
  route: string;
  /** Section titles above this page, for the breadcrumb line under a result. */
  trail: string[];
};

/**
 * Every page in the tree, carrying its ancestry with it.
 *
 * Sections are included alongside their children, unlike the ⌘K palette, which
 * lists leaves only. Someone who typed `/docs/guides` wants the guides index,
 * and offering the nine pages under it while withholding the one page they
 * asked for would be a strange kind of help.
 */
function collectPages(nodes: NavNode[], trail: string[] = []): Entry[] {
  return nodes.flatMap((node) => {
    const entry = { title: node.title, route: node.route, trail };
    return node.children
      ? [entry, ...collectPages(node.children, [...trail, node.title])]
      : [entry];
  });
}

function words(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !NOISE.has(word));
}

/**
 * What the visitor was probably after, as a search query. The last meaningful
 * segment of the path and nothing else: in `/docs/guides/refresh-token-rotation`
 * the subject is the leaf, and the folders above it only dilute the match.
 */
/** The path without its query string, as segments. */
function segmentsOf(path: string): string[] {
  return path.split("?")[0].split("/").filter(Boolean);
}

/** The last segment, lowercased, without any file extension. */
function leafOf(path: string): string {
  return (segmentsOf(path).pop() ?? "").replace(/\.\w+$/, "").toLowerCase();
}

function guessQuery(path: string): string {
  const segments = segmentsOf(path);
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const terms = words(decodeURIComponent(segments[index]).replace(/\.\w+$/, ""));
    if (terms.length) return terms.join(" ");
  }
  return "";
}

/** What one whole term matching is worth. Anything less is a near-miss. */
const EXACT = 4;

function score(entry: Entry, terms: string[]): number {
  const haystack = `${entry.trail.join(" ")} ${entry.title} ${entry.route}`.toLowerCase();
  let total = 0;

  for (const term of terms) {
    if (haystack.includes(term)) {
      total += EXACT;
      continue;
    }
    // Tolerate a wrong ending — a plural, a tense, or a typo in the tail.
    // `passkyes` still finds Passkeys, `session` still finds Sessions.
    if (term.length >= 4 && haystack.includes(term.slice(0, 4))) total += 1;
  }

  return total;
}

export function NotFoundPanel({ navTree }: { navTree: NavNode[] }) {
  const path = useSyncExternalStore(subscribeToLocation, readLocation, noLocation);

  // `null` until the visitor types. The box is not empty before that — it holds
  // the guess — but the guess has to stay live with the path rather than be
  // frozen into state the moment it is first derived.
  const [typed, setTyped] = useState<string | null>(null);
  const query = typed ?? (path ? guessQuery(path) : "");

  const pages = useMemo(() => collectPages(navTree), [navTree]);

  // A 404 carrying a referrer is a broken link somewhere, and it is exactly the
  // kind of breakage nobody ever files a bug about.
  useEffect(() => {
    if (!path) return;
    track("page_not_found", {
      page_path: path.slice(0, 100),
      page_referrer: document.referrer || undefined,
    });
  }, [path]);

  const terms = useMemo(() => words(query), [query]);

  const results = useMemo(() => {
    if (!terms.length) return [];
    const scored = pages
      .map((entry) => ({ entry, points: score(entry, terms) }))
      .filter((candidate) => candidate.points > 0);

    // The near-misses are only worth showing when there are no real matches.
    // "passkeys" turning up Password Reset alongside Passkeys reads as a system
    // that didn't understand the question; on "passkyes" the same list is the
    // whole point.
    const strong = scored.filter((candidate) => candidate.points >= EXACT);

    return (strong.length ? strong : scored)
      .sort(
        (a, b) =>
          b.points - a.points || a.entry.route.length - b.entry.route.length,
      )
      .slice(0, MAX_RESULTS)
      .map((candidate) => candidate.entry);
  }, [pages, terms]);

  /**
   * A page whose own slug is exactly the one that was asked for. That is not a
   * suggestion, it is the page — reached by an old URL, most often one written
   * before the docs moved under `/versions/<edition>/docs`.
   */
  const moved = useMemo(() => {
    if (!path || typed !== null) return null;
    const asked = leafOf(path);
    if (!asked) return null;
    const match = pages.find((entry) => leafOf(entry.route) === asked);
    return match && match.route !== path ? match : null;
  }, [pages, path, typed]);

  return (
    <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
      <Badge tone="accent" className="mb-6 font-mono">
        <span className="size-1.5 rounded-full bg-accent" />
        404 · no such route
      </Badge>

      <h1 className="text-4xl font-semibold tracking-tight text-balance text-text-primary sm:text-5xl">
        This one isn&apos;t on the chart.
      </h1>

      <p className="mt-5 max-w-xl text-lg leading-relaxed text-text-secondary">
        Nothing is published at that address. Documentation lives under the
        edition it documents, so a link written before the docs were versioned
        lands here — and so does a path typed one character off.
      </p>

      {/* The address that failed, quoted back. Half of all 404s are a typo the
          visitor can spot instantly once they can see the URL as text. */}
      <div className="mt-7 flex w-full max-w-xl items-center gap-3 overflow-hidden rounded-md border border-border bg-bg-raised/60 px-3.5 py-2.5 text-left font-mono text-sm">
        <span className="shrink-0 text-text-faint">GET</span>
        <span className="truncate text-text-secondary" title={path ?? undefined}>
          {path ?? " "}
        </span>
        <span className="ml-auto shrink-0 text-accent-bright">404</span>
      </div>

      {moved && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: duration.base, ease: ease.outExpo }}
          className="mt-4 w-full max-w-xl text-left"
        >
          <Link
            href={moved.route}
            data-analytics-id="not-found-moved"
            className="group flex items-center gap-3 rounded-md border border-accent-dim/60 bg-accent/[0.07] px-3.5 py-3 transition-colors hover:bg-accent/[0.12]"
          >
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-accent-bright">
                That page moved
              </p>
              <p className="mt-1 truncate font-mono text-sm text-text-secondary">
                {moved.route}
              </p>
            </div>
            <ArrowRight className="ml-auto size-4 shrink-0 text-accent-bright transition-transform group-hover:translate-x-0.5" />
          </Link>
        </motion.div>
      )}

      {/* Search, seeded with the guess. Seeding it is the point: the visitor
          arrives to results rather than to an empty box asking them to
          describe, again, the thing they already typed into the address bar. */}
      <div className="mt-8 w-full max-w-xl overflow-hidden rounded-lg border border-border bg-bg-raised/60 text-left">
        <label className="flex items-center gap-2.5 border-b border-border-faint px-3.5 py-3">
          <Search className="size-4 shrink-0 text-text-tertiary" />
          <input
            value={query}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="Search the documentation..."
            aria-label="Search the documentation"
            className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-faint"
          />
        </label>

        {results.length > 0 ? (
          <ul className="p-2">
            {results.map((entry) => (
              <li key={entry.route}>
                <Link
                  href={entry.route}
                  data-analytics-id="not-found-suggestion"
                  className="group flex items-center gap-2.5 rounded-md px-3 py-2 transition-colors hover:bg-white/[0.05]"
                >
                  <FileText className="size-3.5 shrink-0 text-text-faint" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-text-secondary group-hover:text-text-primary">
                      {entry.title}
                    </span>
                    {entry.trail.length > 0 && (
                      <span className="block truncate text-xs text-text-faint">
                        {entry.trail.join(" / ")}
                      </span>
                    )}
                  </span>
                  <ArrowRight className="ml-auto size-3.5 shrink-0 text-text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="grid gap-x-4 gap-y-1 p-2 sm:grid-cols-2">
            {QUICK_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                data-analytics-id="not-found-quick-link"
                className="group rounded-md px-3 py-2 transition-colors hover:bg-white/[0.05]"
              >
                <span className="block text-sm text-text-secondary group-hover:text-text-primary">
                  {link.title}
                </span>
                <span className="block truncate text-xs text-text-faint">{link.note}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
        <Button href="/" size="lg" data-analytics-id="not-found-home">
          Back to the homepage
        </Button>
        <Button
          href={docs()}
          variant="secondary"
          size="lg"
          data-analytics-id="not-found-docs"
        >
          Browse the docs
        </Button>
      </div>

      {/* A 404 reached from a link inside the project's own documentation is a
          bug in the project, and this is the only place a visitor could report
          it — once there is somewhere to report it *to*. Until the repository
          is public the affordance stays, stated honestly, rather than opening a
          prefilled issue form on a repository that does not exist. */}
      {source.available ? (
        <a
          href={`${source.url}/issues/new?title=${encodeURIComponent(
            `Broken link: ${path ?? ""}`,
          )}`}
          target="_blank"
          rel="noreferrer"
          className="mt-7 inline-flex items-center gap-2 text-sm text-text-tertiary transition-colors hover:text-text-primary"
        >
          <GithubIcon className="size-3.5" />
          Followed a link to get here? Report it.
        </a>
      ) : (
        <p className="mt-7 inline-flex items-center gap-2 text-sm text-text-tertiary">
          <GithubIcon className="size-3.5 opacity-60" />
          Followed a link to get here? Issue reporting opens with the public repository.
        </p>
      )}
    </div>
  );
}
