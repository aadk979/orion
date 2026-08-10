"use client";

import { motion } from "framer-motion";
import { fadeUp, staggerContainer, viewportOnce } from "@/lib/motion";
import type { VersionHighlight } from "@/lib/versions";

/**
 * What an edition brought, as a numbered run of rows.
 *
 * Deliberately not a card grid. These entries are read in order and vary a lot
 * in length; a grid would either clip the long ones or leave the short ones
 * floating in whitespace, and it would throw away the sequence — which for a
 * changelog is most of the meaning.
 */
export function VersionHighlights({ highlights }: { highlights: VersionHighlight[] }) {
  return (
    <motion.ol
      variants={staggerContainer(0.09)}
      initial="hidden"
      whileInView="show"
      viewport={viewportOnce}
      className="border-t border-border-faint"
    >
      {highlights.map((highlight, index) => (
        <motion.li
          key={highlight.title}
          variants={fadeUp}
          className="group grid grid-cols-1 gap-x-10 gap-y-3 border-b border-border-faint py-8 md:grid-cols-[4rem_14rem_1fr]"
        >
          <span className="font-mono text-2xl font-semibold tabular-nums leading-none tracking-tight text-text-faint transition-colors duration-300 group-hover:text-accent">
            {String(index + 1).padStart(2, "0")}
          </span>

          <div>
            <span className="font-mono text-[0.65rem] uppercase tracking-wide text-accent-bright">
              {highlight.label}
            </span>
            <h3 className="mt-1.5 text-lg font-semibold tracking-tight text-balance text-text-primary">
              {highlight.title}
            </h3>
          </div>

          <p className="max-w-prose leading-relaxed text-text-secondary">
            {highlight.description}
          </p>
        </motion.li>
      ))}
    </motion.ol>
  );
}
