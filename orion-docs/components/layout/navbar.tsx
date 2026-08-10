"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMotionValueEvent, useScroll } from "framer-motion";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { docs, primaryNav, siteConfig } from "@/lib/site-config";
import { Button } from "@/components/ui/button";
import { SearchBar } from "@/components/layout/search-bar";
import { MobileDrawer } from "@/components/layout/mobile-drawer";
import { SourceLink } from "@/components/ui/source-link";
import { OrionLockup } from "@/components/ui/orion-mark";
import type { NavNode } from "@/lib/nav-tree";
import type { EditionSummary } from "@/components/layout/sidebar";

/** `/versions/<edition>/docs`, for any edition — not just the current one. */
const DOCS_ROUTE_RE = /^\/versions\/[^/]+\/docs(\/|$)/;

export function Navbar({
  navTree = [],
  edition,
}: {
  navTree?: NavNode[];
  edition: EditionSummary;
}) {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { scrollY } = useScroll();
  const isDocsRoute = DOCS_ROUTE_RE.test(pathname);

  const activeHref = primaryNav
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .reduce<string | null>(
      (best, item) => (best && best.length >= item.href.length ? best : item.href),
      null,
    );

  useMotionValueEvent(scrollY, "change", (latest) => setScrolled(latest > 8));

  return (
    <>
      <header
        className={cn(
          "sticky top-0 z-50 h-(--height-nav) border-b transition-colors duration-300",
          scrolled
            ? "border-border-faint bg-bg/75 backdrop-blur-md"
            : "border-transparent bg-transparent",
        )}
      >
        <div
          className={cn(
            "mx-auto flex h-full w-full items-center gap-4 px-4 sm:gap-6 sm:px-6",
            isDocsRoute ? "max-w-(--width-docs)" : "max-w-(--width-content)",
          )}
        >
          <Link
            href="/"
            aria-label={`${siteConfig.name} home`}
            aria-current={pathname === "/" ? "page" : undefined}
            className="flex items-center text-text-primary transition-colors duration-150 hover:text-white"
          >
            <OrionLockup />
          </Link>

          <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
            {primaryNav.map((item) => {
              const active = item.href === activeHref;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-sm font-medium leading-none transition-colors duration-150",
                    active ? "text-text-primary" : "text-text-tertiary hover:text-text-secondary",
                  )}
                >
                  {item.title}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <SearchBar navTree={navTree} className="flex" />
            <SourceLink variant="icon" className="hidden px-1 sm:inline-flex" />
            <Button href={docs("getting-started")} size="sm" className="hidden sm:inline-flex">
              Get started
            </Button>
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              aria-haspopup="dialog"
              aria-expanded={drawerOpen}
              aria-controls="mobile-navigation"
              className="flex size-9 items-center justify-center rounded-md border border-border text-text-secondary md:hidden"
            >
              <Menu className="size-4.5" />
            </button>
          </div>
        </div>
      </header>

      <MobileDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        navTree={navTree}
        edition={edition}
      />
    </>
  );
}
