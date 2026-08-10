import type { ReactNode } from "react";
import { Callout } from "@/components/ui/callout";

/** `<Warning />` — MDX shorthand for a warning-flavored `Callout`. */
export function Warning({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <Callout type="warning" title={title}>
      {children}
    </Callout>
  );
}
