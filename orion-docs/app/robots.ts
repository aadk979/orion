import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";

export const dynamic = "force-static";

/**
 * Deliberately permissive.
 *
 * Note what is *not* disallowed: `/_next/`. Blocking it is the classic own
 * goal — Google renders pages before judging them, and a crawler denied the
 * CSS and JS sees an unstyled document and scores the layout accordingly.
 * There is nothing behind this site worth hiding from a crawler anyway; it is
 * a static export of public documentation.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    // Renamed from `sitemap.xml` to `sitemap-main.xml` in `scripts/postbuild.mjs`
    // as part of the static export; this has to point at the same name.
    sitemap: absoluteUrl("/sitemap-main.xml"),
  };
}
