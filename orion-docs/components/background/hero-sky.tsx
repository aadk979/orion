"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";
import { motion, useTransform } from "framer-motion";
import { cn } from "@/lib/utils";
import type { MousePosition } from "@/hooks/use-mouse-position";
import { useMediaQuery } from "@/hooks/use-media-query";
import { StarfieldCanvas, type FigureAnchor } from "@/components/background/starfield-canvas";

/**
 * Below this the hero stacks, and the anchor the figure is drawn into stops
 * being a column and becomes a 4:5 box above the copy.
 *
 * Orion is 30° tall and 20° wide, so fitting him into that box leaves the
 * figure small, cramped against the stacked layout, and — with no pointer to
 * parallax against — static. The asterism ends up a tangle of faint lines
 * rather than a constellation. The field stars and meteors have no such
 * problem: they fill whatever canvas they are given. So the figure is what
 * comes off on small screens, not the sky.
 */
const FIGURE_MIN_WIDTH = "(min-width: 1024px)";

type HeroSkyProps = {
  className?: string;
  mouse: MousePosition;
  /** The element the constellation should be drawn into. */
  anchorRef: RefObject<HTMLElement | null>;
  /** The element the sky fills — the hero section. */
  hostRef: RefObject<HTMLElement | null>;
};

/** Until the anchor is measured, draw the figure where a full-bleed sky would. */
const UNMEASURED: FigureAnchor = { cx: 0.5, cy: 0.5, width: 0.5, height: 0.86 };

/**
 * The sky: a full-bleed starfield with the constellation aimed at one region
 * of it, and Orionid meteors streaming out of the club.
 *
 * The split hero briefly confined this whole layer to its column, which was a
 * mistake — the field stars went with it and the hero became a mostly empty
 * page with a small starry rectangle stuck on the right. The sky is the page's
 * backdrop and belongs edge to edge. Only the *figure* needs to stay out of the
 * copy's way, so only the figure is anchored.
 *
 * The anchor is measured from the layout rather than hard-coded, because the
 * column's centre drifts with viewport width — the content container is capped
 * at 1120px and centred, so at 1280px the sky column sits at 74% across and at
 * 1920px it sits at 66%. A fixed fraction would be wrong at most widths, and
 * wrong differently once the layout stacks.
 */
export function HeroSky({ className, mouse, anchorRef, hostRef }: HeroSkyProps) {
  const [anchor, setAnchor] = useState<FigureAnchor>(UNMEASURED);
  const showConstellation = useMediaQuery(FIGURE_MIN_WIDTH);

  const measure = useCallback(() => {
    const host = hostRef.current;
    const target = anchorRef.current;
    if (!host || !target) return;

    const h = host.getBoundingClientRect();
    const a = target.getBoundingClientRect();
    if (h.width === 0 || h.height === 0) return;
    // Below `lg` the anchor is removed from the layout, and a box that isn't
    // laid out measures as zeros at the viewport origin. Taking that literally
    // would put the figure at a scale of nothing somewhere off the left edge,
    // and the meteor radiant with it — so keep the last good anchor instead.
    if (a.width === 0 || a.height === 0) return;

    setAnchor((previous) => {
      const next: FigureAnchor = {
        cx: (a.left + a.width / 2 - h.left) / h.width,
        cy: (a.top + a.height / 2 - h.top) / h.height,
        width: a.width / h.width,
        height: a.height / h.height,
      };
      // Bail on no-op updates; a ResizeObserver fires plenty of those and each
      // one would otherwise be a fresh object and a re-render.
      const same = (Object.keys(next) as (keyof FigureAnchor)[]).every(
        (key) => Math.abs(next[key] - previous[key]) < 0.001,
      );
      return same ? previous : next;
    });
  }, [anchorRef, hostRef]);

  useEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (hostRef.current) observer.observe(hostRef.current);
    if (anchorRef.current) observer.observe(anchorRef.current);
    return () => observer.disconnect();
  }, [measure, anchorRef, hostRef]);

  const glowX = useTransform(mouse.x, [0, 1], ["38%", "72%"]);
  const glowY = useTransform(mouse.y, [0, 1], ["24%", "60%"]);
  const glow = useTransform(
    [glowX, glowY],
    ([latestX, latestY]) =>
      `radial-gradient(680px circle at ${latestX} ${latestY}, rgba(var(--color-accent-rgb), 0.055), transparent 68%)`,
  );

  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <StarfieldCanvas mouse={mouse} figure={anchor} showConstellation={showConstellation} />
      <motion.div className="absolute inset-0" style={{ background: glow }} />
      {/* Top fade only. A radial vignette would have to be centred on the hero
          while the figure sits off to one side, so it would dim the shield —
          this just keeps the field stars off the navbar. */}
      <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-bg to-transparent" />
    </div>
  );
}
