"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { ease } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/hooks/use-media-query";

/**
 * A rubber stamp.
 *
 * The one loud object in the pending register. Everywhere else the site is
 * quiet instrumentation held at ten percent opacity; the stamp is the opposite
 * on purpose — canted off the grid, double-ruled, letterspaced to the edge of
 * legibility, and the only thing on a pending page that is allowed to shout.
 * It works because it is rare. Two stamps on one screen is a novelty font.
 *
 * ## Why it reads as ink and not as a badge
 *
 * Three things, and dropping any one of them turns it back into a UI chip:
 *
 * 1. **The cant.** A few degrees off true, applied as a `rotate` transform on
 *    the outer element so the border, the rules and the text all rotate as one
 *    impression. A stamp square to the grid is a label.
 * 2. **The double rule.** An outer frame and an inner hairline with a sliver of
 *    ground between them, which is what a real stamp's die leaves behind.
 * 3. **The unevenness.** Ink does not land flat. The face carries a very low
 *    contrast noise wash and sits slightly under full opacity, so the amber
 *    breaks up instead of reading as a fill.
 *
 * ## Motion
 *
 * It lands like a stamp: down fast from slightly above at slight overscale,
 * overshooting nothing, arriving hard, then absolutely still. The impact is the
 * whole gesture — anything that keeps moving afterwards (a pulse, a float, a
 * shimmer) reads as a sticker, not an impression. `impact={false}` opts out for
 * the small inline uses where a landing beat would be noise.
 *
 * Reduced motion drops the travel and the overscale and simply fades it in. A
 * hard-landing object in the corner of the eye is exactly what that preference
 * is asking you not to do.
 */

const toneClasses = {
  /** Amber. The default, and what "pending" means everywhere on this site. */
  accent: "border-accent/70 text-accent-bright",
  /** Bone. For a stamp that has to sit next to an amber one without competing. */
  neutral: "border-border-strong text-text-tertiary",
} as const;

const sizeClasses = {
  sm: "px-2 py-0.5 text-[0.6rem] tracking-[0.22em]",
  md: "px-3 py-1 text-[0.7rem] tracking-[0.28em]",
  lg: "px-5 py-2 text-sm tracking-[0.3em] md:text-base",
} as const;

export type StampTone = keyof typeof toneClasses;
export type StampSize = keyof typeof sizeClasses;

/**
 * Ink mottle. A static SVG turbulence, inlined as a data URI so it costs no
 * request and cannot fail to load — a stamp whose texture 404s is a flat chip,
 * and the flat chip is the failure mode this component exists to avoid.
 *
 * `baseFrequency` is high enough that the grain stays sub-pixel-ish at every
 * size the stamp is used at, so it never resolves into a visible pattern.
 */
const INK_TEXTURE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E\")";

export function Stamp({
  children,
  tone = "accent",
  size = "md",
  /** Degrees off true. Small numbers only — past about 8° it reads as broken. */
  rotate = -4,
  /** The landing beat. Off for inline uses, where it would just be noise. */
  impact = true,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  tone?: StampTone;
  size?: StampSize;
  rotate?: number;
  impact?: boolean;
  delay?: number;
  className?: string;
}) {
  const reduceMotion = usePrefersReducedMotion();
  const landing = impact && !reduceMotion;

  return (
    <motion.span
      initial={
        landing
          ? { opacity: 0, scale: 1.6, y: -14, rotate: rotate - 6 }
          : reduceMotion
            ? { opacity: 0 }
            : false
      }
      animate={{ opacity: 1, scale: 1, y: 0, rotate }}
      transition={
        landing
          ? { duration: 0.42, delay, ease: ease.outExpo }
          : { duration: 0.3, delay }
      }
      className={cn(
        // `inline-flex` rather than `inline-block`: the face and the inner rule
        // are siblings that have to share a box the text sizes, and a block
        // would give the rule a life of its own at the descender.
        "relative inline-flex select-none items-center border-[1.5px] font-mono font-semibold uppercase",
        // Ink is never quite opaque. This is the difference between "stamped"
        // and "printed", and it is worth exactly one line of CSS.
        "opacity-95",
        toneClasses[tone],
        sizeClasses[size],
        className,
      )}
    >
      {/* The inner rule of the die. Inset by a hair so a sliver of ground shows
          between the two lines — that gap is the tell. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-[3px] border border-current opacity-40"
      />
      {/* The mottle. `soft-light` so it disturbs the ink without darkening it;
          `multiply` would grey the amber out and `overlay` would blow it. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.16] mix-blend-soft-light"
        style={{ backgroundImage: INK_TEXTURE }}
      />
      {/* The trailing letter-space would otherwise push the text off-centre —
          tracking adds a gap after the last glyph and nothing before the first. */}
      <span className="relative -mr-[0.28em] ml-0">{children}</span>
    </motion.span>
  );
}
