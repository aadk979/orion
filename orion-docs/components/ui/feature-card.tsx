"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fadeUp } from "@/lib/motion";
import { cn } from "@/lib/utils";

type FeatureCardProps = {
  /** A rendered icon element (e.g. `<ShieldCheck className="size-4.5" />`) — not a component reference. */
  icon: ReactNode;
  title: string;
  description: string;
  className?: string;
};

export function FeatureCard({ icon, title, description, className }: FeatureCardProps) {
  return (
    <motion.div variants={fadeUp}>
      <Card className={cn("h-full", className)}>
        <CardHeader>
          <span className="flex size-9 items-center justify-center rounded-md border border-border bg-white/[0.04] text-accent-bright transition-colors duration-200 group-hover:border-accent-dim group-hover:text-accent">
            {icon}
          </span>
        </CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription className="mt-2">{description}</CardDescription>
      </Card>
    </motion.div>
  );
}
