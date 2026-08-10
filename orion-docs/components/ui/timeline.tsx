"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { fadeUp, staggerContainer, viewportOnce } from "@/lib/motion";

export type TimelineEntry = {
  label: string;
  title: string;
  description?: string;
};

type TimelineProps = {
  entries: TimelineEntry[];
  className?: string;
};

export function Timeline({ entries, className }: TimelineProps) {
  return (
    <motion.ol
      variants={staggerContainer(0.12)}
      initial="hidden"
      whileInView="show"
      viewport={viewportOnce}
      className={cn("not-prose relative my-6 space-y-0", className)}
    >
      {entries.map((entry, index) => (
        <motion.li key={`${index}-${entry.title}`} variants={fadeUp} className="relative flex gap-5 pb-8 last:pb-0">
          <div className="relative flex shrink-0 flex-col items-center">
            <span className="mt-1 size-2.5 rounded-full bg-accent shadow-[0_0_0_4px_rgba(var(--color-accent-rgb),0.15)]" />
            {index < entries.length - 1 && (
              <span className="mt-1.5 w-px flex-1 bg-gradient-to-b from-border-strong to-transparent" aria-hidden />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <span className="font-mono text-xs uppercase tracking-wide text-text-faint">
              {entry.label}
            </span>
            <p className="mt-1 font-medium text-text-primary">{entry.title}</p>
            {entry.description && (
              <p className="mt-1 text-sm leading-relaxed text-text-secondary">{entry.description}</p>
            )}
          </div>
        </motion.li>
      ))}
    </motion.ol>
  );
}
