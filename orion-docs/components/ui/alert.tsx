"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Megaphone, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ease } from "@/lib/motion";

type AlertProps = {
  children: React.ReactNode;
  dismissible?: boolean;
  className?: string;
};

export function Alert({ children, dismissible = true, className }: AlertProps) {
  const [dismissed, setDismissed] = useState(false);

  return (
    <AnimatePresence>
      {!dismissed && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.3, ease: ease.outQuart }}
          className="overflow-hidden"
        >
          <div
            className={cn(
              "relative flex items-center justify-center gap-2.5 border-b border-border bg-accent/[0.06] px-11 py-2.5 text-sm text-text-secondary",
              className,
            )}
          >
            <Megaphone className="size-4 shrink-0 text-accent-bright" strokeWidth={1.75} />
            <div className="text-center [&_a]:text-text-primary [&_a]:underline [&>p]:m-0">
              {children}
            </div>
            {dismissible && (
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => setDismissed(true)}
                className="absolute right-3 top-1/2 shrink-0 -translate-y-1/2 rounded-full p-1 text-text-tertiary transition-colors hover:bg-white/5 hover:text-text-primary"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
