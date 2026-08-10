"use client";

import { Children, isValidElement, useId, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { ease } from "@/lib/motion";

type TabProps = {
  label: string;
  children: ReactNode;
};

export function Tab({ children }: TabProps) {
  return <>{children}</>;
}

type TabsProps = {
  items?: string[];
  children: ReactNode;
  className?: string;
};

export function Tabs({ items, children, className }: TabsProps) {
  const uid = useId();
  const tabs = Children.toArray(children).filter(isValidElement) as React.ReactElement<TabProps>[];
  const labels = items ?? tabs.map((tab) => tab.props.label);
  const [active, setActive] = useState(0);

  return (
    <div className={cn("not-prose my-6", className)}>
      <div
        role="tablist"
        className="flex gap-1 overflow-x-auto rounded-md border border-border bg-white/[0.02] p-1"
      >
        {labels.map((label, index) => (
          <button
            key={label}
            role="tab"
            type="button"
            aria-selected={active === index}
            onClick={() => setActive(index)}
            className={cn(
              "relative shrink-0 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors duration-150",
              active === index ? "text-text-primary" : "text-text-tertiary hover:text-text-secondary",
            )}
          >
            {active === index && (
              <motion.span
                layoutId={`${uid}-tab-highlight`}
                className="absolute inset-0 rounded-sm bg-white/[0.07]"
                transition={{ duration: 0.25, ease: ease.outExpo }}
              />
            )}
            <span className="relative">{label}</span>
          </button>
        ))}
      </div>
      <div className="mt-4">{tabs[active]}</div>
    </div>
  );
}
