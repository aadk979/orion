import type { MetadataRoute } from "next";
import { generateStaticParamsFor } from "nextra/pages";
import { documentLastModified } from "@/lib/content-dates";
import { absoluteUrl } from "@/lib/seo";
import { VERSIONS_BASE_PATH, currentVersion, versionDocsRoute, versionRoute, versions } from "@/lib/versions";

/**
 * The sitemap.
 *
 * Routes come from the same `generateStaticParamsFor` call the docs route uses
 * to decide what to build, so the sitemap cannot list a page that does not
 * exist or miss one that does â€” the alternative, walking the nav tree, only
 * finds pages someone remembered to put in the navigation.
 */
export const dynamic = "force-static";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const params = (await generateStaticParamsFor("mdxPath")()) as { mdxPath?: string[] }[];
  const docsBase = versionDocsRoute(currentVersion);

  const docs = await Promise.all(
    params.map(async ({ mdxPath = [] }) => {
      // Nextra's catch-all can represent its index route as `[""]`. It is the
      // same document as the no-segment route, not a trailing-slash URL.
      const segments = mdxPath.filter(Boolean);
      const route = segments.length ? `${docsBase}/${segments.join("/")}` : docsBase;
      return {
        url: absoluteUrl(route),
        lastModified: await documentLastModified(segments),
        changeFrequency: "weekly" as const,
        // The landing page of the documentation outranks the pages inside it.
        priority: segments.length === 0 ? 0.9 : 0.7,
      };
    }),
  );

  const editions = versions.map((version) => ({
    url: absoluteUrl(versionRoute(version)),
    // A publication date is a valid freshness signal for a frozen edition. A
    // pending edition has no such date, so omit `lastmod` rather than guess.
    ...(version.publishedOn ? { lastModified: version.publishedOn } : {}),
    changeFrequency: "monthly" as const,
    // An archived edition is frozen and of less interest than the current one.
    priority: version.status === "current" ? 0.7 : 0.4,
  }));

  return [
    {
      url: absoluteUrl("/"),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: absoluteUrl(VERSIONS_BASE_PATH),
      changeFrequency: "monthly",
      priority: 0.5,
    },
    ...editions,
    ...docs,
  ];
}