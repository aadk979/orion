import { generateStaticParamsFor, importPage } from "nextra/pages";
import { getPageMap } from "nextra/page-map";
import { findActiveTrail, getDocsNavTree } from "@/lib/nav-tree";
import { siteConfig } from "@/lib/site-config";
import {
  currentVersion,
  VERSIONS_BASE_PATH,
  versionDocsRoute,
  versionStatusLabel,
} from "@/lib/versions";
import { breadcrumbJsonLd, pageMetadata, techArticleJsonLd } from "@/lib/seo";
import { DocsLayout } from "@/components/layout/docs-layout";
import { JsonLd } from "@/components/seo/json-ld";
import { documentLastModified } from "@/lib/content-dates";

/**
 * The current edition's documentation.
 *
 * The edition slug is a literal folder rather than a `[version]` segment, and
 * that is deliberate. Nextra resolves MDX out of a single `content/` directory
 * â€” `importPage()` takes the segments *after* the base path and looks them up
 * in one route map â€” so a dynamic segment would have nothing to vary against.
 * A second edition means a second content directory and a second folder beside
 * this one, which is also what keeps an archived edition frozen instead of
 * quietly re-rendering today's prose under yesterday's version number.
 */
export const generateStaticParams = generateStaticParamsFor("mdxPath");

type PageProps = {
  params: Promise<{ mdxPath?: string[] }>;
};

/** Where a docs page lives, given the segments after the base path. */
function docsRoute(mdxPath?: string[]): string {
  return `${siteConfig.docsBasePath}${mdxPath?.length ? `/${mdxPath.join("/")}` : ""}`;
}

export async function generateMetadata({ params }: PageProps) {
  const { mdxPath } = await params;
  const segments = mdxPath?.filter(Boolean) ?? [];
  const [{ metadata }, modified] = await Promise.all([
    importPage(segments),
    documentLastModified(segments),
  ]);

  // Nextra's metadata is the page's own â€” title and description off the MDX
  // frontmatter â€” and stays authoritative. What it cannot know is where the
  // page sits on a real origin, so the canonical and the social tags are
  // layered underneath it rather than over it.
  return {
    ...metadata,
    ...pageMetadata({
      title: typeof metadata.title === "string" ? metadata.title : undefined,
      description: metadata.description ?? undefined,
      path: docsRoute(segments),
      type: "article",
      modified: modified?.toISOString(),
    }),
  };
}

export default async function Page({ params }: PageProps) {
  const { mdxPath } = await params;
  const segments = mdxPath?.filter(Boolean) ?? [];
  const [{ default: MDXContent, toc, metadata }, pageMap, modified] = await Promise.all([
    importPage(segments),
    getPageMap(),
    documentLastModified(segments),
  ]);

  const navTree = getDocsNavTree(pageMap, siteConfig.docsBasePath);
  const route = docsRoute(segments);

  // The same trail the sidebar highlights, reused as the breadcrumb â€” so the
  // path a search result shows is the path the site actually presents, and the
  // section names are the ones an editor wrote rather than de-slugified guesses.
  const trail = findActiveTrail(navTree, route);
  const title = typeof metadata.title === "string" ? metadata.title : siteConfig.name;

  return (
    <>
      <JsonLd
        data={techArticleJsonLd({
          title,
          description: metadata.description ?? undefined,
          path: route,
          modified: modified?.toISOString(),
        })}
      />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: siteConfig.name, path: "/" },
          { name: `${currentVersion.name} docs`, path: siteConfig.docsBasePath },
          ...trail.map((node) => ({ name: node.title, path: node.route })),
        ])}
      />
      <DocsLayout
        navTree={navTree}
        toc={toc}
        title={metadata.title}
        description={metadata.description}
        route={route}
        trail={trail}
        edition={{
          name: currentVersion.name,
          ordinal: currentVersion.ordinal,
          statusLabel: versionStatusLabel(currentVersion.status),
          docsHref: versionDocsRoute(currentVersion),
          archiveHref: VERSIONS_BASE_PATH,
        }}
      >
        <MDXContent />
      </DocsLayout>
    </>
  );
}