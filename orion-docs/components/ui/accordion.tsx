"use client";

import { Children, isValidElement, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { ease } from "@/lib/motion";

type AccordionItemProps = {
  title: string;
  children: ReactNode;
};

export function AccordionItem({ title, children }: AccordionItemProps) {
  void title;
  return <>{children}</>;
}

type AccordionProps = {
  children: ReactNode;
  className?: string;
  allowMultiple?: boolean;
};

export function Accordion({ children, className, allowMultiple = false }: AccordionProps) {
  const items = Children.toArray(children).filter(isValidElement) as React.ReactElement<AccordionItemProps>[];
  const [openIndexes, setOpenIndexes] = useState<number[]>([]);

  function toggle(index: number) {
    setOpenIndexes((current) => {
      const isOpen = current.includes(index);
      if (isOpen) return current.filter((i) => i !== index);
      return allowMultiple ? [...current, index] : [index];
    });
  }

  return (
    <div className={cn("not-prose my-6 divide-y divide-border rounded-md border border-border", className)}>
      {items.map((item, index) => {
        const isOpen = openIndexes.includes(index);
        return (
          <div key={item.props.title}>
            <button
              type="button"
              onClick={() => toggle(index)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left text-sm font-medium text-text-primary transition-colors hover:bg-white/[0.02]"
            >
              {item.props.title}
              <motion.span
                animate={{ rotate: isOpen ? 180 : 0 }}
                transition={{ duration: 0.2, ease: ease.outQuart }}
                className="shrink-0 text-text-tertiary"
              >
                <ChevronDown className="size-4" />
              </motion.span>
            </button>
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: ease.outQuart }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-4 text-sm leading-relaxed text-text-secondary">
                    {item.props.children}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
