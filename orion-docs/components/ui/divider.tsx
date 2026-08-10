"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { ease } from "@/lib/motion";

export function Divider({ className }: { className?: string }) {
  return (
    <div className={cn("relative mx-auto h-px w-full max-w-(--width-content)", className)}>
      <motion.div
        className="absolute inset-0 origin-center bg-gradient-to-r from-transparent via-border-strong to-transparent"
        initial={{ scaleX: 0, opacity: 0 }}
        whileInView={{ scaleX: 1, opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.9, ease: ease.outExpo }}
      />
    </div>
  );
}
