import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type GridProps = HTMLAttributes<HTMLDivElement> & {
  columns?: 2 | 3 | 4;
  gap?: "sm" | "md" | "lg";
};

const columnClasses = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
} as const;

const gapClasses = {
  sm: "gap-3",
  md: "gap-5",
  lg: "gap-6",
} as const;

export function Grid({ columns = 3, gap = "md", className, children, ...props }: GridProps) {
  return (
    <div
      className={cn("grid grid-cols-1", columnClasses[columns], gapClasses[gap], className)}
      {...props}
    >
      {children}
    </div>
  );
}
