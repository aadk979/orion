import type { Metadata } from "next";
import { siteConfig, siteKeywords } from "@/lib/site-config";
import { source } from "@/lib/release-status";

/**
 * Metadata and structured data.
 *
 * Two jobs. `pageMetadata()` builds the head of any page — canonical, Open
 * Graph and Twitter card — so that no route has to remember the shape of it,
 * and no route can drift. The `*JsonLd` builders describe what a page *is* to
 * a parser that will never read the prose.
 *
 * Everything here runs at build time. The site is a static export, so what
 * ships is plain markup in the HTML, which is exactly what a crawler that does
 * not execute JavaScript needs to see.
 */

/** Joins a site-relative path onto the canonical origin. */
export function absoluteUrl(path = "/"): string {
  return `${siteConfig.url}${path.startsWith("/") ? path : `/${path}`}`;
}

/** The shared social card. 1200×630 is the size every scraper crops toward. */
const OG_IMAGE = {
  url: absoluteUrl("/opengraph-image"),
  width: 1200,
  height: 630,
  alt: `${siteConfig.name} — ${siteConfig.tagline}`,
};

type PageMetadataInput = {
  /** Page title, unqualified — the layout's template appends the site name. */
  title?: string;
  description?: string;
  /** Site-relative, e.g. `/versions/alpine`. Becomes the canonical. */
  path: string;
  /** `article` for documentation pages; `website` for everything else. */
  type?: "website" | "article";
  /** ISO date the underlying page last changed, for `article:modified_time`. */
  modified?: string;
};

/**
 * Builds a page's metadata.
 *
 * The canonical is the part that matters most here. A static export is served
 * as files, so the same page is reachable as `/x`, `/x/` and `/x.html`
 * depending on how the host resolves it — three URLs, one page, and a crawler
 * with no way to know they are the same. Naming one explicitly on every route
 * is what stops that becoming duplicate content.
 */
export function pageMetadata({
  title,
  description,
  path,
  type = "website",
  modified,
}: PageMetadataInput): Metadata {
  const url = absoluteUrl(path);
  const resolvedDescription = description ?? siteConfig.description;
  // Open Graph has no title template, so it needs the qualified form spelled
  // out — otherwise every shared link is captioned with a bare page name.
  const socialTitle = title ? `${title} — ${siteConfig.name}` : `${siteConfig.name} — ${siteConfig.tagline}`;

  return {
    ...(title ? { title } : {}),
    description: resolvedDescription,
    alternates: { canonical: url },
    openGraph: {
      type,
      url,
      siteName: siteConfig.name,
      title: socialTitle,
      description: resolvedDescription,
      locale: "en_US",
      images: [OG_IMAGE],
      ...(type === "article" && modified ? { modifiedTime: modified } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description: resolvedDescription,
      images: [OG_IMAGE.url],
    },
  };
}

/* ---- Structured data ---------------------------------------------------
 *
 * Schema.org objects, emitted as JSON-LD by `<JsonLd>`. These are linked to
 * each other by `@id` rather than repeated: the organisation is defined once
 * and referenced everywhere it is the publisher, which is what lets a parser
 * treat the site as one entity instead of a pile of unrelated pages.
 */

const ORGANISATION_ID = absoluteUrl("/#organization");
const WEBSITE_ID = absoluteUrl("/#website");

export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": ORGANISATION_ID,
    name: siteConfig.name,
    url: siteConfig.url,
    description: siteConfig.description,
    logo: absoluteUrl("/brand/png/orion-icon-on-dark-1024.png"),
    // `sameAs` is a claim that these profiles are this organisation. Asserting
    // a repository that does not resolve is worse than asserting nothing: a
    // crawler that follows it gets a 404 from a URL the site vouched for, and
    // the property is omitted entirely rather than shipped empty.
    ...(source.available ? { sameAs: [source.url] } : {}),
  };
}

export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    name: siteConfig.name,
    url: siteConfig.url,
    description: siteConfig.description,
    inLanguage: "en",
    publisher: { "@id": ORGANISATION_ID },
  };
}

/**
 * The project itself. `SoftwareApplication` rather than `Product` — nothing is
 * for sale — and the price is stated as zero explicitly, because "free" is a
 * fact a parser can only know if you assert it.
 */
export function softwareApplicationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: siteConfig.name,
    description: siteConfig.description,
    url: siteConfig.url,
    applicationCategory: "DeveloperApplication",
    applicationSubCategory: "Authentication Framework",
    operatingSystem: "Node.js",
    softwareRequirements: "Node.js, PostgreSQL",
    programmingLanguage: "JavaScript",
    ...(source.available ? { codeRepository: source.url } : {}),
    license: "https://opensource.org/licenses/MIT",
    keywords: [...siteKeywords].join(", "),
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    publisher: { "@id": ORGANISATION_ID },
  };
}

/** A documentation page. `TechArticle` is the schema built for exactly this. */
export function techArticleJsonLd({
  title,
  description,
  path,
  modified,
}: {
  title: string;
  description?: string;
  path: string;
  modified?: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: title,
    ...(description ? { description } : {}),
    url: absoluteUrl(path),
    mainEntityOfPage: { "@type": "WebPage", "@id": absoluteUrl(path) },
    inLanguage: "en",
    isPartOf: { "@id": WEBSITE_ID },
    publisher: { "@id": ORGANISATION_ID },
    ...(modified ? { dateModified: modified } : {}),
  };
}

/**
 * The trail from the site root down to a page. This is what produces the
 * breadcrumb line in a search result in place of a raw URL, and it is the one
 * piece of structured data whose effect you can see without a testing tool.
 */
export function breadcrumbJsonLd(trail: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.path),
    })),
  };
}
