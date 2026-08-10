// Runs after `next build` (via the `postbuild` npm lifecycle script), against
// the static export in `out/`.
//
// Two jobs:
//
// 1. Renaming `sitemap.xml` to `sitemap-main.xml`. Next's file convention
//    (`app/sitemap.ts`) only ever writes `sitemap.xml`, so the rename happens
//    here, on the exported file, rather than by fighting the convention.
// 2. Copying every file in `google-seo-verification_docs/` to the root of the
//    export, unmodified — search engines expect their verification files
//    (`google<id>.html`, `BingSiteAuth.xml`, ...) served from the site root.

import { cp, readdir, rename } from "node:fs/promises";
import path from "node:path";

const root = path.dirname(import.meta.dirname);
const outDir = path.join(root, "out");
const verificationDir = path.join(root, "google-seo-verification_docs");

async function renameSitemap() {
  const from = path.join(outDir, "sitemap.xml");
  const to = path.join(outDir, "sitemap-main.xml");
  await rename(from, to);
  console.log("postbuild: renamed sitemap.xml -> sitemap-main.xml");
}

async function copyVerificationFiles() {
  const entries = await readdir(verificationDir);
  await Promise.all(
    entries.map((entry) =>
      cp(path.join(verificationDir, entry), path.join(outDir, entry), { recursive: true }),
    ),
  );
  console.log(`postbuild: copied ${entries.length} file(s) from google-seo-verification_docs/ into out/`);
}

await renameSitemap();
await copyVerificationFiles();
