"use client";

import { useEffect, useRef } from "react";
import { useMotionValue, type MotionValue } from "framer-motion";

export type MousePosition = {
  x: MotionValue<number>;
  y: MotionValue<number>;
};

/**
 * Tracks pointer position, normalized to the bounding box of `ref`, as
 * Framer Motion values so consumers can drive transforms without re-rendering.
 */
export function useMousePosition<T extends HTMLElement>(): [
  React.RefObject<T | null>,
  MousePosition,
] {
  const ref = useRef<T | null>(null);
  const x = useMotionValue(0.5);
  const y = useMotionValue(0.5);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    function handlePointerMove(event: PointerEvent) {
      const rect = node!.getBoundingClientRect();
      x.set((event.clientX - rect.left) / rect.width);
      y.set((event.clientY - rect.top) / rect.height);
    }

    node.addEventListener("pointermove", handlePointerMove);
    return () => node.removeEventListener("pointermove", handlePointerMove);
  }, [x, y]);

  return [ref, { x, y }];
}
