import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { getPageMap } from "nextra/page-map";
import { getDocsNavTree } from "@/lib/nav-tree";
import { siteConfig, siteKeywords } from "@/lib/site-config";
import { source } from "@/lib/release-status";
import {
  currentVersion,
  VERSIONS_BASE_PATH,
  versionDocsRoute,
  versionStatusLabel,
} from "@/lib/versions";
import { organizationJsonLd, websiteJsonLd } from "@/lib/seo";
import { JsonLd } from "@/components/seo/json-ld";
import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";
import { Analytics } from "@/components/analytics/analytics";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: `${siteConfig.name} — ${siteConfig.tagline}`,
    template: `%s — ${siteConfig.name}`,
  },
  description: siteConfig.description,
  applicationName: siteConfig.name,
  // No `url` on the author until there is a public profile to point at — an
  // author link that 404s is worse metadata than an author with no link.
  authors: [{ name: "Aadharsh", ...(source.available ? { url: source.url } : {}) }],
  creator: "Aadharsh",
  publisher: siteConfig.name,
  keywords: [...siteKeywords],
  category: "technology",
  // favicon.ico, icon.svg and apple-icon.png sit in `app/` and are picked up
  // by the file convention, which emits the right rel/type/sizes for each.
  // Only the manifest needs naming here.
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    title: siteConfig.name,
    capable: true,
    statusBarStyle: "black-translucent",
  },
  // Every route sets its own canonical through `pageMetadata()`; this is the
  // fallback for anything that forgets, and it is the right one for the root.
  alternates: { canonical: siteConfig.url },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      // Without these Google truncates the snippet and may show only a
      // thumbnail. They are the difference between a full result and a stub.
      "max-snippet": -1,
      "max-image-preview": "large",
      "max-video-preview": -1,
    },
  },
  // Telephone detection rewrites version numbers and ports into phone links on
  // iOS, which mangles documentation full of `:5432` and `1.2.3`.
  formatDetection: { telephone: false },
};

// `metadata.themeColor` has been deprecated since Next 14 — it lives on the
// viewport export now. Ink, matching the manifest and the mark's plate.
export const viewport: Viewport = {
  themeColor: "#14120E",
  colorScheme: "dark",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const pageMap = await getPageMap();
  const navTree = getDocsNavTree(pageMap, siteConfig.docsBasePath);

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-bg text-text-primary">
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        {/* Site-wide identity, defined once here and referenced by `@id` from
            the per-page structured data rather than repeated on every route. */}
        <JsonLd data={organizationJsonLd()} />
        <JsonLd data={websiteJsonLd()} />
        <Analytics />
        <Navbar
          navTree={navTree}
          edition={{
            name: currentVersion.name,
            ordinal: currentVersion.ordinal,
            statusLabel: versionStatusLabel(currentVersion.status),
            docsHref: versionDocsRoute(currentVersion),
            archiveHref: VERSIONS_BASE_PATH,
          }}
        />
        <div id="main-content" tabIndex={-1} className="flex-1">
          {children}
        </div>
        <Footer />
      </body>
    </html>
  );
}
