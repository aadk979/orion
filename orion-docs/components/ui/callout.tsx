import { AlertTriangle, CheckCircle2, Info, Lightbulb, OctagonX } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const typeConfig = {
  info: {
    icon: Info,
    classes: "border-sky-400/20 bg-sky-400/[0.06] text-sky-300",
  },
  tip: {
    icon: Lightbulb,
    classes: "border-accent-dim/60 bg-accent/[0.07] text-accent-bright",
  },
  warning: {
    icon: AlertTriangle,
    classes: "border-amber-400/20 bg-amber-400/[0.06] text-amber-300",
  },
  error: {
    icon: OctagonX,
    classes: "border-red-400/20 bg-red-400/[0.06] text-red-300",
  },
  success: {
    icon: CheckCircle2,
    classes: "border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-300",
  },
} as const;

export type CalloutType = keyof typeof typeConfig;

type CalloutProps = {
  type?: CalloutType;
  title?: string;
  children: ReactNode;
  className?: string;
};

export function Callout({ type = "info", title, children, className }: CalloutProps) {
  const { icon: Icon, classes } = typeConfig[type];

  return (
    <div
      className={cn(
        "not-prose my-6 flex gap-3 rounded-md border px-4 py-3.5 text-sm leading-relaxed",
        classes,
        className,
      )}
    >
      <span className="flex h-[1.625em] shrink-0 items-center">
        <Icon className="size-4" strokeWidth={2} />
      </span>
      <div className="min-w-0 text-text-secondary [&>p]:m-0 [&_a]:text-text-primary [&_a]:underline">
        {title && <p className="mb-1 font-medium text-text-primary">{title}</p>}
        {children}
      </div>
    </div>
  );
}
