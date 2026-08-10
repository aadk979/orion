"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

type GradientMeshProps = {
  className?: string;
};

/**
 * Two large, slowly-drifting soft-gradient blobs. Kept low-opacity and
 * modestly blurred — a wash of color, not a glassmorphism panel.
 *
 * Held deliberately faint. Behind the hero starfield these sit as airglow near
 * the horizon; any stronger and the wash greys out the black the stars need to
 * read against, and the whole field turns muddy brown.
 *
 * No `blur()` filter, on purpose. These used to carry a 110–130px blur, which
 * meant every frame of the drift animation re-rasterised two viewport-sized
 * blurred layers — measured at ~45 of the hero's ~60fps budget, by far the most
 * expensive thing on the page. A radial gradient is already soft; widening the
 * colour stops gets the same look for free.
 */
export function GradientMesh({ className }: GradientMeshProps) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <motion.div
        className="absolute -left-1/4 top-[-10%] size-[75vw] rounded-full opacity-[0.09]"
        style={{
          background:
            "radial-gradient(circle, rgba(var(--color-accent-rgb),0.85) 0%, rgba(var(--color-accent-rgb),0.28) 32%, rgba(var(--color-accent-rgb),0) 68%)",
        }}
        animate={{ x: [0, 40, -20, 0], y: [0, 30, -10, 0] }}
        transition={{ duration: 26, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute -right-1/4 top-[10%] size-[62vw] rounded-full opacity-[0.05]"
        style={{
          background:
            "radial-gradient(circle, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.25) 34%, rgba(255,255,255,0) 68%)",
        }}
        animate={{ x: [0, -30, 20, 0], y: [0, -20, 30, 0] }}
        transition={{ duration: 32, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}
