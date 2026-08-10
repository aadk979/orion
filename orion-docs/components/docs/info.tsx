import type { ReactNode } from "react";
import { Callout } from "@/components/ui/callout";

/** `<Info />` — MDX shorthand for an info-flavored `Callout`. */
export function Info({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <Callout type="info" title={title}>
      {children}
    </Callout>
  );
}
