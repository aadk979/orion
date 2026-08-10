"use client";

import { forwardRef } from "react";
import { motion, type HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/utils";
import { ease } from "@/lib/motion";

type CardProps = HTMLMotionProps<"div"> & {
  hoverable?: boolean;
};

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, hoverable = true, children, ...props },
  ref,
) {
  return (
    <motion.div
      ref={ref}
      className={cn(
        "group relative rounded-lg border border-border bg-bg-raised/60 p-6",
        "shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]",
        className,
      )}
      whileHover={
        hoverable
          ? { y: -4, borderColor: "var(--color-border-strong)" }
          : undefined
      }
      transition={{ duration: 0.25, ease: ease.outQuart }}
      {...props}
    >
      {children}
    </motion.div>
  );
});

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-3 flex items-center gap-2.5", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("text-base font-semibold tracking-tight text-text-primary", className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  // A `div`, not a `p` — MDX wraps multi-line JSX children in their own
  // paragraph, and a `<p>` can't legally contain another `<p>`.
  return (
    <div
      className={cn("text-sm leading-relaxed text-text-secondary [&_p]:m-0", className)}
      {...props}
    />
  );
}
