"use client";

import { useRef } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useMousePosition } from "@/hooks/use-mouse-position";
import { HeroBackground } from "@/components/background/hero-background";
import { HeroSky } from "@/components/background/hero-sky";
import { RevealText } from "@/components/animations/reveal-text";
import { FadeIn } from "@/components/animations/fade-in";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Stamp } from "@/components/ui/stamp";
import { Terminal } from "@/components/ui/terminal";
import { cue } from "@/lib/hero-timeline";
import { docs } from "@/lib/site-config";
import { pendingCopy } from "@/lib/release-status";
import { currentVersion, isPending, versionRoute } from "@/lib/versions";

/**
 * The hero.
 *
 * Two columns, and that is the whole answer to the problem this section used to
 * have. The copy and the constellation were stacked on the same patch of
 * screen, so one had to wait for the other — which meant four and a half
 * seconds of choreography before the page said what it was. Side by side,
 * neither is in the other's way and both start at once. Below `lg` they stack
 * rather than overlap, so the rule holds at every width.
 *
 * The sky itself is *not* in a column — it spans the whole section, edge to
 * edge, and only the constellation figure is aimed at the right-hand cell. That
 * cell is an empty spacer whose only job is to be measured; see `HeroSky`.
 *
 * A client component because that measurement needs refs on both the section
 * and the spacer. Everything in it still server-renders.
 */
export function Hero() {
  const [sectionRef, mouse] = useMousePosition<HTMLElement>();
  const anchorRef = useRef<HTMLDivElement>(null);

  return (
    <section
      ref={sectionRef}
      className="relative overflow-hidden px-6 pb-24 pt-[calc(var(--height-nav)+2rem)] lg:flex lg:min-h-[94vh] lg:items-center"
    >
      <HeroBackground />
      <HeroSky mouse={mouse} anchorRef={anchorRef} hostRef={sectionRef} />

      <div className="relative z-10 mx-auto grid w-full max-w-(--width-content) items-center gap-12 lg:grid-cols-2 lg:gap-14">
        <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
          {/* The release signal, and the first thing on the site a reader sees.
              It used to be a pinging dot — the universal "we are live" tell —
              next to a name. Orion is not live, so the ping is gone and the
              badge now says the one thing that is true, and links to the page
              that explains it. When the edition ships this becomes a `Badge`
              again; see `components/versions/pending-poster.tsx`. */}
          <FadeIn delay={cue.badge}>
            {isPending(currentVersion) ? (
              <Link
                href={versionRoute(currentVersion)}
                className="group mb-6 inline-flex items-center gap-2.5 rounded-full border border-border bg-white/[0.03] py-1 pl-3.5 pr-2 text-xs text-text-tertiary transition-colors hover:border-border-strong hover:text-text-secondary"
              >
                <span className="font-mono uppercase tracking-wide">
                  Edition {String(currentVersion.ordinal).padStart(3, "0")}
                </span>
                <Stamp size="sm" rotate={-2} impact={false}>
                  {pendingCopy.source}
                </Stamp>
                <ArrowRight className="size-3 shrink-0 text-text-faint transition-transform group-hover:translate-x-0.5" />
              </Link>
            ) : (
              <Badge tone="accent" className="mb-6">
                <span className="relative flex size-1.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-75" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-accent" />
                </span>
                Orion · authentication infrastructure
              </Badge>
            )}
          </FadeIn>

          <RevealText
            text="Authentication you run yourself."
            focusPull
            delay={cue.headline}
            stagger={0.07}
            className="justify-center text-4xl font-semibold tracking-tight text-balance text-text-primary sm:text-5xl lg:justify-start xl:text-6xl"
          />

          <FadeIn delay={cue.lede}>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-text-secondary">
              Sessions, tokens, passkeys, TOTP, device authorization, OAuth, abuse defense, and a
              tamper-evident audit trail — embedded in your own Node app, on infrastructure you own.
            </p>
          </FadeIn>

          <FadeIn delay={cue.actions}>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
              <Button href={docs("getting-started")} size="lg" data-analytics-id="hero-get-started">
                Get started
              </Button>
              <Button
                href={docs("architecture")}
                variant="secondary"
                size="lg"
                data-analytics-id="hero-architecture"
              >
                Read the architecture
              </Button>
            </div>
          </FadeIn>

          <FadeIn delay={cue.terminal} className="mt-12 w-full max-w-xl">
            {/* Still held a beat so the first command types itself as the panel
                arrives, rather than a third of the way through the loop. */}
            <Terminal startDelayMs={cue.terminal * 1000} />
          </FadeIn>
        </div>

        {/* Purely a measuring stick — the sky draws through it. Portrait
            because Orion with his club and shield is 30° tall and only 20°
            wide, so a square target would waste the sides and crop the club.

            Removed below `lg` rather than merely left empty. The figure it
            aims is switched off at that width (see `HeroSky`), so all the box
            would contribute to a stacked layout is its own height — a screen
            of nothing between the copy and whatever follows. Gone from the
            grid entirely, so it takes the column gap with it.

            Nudged outward on wide screens so the figure sits clear of the copy
            rather than politely inside the content column. The sky is
            full-bleed, so it has the room. */}
        <div
          ref={anchorRef}
          aria-hidden
          className="hidden lg:block lg:h-[min(80vh,52rem)] lg:translate-x-[14%]"
        />
      </div>
    </section>
  );
}
