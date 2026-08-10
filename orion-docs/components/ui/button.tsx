"use client";

import { forwardRef } from "react";
import Link from "next/link";
import { motion, type HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/utils";
import { springTransition } from "@/lib/motion";

const variantClasses = {
  primary:
    "bg-accent text-accent-contrast shadow-[0_0_0_1px_rgba(var(--color-accent-rgb),0.4),0_8px_24px_-8px_rgba(var(--color-accent-rgb),0.6)] hover:bg-accent-bright",
  secondary:
    "bg-white/[0.04] text-text-primary border border-border hover:border-border-strong hover:bg-white/[0.07]",
  ghost:
    "bg-transparent text-text-secondary hover:text-text-primary hover:bg-white/[0.05]",
} as const;

const sizeClasses = {
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-base gap-2.5",
} as const;

export type ButtonVariant = keyof typeof variantClasses;
export type ButtonSize = keyof typeof sizeClasses;

type BaseProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  href?: string;
  external?: boolean;
  /**
   * Opts this control into click measurement under the given name. Declared
   * rather than left to the prop spread because the `href` branch renders a
   * link and does not spread — see `components/analytics/analytics.tsx`.
   */
  "data-analytics-id"?: string;
};

type ButtonProps = BaseProps & Omit<HTMLMotionProps<"button">, keyof BaseProps>;

const baseClasses =
  "inline-flex items-center justify-center whitespace-nowrap rounded-full font-medium transition-colors duration-150 disabled:opacity-40 disabled:pointer-events-none select-none";

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "md",
      href,
      external,
      className,
      children,
      "data-analytics-id": analyticsId,
      ...props
    },
    ref,
  ) {
    const classes = cn(baseClasses, variantClasses[variant], sizeClasses[size], className);

    if (href) {
      const MotionLink = motion.create(Link);
      return (
        <MotionLink
          href={href}
          target={external ? "_blank" : undefined}
          rel={external ? "noreferrer" : undefined}
          data-analytics-id={analyticsId}
          className={classes}
          whileHover={{ scale: 1.02, y: -1 }}
          whileTap={{ scale: 0.98 }}
          transition={springTransition}
        >
          {children}
        </MotionLink>
      );
    }

    return (
      <motion.button
        ref={ref}
        data-analytics-id={analyticsId}
        className={classes}
        whileHover={{ scale: 1.02, y: -1 }}
        whileTap={{ scale: 0.98 }}
        transition={springTransition}
        {...props}
      >
        {children}
      </motion.button>
    );
  },
);
