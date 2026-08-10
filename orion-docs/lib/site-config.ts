import {
  currentVersion,
  VERSIONS_BASE_PATH,
  versionDocsRoute,
} from "@/lib/versions";

/**
 * Docs are versioned by edition, so there is no bare `/docs` — every page
 * hangs off the edition that documents it. Nothing in the site should write
 * that prefix out by hand; take it from here, or from `versionDocsRoute()`
 * when the edition is one you were handed rather than the current one.
 */
export const docsBasePath = versionDocsRoute(currentVersion);

/** Joins a docs-relative path onto the current edition's base. */
export function docs(path = ""): string {
  return path ? `${docsBasePath}/${path.replace(/^\//, "")}` : docsBasePath;
}

export const siteConfig = {
  name: "Orion",
  tagline: "Self-hosted authentication for Node.js, with a cluster control plane.",
  description:
    "Orion is a self-hosted authentication framework your Node/Express app embeds — sessions, tokens, passkeys, TOTP, device authorization, OAuth, abuse defense, and a tamper-evident audit trail — plus a cluster control plane and a PBAC-governed admin plane for operating a fleet of nodes.",
  /**
   * Canonical origin. Everything absolute derives from this — `metadataBase`,
   * canonical links, the sitemap, and every Open Graph URL — so moving to a
   * custom domain is this one line plus a redirect from the old host, and
   * nothing else in the site needs to know.
   *
   * No trailing slash: `absoluteUrl()` joins paths that begin with one.
   */
  url: "https://orion-docs.web.app",
  /**
   * The repository URL deliberately does not live here.
   *
   * It is behind the release gate in `lib/release-status.ts`, because whether
   * there *is* a public repository is a fact about the release and not a fact
   * about the site. Anything that wants to link to source imports `source` from
   * there and handles the unavailable branch; a bare `githubUrl` on this object
   * is an invitation to link a 404, which is how the site ended up claiming to
   * be open before it was.
   */
  docsBasePath,
  versionsBasePath: VERSIONS_BASE_PATH,
} as const;

/**
 * Subject terms for the site as a whole.
 *
 * `<meta name="keywords">` itself has been ignored by Google since 2009 and is
 * not why this exists — it feeds the `about`/`keywords` fields of the
 * structured data, where it does describe the subject to a parser that reads
 * it. Kept to terms the documentation genuinely covers: claiming topics the
 * pages don't deliver on is the one SEO tactic that reliably backfires.
 */
export const siteKeywords = [
  "self-hosted authentication",
  "Node.js authentication",
  "Express authentication middleware",
  "authentication framework",
  "session management",
  "refresh token rotation",
  "passkeys",
  "WebAuthn",
  "TOTP two-factor authentication",
  "OAuth 2.0",
  "device authorization grant",
  "DPoP proof of possession",
  "PBAC",
  "audit trail",
  "cluster control plane",
] as const;

export type NavSection = {
  title: string;
  href: string;
};

export const primaryNav: NavSection[] = [
  { title: "Docs", href: docs() },
  { title: "Architecture", href: docs("architecture") },
  { title: "SDK", href: docs("sdk") },
  { title: "Versions", href: VERSIONS_BASE_PATH },
];

export const footerNav: { title: string; links: NavSection[] }[] = [
  {
    title: "Documentation",
    links: [
      { title: "Getting Started", href: docs("getting-started") },
      { title: "Guides", href: docs("guides") },
      { title: "Architecture", href: docs("architecture") },
      { title: "Concepts", href: docs("concepts") },
    ],
  },
  {
    title: "Reference",
    links: [
      { title: "SDK", href: docs("sdk") },
      { title: "API Reference", href: docs("api-reference") },
      { title: "Configuration", href: docs("configuration") },
      { title: "CLI", href: docs("cli") },
    ],
  },
  {
    title: "Project",
    links: [
      { title: "Editions", href: VERSIONS_BASE_PATH },
      { title: "Security", href: docs("security") },
      { title: "Roadmap", href: docs("roadmap") },
      { title: "Contributing", href: docs("contributing") },
      { title: "FAQ", href: docs("faq") },
    ],
  },
];
