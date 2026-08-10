import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function InfoBox({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "not-prose my-6 rounded-md border border-border bg-white/[0.02] p-5",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
