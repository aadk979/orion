import type { Metadata } from "next";
import { getPageMap } from "nextra/page-map";
import { HeroBackground } from "@/components/background/hero-background";
import { NotFoundPanel } from "@/components/marketing/not-found-panel";
import { NotFoundSky } from "@/components/marketing/not-found-sky";
import { getDocsNavTree } from "@/lib/nav-tree";
import { siteConfig } from "@/lib/site-config";

/**
 * The 404.
 *
 * The root `not-found` catches every unmatched URL for the whole app, and in a
 * static export it is what becomes `out/404.html` — the file Firebase Hosting
 * serves for anything it cannot resolve. So this one page is the entire
 * not-found story for the site, and it is worth it being useful.
 *
 * The nav tree is read here, at build time, and handed to the panel: that is
 * what lets a page rendered from a flat HTML file still suggest the right
 * destinations without fetching an index at runtime.
 */

export const metadata: Metadata = {
  title: "Page not found",
  description: `The page you are looking for is not part of the ${siteConfig.name} documentation.`,
  // No canonical — there is no page here to be the canonical of. Next marks
  // 404 responses `noindex` itself, but a static export is served as a plain
  // file and nothing on the way out says so, hence stating it in the document.
  robots: { index: false, follow: true },
};

export default async function NotFound() {
  const pageMap = await getPageMap();
  const navTree = getDocsNavTree(pageMap, siteConfig.docsBasePath);

  return (
    <section className="relative overflow-hidden px-6 pb-24 pt-16 lg:flex lg:min-h-[80vh] lg:items-center lg:py-20">
      {/* The hero's atmosphere, reused: wash, survey grid, and a fade out the
          bottom. It is the same layer this page would otherwise reinvent. */}
      <HeroBackground />

      <div className="relative z-10 mx-auto grid w-full max-w-(--width-content) items-center gap-14 lg:grid-cols-[minmax(0,38rem)_minmax(0,1fr)]">
        <NotFoundPanel navTree={navTree} />

        {/* Hidden below `lg`, following the hero's rule: a constellation needs
            room to be recognisable, and on a phone the space it would take is
            space between the visitor and the links they came for. */}
        <figure className="hidden lg:block">
          <NotFoundSky className="mx-auto h-[26rem]" />
          <figcaption className="mt-6 text-center font-mono text-xs leading-relaxed text-text-faint">
            ε Ori — Alnilam
            <br />
            <span className="text-text-tertiary">not found at these coordinates</span>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
