"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { ease } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/hooks/use-media-query";

type RevealTextProps = {
  text: string;
  as?: "h1" | "h2" | "h3" | "p" | "span";
  className?: string;
  delay?: number;
  /**
   * Adds a focus-pull: each word rises out of its mask already blurred and
   * sharpens as it lands. Costs a filter animation per word, so it's opt-in
   * and meant for the one headline at the top of the page.
   */
  focusPull?: boolean;
  /** Seconds between each word. */
  stagger?: number;
};

/** Splits `text` into words and reveals each with a masked rise, for hero headlines. */
export function RevealText({
  text,
  as: Tag = "h1",
  className,
  delay = 0,
  focusPull = false,
  stagger = 0.045,
}: RevealTextProps) {
  const reduceMotion = usePrefersReducedMotion();
  const words = text.split(" ");

  if (reduceMotion) {
    return <Tag className={cn("flex flex-wrap", className)}>{text}</Tag>;
  }

  return (
    <Tag className={cn("flex flex-wrap", className)}>
      {words.map((word, index) => (
        <span key={`${word}-${index}`} className="mr-[0.28em] overflow-hidden py-[0.08em]">
          {/*
            The word carries its own trailing space, even though the gap you
            see is the margin above. Without it the element's text content is
            `Authenticationyourunyourself.` — the words are separate boxes and
            nothing in the DOM separates them. That string is what a screen
            reader announces and what anything extracting text reads, which on
            a hero headline means the page's `h1`. A trailing space inside an
            inline-block collapses when rendered, so it costs nothing visually.
          */}
          <motion.span
            className="inline-block"
            initial={focusPull ? { y: "110%", filter: "blur(14px)", opacity: 0 } : { y: "110%" }}
            animate={focusPull ? { y: "0%", filter: "blur(0px)", opacity: 1 } : { y: "0%" }}
            transition={{
              duration: focusPull ? 1.1 : 0.7,
              ease: ease.outExpo,
              delay: delay + index * stagger,
            }}
          >
            {index < words.length - 1 ? `${word} ` : word}
          </motion.span>
        </span>
      ))}
    </Tag>
  );
}
