import type { NextConfig } from "next";
import nextra from "nextra";
import { currentVersion, versionDocsRoute } from "./lib/versions";

/**
 * `content/` documents the current edition, so its pages mount under that
 * edition's docs route rather than a bare `/docs`. The app route that renders
 * them has to spell the same path out as folders — see
 * `app/versions/alpine/docs/[[...mdxPath]]/page.tsx`.
 */
const docsBasePath = versionDocsRoute(currentVersion);

const withNextra = nextra({
  contentDirBasePath: docsBasePath,
  defaultShowCopyCode: true,
  readingTime: true,
  search: {
    codeblocks: false,
  },
  mdxOptions: {
    rehypePrettyCodeOptions: {
      theme: "github-dark-default",
      keepBackground: false,
    },
  },
});

const nextConfig: NextConfig = {
  output: "export",
  reactStrictMode: true,
  images: {
    formats: ["image/avif", "image/webp"],
  },
  turbopack: {
    root: import.meta.dirname,
  },
  // Docs lived at `/docs` before they were versioned, and those URLs are in the
  // wild — in the repository's own READMEs, at minimum. They resolve onto the
  // current edition rather than 404ing.
  //
  // These only apply to `next dev`. A static export has no server to redirect
  // with, and the build says so; production is served by Firebase Hosting, and
  // the 301s that actually reach a visitor are the ones in `firebase.json`.
  // Both lists have to be changed together.
  async redirects() {
    return [
      { source: "/docs", destination: docsBasePath, permanent: true },
      {
        source: "/docs/:path*",
        destination: `${docsBasePath}/:path*`,
        permanent: true,
      },
    ];
  },
};

export default withNextra(nextConfig);
