"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { staggerContainer, viewportOnce } from "@/lib/motion";

type StaggerChildrenProps = {
  children: ReactNode;
  className?: string;
  stagger?: number;
};

/** Wrap `motion` children using `fadeUp`/`scaleIn` variants to reveal them in sequence. */
export function StaggerChildren({ children, className, stagger = 0.08 }: StaggerChildrenProps) {
  return (
    <motion.div
      variants={staggerContainer(stagger)}
      initial="hidden"
      whileInView="show"
      viewport={viewportOnce}
      className={className}
    >
      {children}
    </motion.div>
  );
}
