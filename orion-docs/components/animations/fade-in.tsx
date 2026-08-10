"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { duration, ease, viewportOnce } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/hooks/use-media-query";

type FadeInProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
};

/** Scroll-triggered reveal — fades and rises into place once, on entering the viewport. */
export function FadeIn({ children, className, delay = 0 }: FadeInProps) {
  // A delay is choreography, and choreography is exactly what reduced motion is
  // asking us not to do.
  const reduceMotion = usePrefersReducedMotion();
  const wait = reduceMotion ? 0 : delay;

  // The delay is built into the variant rather than passed as a `transition`
  // prop, and that is not a style choice. A `transition` *inside* a variant
  // overrides the component's `transition` prop, so the shared `fadeUp` variant
  // — which carries its own duration and ease — was silently swallowing every
  // delay this component was ever given. Everything on the page fired at t=0.
  const variants = {
    hidden: { opacity: 0, y: 24 },
    show: {
      opacity: 1,
      y: 0,
      transition: { duration: duration.slow, ease: ease.outExpo, delay: wait },
    },
  };

  return (
    <motion.div
      variants={variants}
      initial="hidden"
      whileInView="show"
      viewport={viewportOnce}
      className={className}
    >
      {children}
    </motion.div>
  );
}
