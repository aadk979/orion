import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const toneClasses = {
  neutral: "bg-white/[0.06] text-text-secondary border-border",
  accent: "bg-accent/10 text-accent-bright border-accent-dim/60",
  success: "bg-emerald-400/10 text-emerald-300 border-emerald-400/20",
  warning: "bg-amber-400/10 text-amber-300 border-amber-400/20",
} as const;

export type BadgeTone = keyof typeof toneClasses;

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
};

export function Badge({ tone = "neutral", className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium tracking-wide",
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
