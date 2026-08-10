"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "@/hooks/use-media-query";

export type TerminalLine = {
  command: string;
  output?: string[];
};

type TerminalProps = {
  title?: string;
  lines?: TerminalLine[];
  className?: string;
  /**
   * Holds the first command back this long after mount. The hero fades the
   * terminal in at the end of a long intro; without this it would type through
   * a command and a half while still invisible, and arrive mid-sentence.
   */
  startDelayMs?: number;
};

const defaultLines: TerminalLine[] = [
  {
    command: "node index.js",
    output: [
      'Service "My Service" ready',
      "Service ID: 3e4c9f7a-2b1d-4f6e-9a3c-8d7b5e2f1a90",
      "Listening on port: 3900",
    ],
  },
  {
    command: "orionctl status",
    output: [
      "cluster: orion-prod   state: HEALTHY   3/3 online",
      "WKR-1  online   orion-node-1",
      "WKR-2  online   orion-node-2",
    ],
  },
  {
    command: "orionctl audit verify",
    output: ["chain: OK", "records verified: 12,481"],
  },
];

const CHAR_DELAY_MS = 28;
const LINE_PAUSE_MS = 550;
const NEXT_LINE_DELAY_MS = 2400;

export function Terminal({
  title = "bash — orion",
  lines = defaultLines,
  className,
  startDelayMs = 0,
}: TerminalProps) {
  const reduceMotion = usePrefersReducedMotion();
  // Counted rather than cycled: the index wraps back to 0, so it can't tell us
  // whether we're still waiting on the opening command or have come round again.
  const [advances, setAdvances] = useState(0);
  const line = reduceMotion ? lines.at(-1)! : lines[advances % lines.length];

  return (
    <div
      className={cn(
        "not-prose overflow-hidden rounded-lg border border-border bg-bg-raised shadow-(--shadow-md)",
        className,
      )}
    >
      <div className="flex h-10 items-center gap-2 border-b border-border-faint bg-white/[0.02] px-4">
        <span className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-white/15" />
          <span className="size-2.5 rounded-full bg-white/15" />
          <span className="size-2.5 rounded-full bg-white/15" />
        </span>
        <span className="ml-2 text-xs text-text-tertiary">{title}</span>
      </div>
      <TerminalLineView
        key={reduceMotion ? "static" : advances}
        line={line}
        reduceMotion={reduceMotion}
        // Only the opening command waits; once the loop is running it keeps its
        // own rhythm.
        startDelayMs={advances === 0 ? startDelayMs : 0}
        onComplete={() => setAdvances((n) => n + 1)}
      />
    </div>
  );
}

function TerminalLineView({
  line,
  reduceMotion,
  startDelayMs,
  onComplete,
}: {
  line: TerminalLine;
  reduceMotion: boolean;
  startDelayMs: number;
  onComplete: () => void;
}) {
  const [typed, setTyped] = useState(reduceMotion ? line.command : "");
  const [showOutput, setShowOutput] = useState(reduceMotion);

  useEffect(() => {
    if (reduceMotion) return;

    let cancelled = false;
    let charIndex = 0;

    const typeNextChar = () => {
      if (cancelled) return;
      charIndex += 1;
      setTyped(line.command.slice(0, charIndex));
      if (charIndex < line.command.length) {
        setTimeout(typeNextChar, CHAR_DELAY_MS);
      } else {
        setTimeout(() => {
          if (!cancelled) setShowOutput(true);
        }, LINE_PAUSE_MS);
      }
    };

    const startTimer = setTimeout(typeNextChar, 300 + startDelayMs);

    return () => {
      cancelled = true;
      clearTimeout(startTimer);
    };
  }, [line, reduceMotion, startDelayMs]);

  useEffect(() => {
    if (reduceMotion || !showOutput) return;
    const advance = setTimeout(onComplete, NEXT_LINE_DELAY_MS);
    return () => clearTimeout(advance);
  }, [showOutput, reduceMotion, onComplete]);

  return (
    <div className="min-h-[9.5rem] p-4 font-mono text-[0.8rem] leading-relaxed">
      <div className="flex gap-2 text-text-primary">
        <span className="text-accent-bright">➜</span>
        <span>
          {typed}
          <motion.span
            aria-hidden
            animate={{ opacity: [1, 1, 0, 0] }}
            transition={{ duration: 1, repeat: Infinity, times: [0, 0.5, 0.5, 1] }}
            className="ml-0.5 inline-block h-[1em] w-[0.5em] translate-y-[0.15em] bg-accent-bright align-middle"
          />
        </span>
      </div>
      {showOutput && line.output && (
        <div className="mt-2 space-y-0.5 text-text-secondary">
          {line.output.map((outputLine, index) => (
            <motion.p
              key={outputLine}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: index * 0.08 }}
            >
              {outputLine}
            </motion.p>
          ))}
        </div>
      )}
    </div>
  );
}
