import type { ReactNode } from "react";

/**
 * A CSS entrance keeps route changes polished without shipping an animation
 * boundary or leaving the exported HTML invisible until React hydrates it.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  return <div className="orion-page-enter">{children}</div>;
}
