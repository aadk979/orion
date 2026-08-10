"use client";

import type { CSSProperties, ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

const statusClasses = {
  healthy: "bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.18)]",
  warning: "bg-amber-400 shadow-[0_0_0_3px_rgba(251,191,36,0.18)]",
  offline: "bg-text-faint shadow-none",
} as const;

export type ClusterNodeStatus = keyof typeof statusClasses;

type ClusterNodeProps = {
  label: string;
  sublabel?: string;
  /** A rendered icon element (e.g. `<Server className="size-3.5" />`) — not a component reference. */
  icon?: ReactNode;
  status?: ClusterNodeStatus;
  style?: CSSProperties;
  className?: string;
  delay?: number;
};

/** A single positioned node in a cluster/architecture diagram. */
export function ClusterNode({
  label,
  sublabel,
  icon,
  status = "healthy",
  style,
  className,
  delay = 0,
}: ClusterNodeProps) {
  return (
    <motion.div
      style={style}
      initial={{ opacity: 0, scale: 0.9 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4, delay, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "absolute flex min-w-[7.5rem] -translate-x-1/2 -translate-y-1/2 flex-col gap-1 rounded-md border border-border-strong bg-bg-elevated px-3 py-2 shadow-(--shadow-sm)",
        className,
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className={cn("size-1.5 shrink-0 rounded-full", statusClasses[status])} />
        {icon}
        <span className="truncate text-xs font-medium text-text-primary">{label}</span>
      </div>
      {sublabel && (
        <span className="truncate font-mono text-[0.65rem] text-text-tertiary">{sublabel}</span>
      )}
    </motion.div>
  );
}
