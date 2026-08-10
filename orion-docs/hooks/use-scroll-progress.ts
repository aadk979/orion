"use client";

import { useScroll, useSpring, type MotionValue } from "framer-motion";

/**
 * Smoothed 0-1 scroll progress for the whole document, used for the
 * reading-progress bar under the docs top nav.
 */
export function useScrollProgress(): MotionValue<number> {
  const { scrollYProgress } = useScroll();
  return useSpring(scrollYProgress, {
    stiffness: 300,
    damping: 40,
    restDelta: 0.001,
  });
}
