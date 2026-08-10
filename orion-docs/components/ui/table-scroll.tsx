import type { TableHTMLAttributes } from "react";

/**
 * Keeps wide MDX tables inside the article column on small screens. The focusable
 * region makes horizontal overflow discoverable to keyboard users instead of
 * turning the entire page into a sideways-scrolling canvas.
 */
export function TableScroll(props: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div
      role="region"
      aria-label="Scrollable data table"
      tabIndex={0}
      className="orion-table-scroll"
    >
      <table {...props} />
    </div>
  );
}
